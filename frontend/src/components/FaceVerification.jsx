import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, CheckCircle2, Loader2, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker";
import { buildFacePose } from "../utils/facePose";
import { LIVENESS_STEPS, STEP_LABELS, baseInstruction, createLivenessSequence, isBaseFaceValid, isStepSatisfied, movementProgress } from "../utils/livenessChecks";
import { Button } from "./ui";
import { captureVideoFrame, compressImage } from "./auth/imageTools";
import "../styles/face-verification.css";

const CAMERA_RESTART_LIMIT = 1;
const DETECTION_INTERVAL_MS = 55;
const STEP_HOLD_MS = 320;
const CENTER_HOLD_MS = 400;
const STEP_TIMEOUT_MS = 8000;
const FACE_MISSING_RESET_MS = 1500;
const SUCCESS_ADVANCE_MS = 600;
const BLINK_CLOSE_THRESHOLD = 0.55;
const BLINK_OPEN_THRESHOLD = 0.25;
const BLINK_EAR_RATIO = 0.72;

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 720 },
    height: { ideal: 1280 },
    frameRate: { ideal: 30, max: 30 }
  }
};

function waitForVideoMetadata(video) {
  if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Unable to start camera."));
    }, 5000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("canplay", handleLoaded);
      video.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to start camera."));
    };
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("canplay", handleLoaded);
    video.addEventListener("error", handleError);
  });
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission is required.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera detected.";
  if (error?.name === "NotReadableError") return "Camera is currently being used by another application.";
  return "Unable to start camera.";
}

function createBlinkTracker() {
  return {
    state: "OPEN",
    baselineSamples: [],
    baselineEar: 0,
    closeEarThreshold: 0,
    closedStartedAt: 0,
    closedFrames: 0,
    detected: false,
    progress: 0
  };
}

function updateBlinkTracker(ref, face, timestamp) {
  const tracker = ref.current;
  if (tracker.detected) return tracker;

  const blendClosed = face.leftBlink >= BLINK_CLOSE_THRESHOLD && face.rightBlink >= BLINK_CLOSE_THRESHOLD;
  const blendOpen = face.leftBlink <= BLINK_OPEN_THRESHOLD && face.rightBlink <= BLINK_OPEN_THRESHOLD;

  if (face.averageEar > 0.16 && blendOpen) {
    tracker.baselineSamples.push(face.averageEar);
    if (tracker.baselineSamples.length > 12) tracker.baselineSamples.shift();
    tracker.baselineEar = tracker.baselineSamples.reduce((sum, value) => sum + value, 0) / tracker.baselineSamples.length;
    tracker.closeEarThreshold = Math.max(0.13, Math.min(0.23, tracker.baselineEar * BLINK_EAR_RATIO));
  }

  const earClosed = tracker.closeEarThreshold
    ? face.leftEar <= tracker.closeEarThreshold + 0.015 && face.rightEar <= tracker.closeEarThreshold + 0.015
    : false;
  const earOpen = tracker.closeEarThreshold
    ? face.leftEar >= tracker.closeEarThreshold + 0.035 && face.rightEar >= tracker.closeEarThreshold + 0.035
    : face.averageEar > 0.16;
  const closed = blendClosed || earClosed;
  const open = blendOpen && earOpen;

  if (tracker.state === "OPEN") {
    tracker.progress = tracker.baselineSamples.length >= 4 ? 0.35 : 0.12;
    if (closed && tracker.baselineSamples.length >= 4) {
      tracker.state = "CLOSED";
      tracker.closedStartedAt = timestamp;
      tracker.closedFrames = 1;
      tracker.progress = 0.7;
    }
    return tracker;
  }

  if (tracker.state === "CLOSED") {
    if (closed) tracker.closedFrames += 1;
    const duration = timestamp - tracker.closedStartedAt;
    if (duration > 900) {
      tracker.state = "OPEN";
      tracker.closedStartedAt = 0;
      tracker.closedFrames = 0;
      tracker.progress = 0.35;
      return tracker;
    }
    if (open && tracker.closedFrames >= 2 && duration >= 80) {
      tracker.state = "CONFIRMED";
      tracker.detected = true;
      tracker.progress = 1;
    }
  }

  return tracker;
}

function captureCurrentVideoFrame(video) {
  return captureVideoFrame(video, "selfie-verification.jpg");
}

function ProgressRing({ completedCount, currentProgress, complete }) {
  const percent = complete ? 100 : Math.min(100, ((completedCount + currentProgress) / 5) * 100);
  const angle = (percent / 100) * 360;
  return (
    <div className="retela-liveness-ring" style={{ "--retela-liveness-progress": `${angle}deg` }} aria-hidden="true">
      <div className="retela-liveness-orbit-dot" />
      {complete ? <div className="retela-liveness-check"><Check size={42} /></div> : null}
    </div>
  );
}

export default function FaceVerification({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const { landmarker, loading, error: modelError } = useFaceLandmarker();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const animationRef = useRef(0);
  const detectingRef = useRef(false);
  const stoppedRef = useRef(false);
  const hiddenRef = useRef(false);
  const lastDetectionRef = useRef(0);
  const previousFaceRef = useRef(null);
  const missingSinceRef = useRef(0);
  const sequenceRef = useRef(createLivenessSequence());
  const stepIndexRef = useRef(0);
  const stepValidSinceRef = useRef(0);
  const stepStartedAtRef = useRef(0);
  const retryCountsRef = useRef({});
  const neutralPoseRef = useRef(null);
  const blinkRef = useRef(createBlinkTracker());
  const captureLockRef = useRef(false);
  const successLockRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const successTimerRef = useRef(0);
  const bestFrameRef = useRef(null);
  const completedRef = useRef(new Set());
  const [ui, setUi] = useState({
    phase: selfiePreview && livenessVerified ? "success" : "starting",
    instruction: selfiePreview && livenessVerified ? "Face verified" : "Starting camera",
    guideState: selfiePreview && livenessVerified ? "success" : "scanning",
    completedCount: selfiePreview && livenessVerified ? 5 : 0,
    currentProgress: 0,
    currentStep: LIVENESS_STEPS.CENTER,
    retryVisible: false,
    error: ""
  });

  const currentStep = sequenceRef.current[stepIndexRef.current] || LIVENESS_STEPS.CENTER;
  const verified = Boolean(selfie && (livenessVerified || ui.phase === "success"));

  const publishUi = useCallback((updates) => {
    setUi((previous) => {
      const next = { ...previous, ...updates };
      return Object.keys(next).some((key) => next[key] !== previous[key]) ? next : previous;
    });
  }, []);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    window.cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    detectingRef.current = false;
    window.clearTimeout(successTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetVerification = useCallback(() => {
    sequenceRef.current = createLivenessSequence();
    stepIndexRef.current = 0;
    completedRef.current = new Set();
    stepValidSinceRef.current = 0;
    stepStartedAtRef.current = performance.now();
    missingSinceRef.current = 0;
    retryCountsRef.current = {};
    neutralPoseRef.current = null;
    previousFaceRef.current = null;
    blinkRef.current = createBlinkTracker();
    bestFrameRef.current = null;
    captureLockRef.current = false;
    successLockRef.current = false;
    publishUi({
      phase: "scanning",
      instruction: "Position your face inside the circle",
      guideState: "scanning",
      completedCount: 0,
      currentProgress: 0,
      currentStep: LIVENESS_STEPS.CENTER,
      retryVisible: false,
      error: ""
    });
  }, [publishUi]);

  const captureBestSelfie = useCallback(async () => {
    if (captureLockRef.current || !videoRef.current) return;
    captureLockRef.current = true;
    publishUi({ phase: "capturing", instruction: "Face verified", guideState: "success" });
    try {
      const raw = bestFrameRef.current || captureCurrentVideoFrame(videoRef.current);
      const compressed = await compressImage(raw, 1200, 0.86);
      const preview = URL.createObjectURL(compressed);
      stopCamera();
      onCaptured(compressed, preview, {
        blinkVerified: true,
        liveCapture: true,
        confidence: 1,
        livenessSequence: sequenceRef.current.join(",")
      });
      if (!successLockRef.current) {
        successLockRef.current = true;
        if (navigator.vibrate) navigator.vibrate(100);
        publishUi({ phase: "success", instruction: "Face verified", guideState: "success", completedCount: 5, currentProgress: 0 });
        successTimerRef.current = window.setTimeout(() => onNext(), SUCCESS_ADVANCE_MS);
      }
    } catch (captureError) {
      captureLockRef.current = false;
      publishUi({
        phase: "scanning",
        instruction: "Hold still",
        guideState: "warn",
        error: captureError?.message || "Capture failed. Please try again."
      });
    }
  }, [onCaptured, onNext, publishUi, stopCamera]);

  const openCamera = useCallback(async () => {
    stopCamera();
    stoppedRef.current = false;
    publishUi({ phase: "starting", instruction: "Starting camera", guideState: "scanning", error: "" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
        if (stoppedRef.current) return;
        if (restartAttemptsRef.current < CAMERA_RESTART_LIMIT) {
          restartAttemptsRef.current += 1;
          openCamera();
        } else {
          publishUi({ phase: "error", instruction: "Unable to start camera.", guideState: "error", retryVisible: true, error: "Camera stopped unexpectedly." });
        }
      }, { once: true }));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await waitForVideoMetadata(videoRef.current);
      }
      stepStartedAtRef.current = performance.now();
      publishUi({ phase: "loading", instruction: "Preparing verifier...", guideState: "scanning" });
    } catch (cameraError) {
      publishUi({ phase: "error", instruction: cameraErrorMessage(cameraError), guideState: "error", retryVisible: true, error: cameraErrorMessage(cameraError) });
    }
  }, [publishUi, stopCamera]);

  const handleStepComplete = useCallback((face) => {
    const step = sequenceRef.current[stepIndexRef.current];
    completedRef.current.add(step);
    if (step === LIVENESS_STEPS.CENTER) {
      neutralPoseRef.current = { yaw: face.yaw, pitch: face.pitch, roll: face.roll };
      bestFrameRef.current = captureCurrentVideoFrame(videoRef.current);
    }
    if (isBaseFaceValid(face) && Math.abs(face.yaw - (neutralPoseRef.current?.yaw || 0)) < 10 && Math.abs(face.pitch - (neutralPoseRef.current?.pitch || 0)) < 10) {
      bestFrameRef.current = captureCurrentVideoFrame(videoRef.current);
    }
    stepIndexRef.current += 1;
    stepValidSinceRef.current = 0;
    stepStartedAtRef.current = performance.now();
    if (stepIndexRef.current >= sequenceRef.current.length) {
      publishUi({ completedCount: 5, currentProgress: 0, instruction: "Face verified", guideState: "success", phase: "complete" });
      captureBestSelfie();
      return;
    }
    const nextStep = sequenceRef.current[stepIndexRef.current];
    publishUi({
      completedCount: completedRef.current.size,
      currentProgress: 0,
      currentStep: nextStep,
      instruction: STEP_LABELS[nextStep],
      guideState: "active",
      phase: "scanning",
      error: ""
    });
  }, [captureBestSelfie, publishUi]);

  const analyzeFrame = useCallback((timestamp) => {
    if (!landmarker || stoppedRef.current || hiddenRef.current || captureLockRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (detectingRef.current || timestamp - lastDetectionRef.current < DETECTION_INTERVAL_MS) return;

    detectingRef.current = true;
    lastDetectionRef.current = timestamp;
    try {
      const result = landmarker.detectForVideo(video, timestamp);
      const face = buildFacePose(result, video, frameCanvasRef.current, previousFaceRef.current);
      const now = performance.now();

      if (face.faceCount !== 1) {
        if (!missingSinceRef.current) missingSinceRef.current = now;
        if (now - missingSinceRef.current > FACE_MISSING_RESET_MS) resetVerification();
        stepValidSinceRef.current = 0;
        publishUi({
          instruction: face.faceCount > 1 ? "Only one person should be visible" : "Position your face inside the circle",
          guideState: face.faceCount > 1 ? "error" : "scanning",
          currentProgress: 0
        });
        return;
      }

      missingSinceRef.current = 0;
      previousFaceRef.current = face;
      const step = sequenceRef.current[stepIndexRef.current];
      const baseMessage = baseInstruction(face);
      const timedOut = now - stepStartedAtRef.current > STEP_TIMEOUT_MS;
      if (timedOut) {
        retryCountsRef.current[step] = (retryCountsRef.current[step] || 0) + 1;
        stepStartedAtRef.current = now;
        stepValidSinceRef.current = 0;
        publishUi({
          instruction: "Let's try that movement again",
          guideState: "warn",
          retryVisible: retryCountsRef.current[step] >= 2,
          currentProgress: 0
        });
        return;
      }

      if (baseMessage) {
        stepValidSinceRef.current = 0;
        publishUi({ instruction: baseMessage, guideState: "warn", currentProgress: 0 });
        return;
      }

      const blink = step === LIVENESS_STEPS.BLINK ? updateBlinkTracker(blinkRef, face, now) : blinkRef.current;
      const progress = movementProgress(step, face, neutralPoseRef.current, blink);
      const satisfied = isStepSatisfied(step, face, neutralPoseRef.current, blink);

      if (!satisfied) {
        stepValidSinceRef.current = 0;
        publishUi({
          instruction: STEP_LABELS[step],
          guideState: step === LIVENESS_STEPS.CENTER ? "scanning" : "active",
          currentProgress: progress,
          currentStep: step
        });
        return;
      }

      if (!stepValidSinceRef.current) stepValidSinceRef.current = now;
      const holdTime = step === LIVENESS_STEPS.CENTER ? CENTER_HOLD_MS : STEP_HOLD_MS;
      publishUi({
        instruction: step === LIVENESS_STEPS.BLINK ? "Blink once" : "Hold still",
        guideState: "ready",
        currentProgress: progress,
        currentStep: step
      });
      if (now - stepValidSinceRef.current >= holdTime) handleStepComplete(face);
    } catch (analysisError) {
      publishUi({ phase: "error", instruction: "Face verifier paused.", guideState: "error", retryVisible: true, error: analysisError?.message || "Face detection failed." });
    } finally {
      detectingRef.current = false;
    }
  }, [handleStepComplete, landmarker, publishUi, resetVerification]);

  const startLoop = useCallback(() => {
    window.cancelAnimationFrame(animationRef.current);
    const loop = (timestamp) => {
      analyzeFrame(timestamp);
      if (!stoppedRef.current) animationRef.current = window.requestAnimationFrame(loop);
    };
    animationRef.current = window.requestAnimationFrame(loop);
  }, [analyzeFrame]);

  useEffect(() => {
    frameCanvasRef.current ||= document.createElement("canvas");
    if (!selfiePreview) openCamera();
    return () => stopCamera();
  }, [openCamera, selfiePreview, stopCamera]);

  useEffect(() => {
    if (landmarker && streamRef.current && !selfiePreview) {
      publishUi({ phase: "scanning", instruction: STEP_LABELS[sequenceRef.current[stepIndexRef.current]], guideState: "scanning" });
      startLoop();
    }
  }, [landmarker, publishUi, selfiePreview, startLoop]);

  useEffect(() => {
    function handleVisibility() {
      hiddenRef.current = document.visibilityState === "hidden";
      if (hiddenRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      } else if (!stoppedRef.current && landmarker) {
        stepStartedAtRef.current = performance.now();
        startLoop();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [landmarker, startLoop]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleBack() {
    stopCamera();
    onBack();
  }

  function handleRetake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    onCaptured(null, "", { blinkVerified: false, liveCapture: false, confidence: 0 });
    restartAttemptsRef.current = 0;
    resetVerification();
    openCamera();
  }

  const activeInstruction = modelError || ui.error || (loading && !landmarker ? "Preparing verifier..." : ui.instruction);
  const complete = ui.phase === "success" || ui.phase === "complete" || verified;
  const progressText = `${Math.min(5, ui.completedCount)} / 5`;
  const currentStepLabel = STEP_LABELS[ui.currentStep] || "Face verified";
  const ringProgress = useMemo(() => complete ? 0 : ui.currentProgress, [complete, ui.currentProgress]);

  return (
    <div className="retela-wizard-step retela-faceid-shell retela-liveness-shell">
      <div className="retela-faceid-header">
        <button type="button" className="retela-faceid-back" onClick={handleBack} aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <div className="retela-faceid-title">
          <span>Face Verification</span>
          <strong>Step 2 of 5</strong>
        </div>
        <div className="retela-faceid-secure" aria-label="Secure verification">
          <ShieldCheck size={14} />
          <span>Secure</span>
        </div>
      </div>

      <ol className="retela-faceid-progress" aria-label="Registration progress">
        {["Personal Info", "Selfie", "Government ID", "OTP", "Completed"].map((step, index) => (
          <li key={step} className={index === 1 ? "is-active" : index < 1 ? "is-complete" : ""}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      <div className="retela-faceid-card retela-liveness-card">
        <div className="retela-liveness-camera" onContextMenu={(event) => event.preventDefault()}>
          {selfiePreview ? (
            <img src={selfiePreview} className="retela-camera-preview retela-selfie-preview" alt="Selfie verification preview" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview retela-camera-preview-live" aria-label="Live selfie camera" />
          )}
          <ProgressRing completedCount={ui.completedCount} currentProgress={ringProgress} complete={complete} />
        </div>

        <div className={`retela-faceid-instruction is-${ui.guideState}`} role="status" aria-live="polite">
          {loading && !landmarker ? <Loader2 className="animate-spin" size={18} /> : complete ? <CheckCircle2 size={18} /> : ui.guideState === "error" ? <TriangleAlert size={18} /> : <Camera size={18} />}
          <span>{complete ? "Face verified" : activeInstruction}</span>
          <strong>{complete ? "5 / 5" : progressText}</strong>
        </div>

        {!complete ? (
          <p className="retela-liveness-step-text">{currentStepLabel}</p>
        ) : null}

        {ui.retryVisible || modelError ? (
          <div className="retela-liveness-retry">
            {modelError ? <p className="retela-register-alert"><TriangleAlert size={16} /> {modelError}</p> : null}
            <Button type="button" variant="secondary" onClick={() => { resetVerification(); openCamera(); }}>
              <RotateCcw size={16} /> Restart verification
            </Button>
          </div>
        ) : null}

        <div className="retela-wizard-actions retela-faceid-actions">
          <Button type="button" variant="secondary" onClick={handleBack}>
            <ArrowLeft size={16} /> Back
          </Button>
          {selfie ? (
            <>
              <Button type="button" variant="secondary" onClick={handleRetake}><RotateCcw size={16} /> Recapture</Button>
              <Button type="button" disabled={!verified} onClick={onNext}>Continue</Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
