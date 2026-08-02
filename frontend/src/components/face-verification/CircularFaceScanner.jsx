import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Loader2, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useFaceLandmarker } from "../../hooks/useFaceLandmarker";
import { buildFacePose } from "../../utils/facePose";
import {
  CENTER_HOLD_MS,
  DETECTION_INTERVAL_MS,
  FACE_MISSING_RESET_MS,
  MULTIPLE_FACE_CONSECUTIVE_FRAMES,
  SCAN_REGION_HOLD_MS,
  STEP_TIMEOUT_MS,
  TARGET_LABELS,
  createScanState,
  instructionForFace,
  isRegionSatisfied,
  regionScore,
  scanProgress,
  targetInstruction
} from "../../utils/circularLiveness";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "../auth/imageTools";
import SegmentedProgressRing from "./SegmentedProgressRing";

const SUCCESS_ADVANCE_MS = 750;
const CAMERA_RESTART_LIMIT = 1;
const BLINK_CLOSE_THRESHOLD = 0.55;
const BLINK_OPEN_THRESHOLD = 0.25;
const EAR_CLOSE_RATIO = 0.72;

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
    }, 6000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to start camera."));
    };
    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("canplay", handleReady);
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
    state: "CALIBRATING",
    samples: [],
    baselineEar: 0,
    closeEarThreshold: 0,
    closedFrames: 0,
    closedAt: 0,
    detected: false
  };
}

function updateBlinkTracker(blinkRef, face, now) {
  const blink = blinkRef.current;
  if (blink.detected) return blink;

  const blendClosed = face.leftBlink >= BLINK_CLOSE_THRESHOLD && face.rightBlink >= BLINK_CLOSE_THRESHOLD;
  const blendOpen = face.leftBlink <= BLINK_OPEN_THRESHOLD && face.rightBlink <= BLINK_OPEN_THRESHOLD;

  if (blink.state === "CALIBRATING" || blink.state === "WAITING_CLOSE") {
    if (blendOpen && face.averageEar > 0.15) {
      blink.samples.push(face.averageEar);
      if (blink.samples.length > 14) blink.samples.shift();
      blink.baselineEar = blink.samples.reduce((sum, value) => sum + value, 0) / blink.samples.length;
      blink.closeEarThreshold = Math.max(0.13, Math.min(0.24, blink.baselineEar * EAR_CLOSE_RATIO));
      if (blink.samples.length >= 7) blink.state = "WAITING_CLOSE";
    }
  }

  const earClosed = blink.closeEarThreshold
    ? face.leftEar <= blink.closeEarThreshold + 0.015 && face.rightEar <= blink.closeEarThreshold + 0.015
    : false;
  const earOpen = blink.closeEarThreshold
    ? face.leftEar >= blink.closeEarThreshold + 0.035 && face.rightEar >= blink.closeEarThreshold + 0.035
    : face.averageEar > 0.16;

  if (blink.state === "WAITING_CLOSE" && (blendClosed || earClosed)) {
    blink.state = "WAITING_REOPEN";
    blink.closedFrames = 1;
    blink.closedAt = now;
    return blink;
  }

  if (blink.state === "WAITING_REOPEN") {
    const duration = now - blink.closedAt;
    if (blendClosed || earClosed) blink.closedFrames += 1;
    if (duration > 900) {
      blink.state = "WAITING_CLOSE";
      blink.closedFrames = 0;
      blink.closedAt = 0;
      return blink;
    }
    if (blink.closedFrames >= 2 && duration >= 70 && (blendOpen || earOpen)) {
      blink.state = "BLINK_CONFIRMED";
      blink.detected = true;
    }
  }

  return blink;
}

function faceFrameScore(face) {
  const frontal = 1 - Math.min(1, (Math.abs(face.yaw) + Math.abs(face.pitch) + Math.abs(face.roll)) / 45);
  const light = Math.min(1, face.brightness / 110);
  const sharpness = Math.min(1, face.blurScore / 14);
  return (frontal * 0.45) + (sharpness * 0.35) + (light * 0.2);
}

export default function CircularFaceScanner({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const { landmarker, loading, error: modelError } = useFaceLandmarker();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const qualityCanvasRef = useRef(null);
  const animationRef = useRef(0);
  const detectingRef = useRef(false);
  const stoppedRef = useRef(false);
  const hiddenRef = useRef(false);
  const previousFaceRef = useRef(null);
  const smoothedFaceRef = useRef(null);
  const lastDetectionRef = useRef(0);
  const missingSinceRef = useRef(0);
  const multipleFaceFramesRef = useRef(0);
  const scanRef = useRef(createScanState());
  const blinkRef = useRef(createBlinkTracker());
  const captureLockRef = useRef(false);
  const successLockRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const successTimerRef = useRef(0);
  const bestFrameRef = useRef(null);
  const bestFrameScoreRef = useRef(0);

  const [ui, setUi] = useState({
    phase: selfiePreview && livenessVerified ? "success" : "starting",
    instruction: selfiePreview && livenessVerified ? "Face verified" : "Starting camera",
    progress: selfiePreview && livenessVerified ? 1 : 0,
    currentScore: 0,
    target: "CENTER",
    retryVisible: false,
    error: ""
  });

  const complete = ui.phase === "success" || Boolean(selfie && livenessVerified);

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
    window.clearTimeout(successTimerRef.current);
    detectingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetScan = useCallback(() => {
    scanRef.current = createScanState();
    blinkRef.current = createBlinkTracker();
    previousFaceRef.current = null;
    smoothedFaceRef.current = null;
    missingSinceRef.current = 0;
    multipleFaceFramesRef.current = 0;
    bestFrameRef.current = null;
    bestFrameScoreRef.current = 0;
    captureLockRef.current = false;
    successLockRef.current = false;
    publishUi({
      phase: "scanning",
      instruction: "Position your face inside the circle",
      progress: 0,
      currentScore: 0,
      target: "CENTER",
      retryVisible: false,
      error: ""
    });
  }, [publishUi]);

  const openCamera = useCallback(async () => {
    stopCamera();
    stoppedRef.current = false;
    publishUi({ phase: "starting", instruction: "Starting camera", error: "", retryVisible: false });
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (stoppedRef.current) return;
          if (restartAttemptsRef.current < CAMERA_RESTART_LIMIT) {
            restartAttemptsRef.current += 1;
            openCamera();
            return;
          }
          publishUi({ phase: "error", instruction: "Unable to start camera.", error: "Camera stopped unexpectedly.", retryVisible: true });
        }, { once: true });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await waitForVideoMetadata(videoRef.current);
        await videoRef.current.play();
      }
      resetScan();
      publishUi({ phase: "loading", instruction: "Preparing verifier..." });
    } catch (cameraError) {
      publishUi({ phase: "error", instruction: cameraErrorMessage(cameraError), error: cameraErrorMessage(cameraError), retryVisible: true });
    }
  }, [publishUi, resetScan, stopCamera]);

  const captureFinalSelfie = useCallback(async () => {
    if (captureLockRef.current || !videoRef.current) return;
    captureLockRef.current = true;
    publishUi({ phase: "capturing", instruction: "Face verified", progress: 1, currentScore: 0 });
    try {
      const raw = bestFrameRef.current || captureVideoFrame(videoRef.current, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      const preview = URL.createObjectURL(compressed);
      const sequence = scanRef.current.route.join(",");
      const angleCount = scanRef.current.capturedAngles.length;
      stopCamera();
      onCaptured(compressed, preview, {
        blinkVerified: true,
        liveCapture: true,
        confidence: 1,
        livenessSequence: sequence,
        livenessFrameCount: angleCount
      });
      if (!successLockRef.current) {
        successLockRef.current = true;
        if (navigator.vibrate) navigator.vibrate(100);
        publishUi({ phase: "success", instruction: "Face verified", progress: 1, currentScore: 0 });
        successTimerRef.current = window.setTimeout(() => onNext(), SUCCESS_ADVANCE_MS);
      }
    } catch (captureError) {
      captureLockRef.current = false;
      publishUi({
        phase: "scanning",
        instruction: "Hold still",
        error: captureError?.message || "Capture failed. Please try again.",
        retryVisible: true
      });
    }
  }, [onCaptured, onNext, publishUi, stopCamera]);

  const rememberGoodFrame = useCallback((face, target) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    scanRef.current.capturedAngles.push({ target, yaw: face.yaw, pitch: face.pitch, roll: face.roll });
    const score = faceFrameScore(face);
    if (score >= bestFrameScoreRef.current || target === "CENTER_FINAL") {
      bestFrameScoreRef.current = score;
      bestFrameRef.current = captureVideoFrame(video, "selfie-verification.jpg");
    }
  }, []);

  const completeTarget = useCallback((face) => {
    const scan = scanRef.current;
    const target = scan.route[scan.index];
    scan.completed.add(target);
    rememberGoodFrame(face, target);

    if (target === "CENTER") {
      scan.neutralPose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll };
    }

    scan.index += 1;
    scan.targetValidSince = 0;
    scan.stepStartedAt = performance.now();

    if (scan.index >= scan.route.length) {
      captureFinalSelfie();
      return;
    }

    const nextTarget = scan.route[scan.index];
    publishUi({
      phase: "scanning",
      instruction: nextTarget === "LEFT" ? "Move your head slowly to complete the circle" : TARGET_LABELS[nextTarget],
      target: nextTarget,
      progress: scanProgress(scan.completed.size, 0),
      currentScore: 0,
      error: ""
    });
  }, [captureFinalSelfie, publishUi, rememberGoodFrame]);

  const smoothFace = useCallback((face) => {
    const previous = smoothedFaceRef.current;
    if (!previous || previous.faceCount !== 1 || face.faceCount !== 1) {
      smoothedFaceRef.current = face;
      return face;
    }
    const alpha = 0.34;
    const smoothed = {
      ...face,
      yaw: (previous.yaw * (1 - alpha)) + (face.yaw * alpha),
      pitch: (previous.pitch * (1 - alpha)) + (face.pitch * alpha),
      roll: (previous.roll * (1 - alpha)) + (face.roll * alpha),
      centerX: (previous.centerX * (1 - alpha)) + (face.centerX * alpha),
      centerY: (previous.centerY * (1 - alpha)) + (face.centerY * alpha)
    };
    smoothedFaceRef.current = smoothed;
    return smoothed;
  }, []);

  const analyzeFrame = useCallback((timestamp) => {
    if (!landmarker || stoppedRef.current || hiddenRef.current || captureLockRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (detectingRef.current || timestamp - lastDetectionRef.current < DETECTION_INTERVAL_MS) return;

    detectingRef.current = true;
    lastDetectionRef.current = timestamp;
    try {
      const result = landmarker.detectForVideo(video, timestamp);
      const rawFace = buildFacePose(result, video, qualityCanvasRef.current, previousFaceRef.current);
      const face = rawFace.faceCount === 1 ? smoothFace(rawFace) : rawFace;
      const now = performance.now();

      if (face.faceCount > 1) {
        multipleFaceFramesRef.current += 1;
      } else {
        multipleFaceFramesRef.current = 0;
      }
      const persistentMultipleFaces = multipleFaceFramesRef.current >= MULTIPLE_FACE_CONSECUTIVE_FRAMES;

      if (face.faceCount !== 1) {
        if (!missingSinceRef.current) missingSinceRef.current = now;
        if (now - missingSinceRef.current > FACE_MISSING_RESET_MS && face.faceCount < 1) scanRef.current.targetValidSince = 0;
        publishUi({
          phase: "scanning",
          instruction: instructionForFace(face, persistentMultipleFaces),
          progress: scanProgress(scanRef.current.completed.size, 0),
          currentScore: 0,
          error: persistentMultipleFaces ? "Only one person should be visible" : ""
        });
        return;
      }

      missingSinceRef.current = 0;
      previousFaceRef.current = face;

      const correctiveInstruction = instructionForFace(face, persistentMultipleFaces);
      if (correctiveInstruction || persistentMultipleFaces) {
        scanRef.current.targetValidSince = 0;
        publishUi({
          phase: "scanning",
          instruction: correctiveInstruction || "Only one person should be visible",
          progress: scanProgress(scanRef.current.completed.size, 0),
          currentScore: 0,
          error: persistentMultipleFaces ? "Only one person should be visible" : ""
        });
        return;
      }

      const scan = scanRef.current;
      const target = scan.route[scan.index];
      if (now - scan.stepStartedAt > STEP_TIMEOUT_MS) {
        scan.retryCount += 1;
        scan.targetValidSince = 0;
        scan.stepStartedAt = now;
        publishUi({
          phase: "scanning",
          instruction: "Let's try that movement again",
          progress: scanProgress(scan.completed.size, 0),
          currentScore: 0,
          retryVisible: scan.retryCount >= 2
        });
        return;
      }

      if (target !== "CENTER") updateBlinkTracker(blinkRef, face, now);
      const score = regionScore(target, face, scan.neutralPose);
      const satisfied = isRegionSatisfied(target, face, scan.neutralPose);
      const hasEnoughLiveness = target !== "CENTER_FINAL" || blinkRef.current.detected;

      if (!satisfied || !hasEnoughLiveness) {
        scan.targetValidSince = 0;
        publishUi({
          phase: "scanning",
          instruction: target === "CENTER_FINAL" && !blinkRef.current.detected ? "Blink once" : targetInstruction(target, scanProgress(scan.completed.size, score)),
          target,
          progress: scanProgress(scan.completed.size, score),
          currentScore: score,
          error: ""
        });
        return;
      }

      if (!scan.targetValidSince) scan.targetValidSince = now;
      const holdTime = target === "CENTER" || target === "CENTER_FINAL" ? CENTER_HOLD_MS : SCAN_REGION_HOLD_MS;
      publishUi({
        phase: "scanning",
        instruction: target === "CENTER" ? "Hold still" : "Keep going",
        target,
        progress: scanProgress(scan.completed.size, score),
        currentScore: score,
        error: ""
      });
      if (now - scan.targetValidSince >= holdTime) completeTarget(face);
    } catch (analysisError) {
      publishUi({ phase: "error", instruction: "Face verifier paused.", error: analysisError?.message || "Face detection failed.", retryVisible: true });
    } finally {
      detectingRef.current = false;
    }
  }, [completeTarget, landmarker, publishUi, smoothFace]);

  const startLoop = useCallback(() => {
    window.cancelAnimationFrame(animationRef.current);
    const loop = (timestamp) => {
      analyzeFrame(timestamp);
      if (!stoppedRef.current) animationRef.current = window.requestAnimationFrame(loop);
    };
    animationRef.current = window.requestAnimationFrame(loop);
  }, [analyzeFrame]);

  useEffect(() => {
    qualityCanvasRef.current ||= document.createElement("canvas");
    if (!selfiePreview) openCamera();
    return () => stopCamera();
  }, [openCamera, selfiePreview, stopCamera]);

  useEffect(() => {
    if (landmarker && streamRef.current && !selfiePreview && !captureLockRef.current) {
      publishUi({ phase: "scanning", instruction: "Position your face inside the circle" });
      startLoop();
    }
  }, [landmarker, publishUi, selfiePreview, startLoop]);

  useEffect(() => {
    function handleVisibility() {
      hiddenRef.current = document.visibilityState === "hidden";
      if (hiddenRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      } else if (!stoppedRef.current && landmarker && streamRef.current) {
        scanRef.current.stepStartedAt = performance.now();
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

  function handleCancel() {
    stopCamera();
    onBack();
  }

  function handleRestart() {
    restartAttemptsRef.current = 0;
    resetScan();
    openCamera();
  }

  function handleRetake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    onCaptured(null, "", { blinkVerified: false, liveCapture: false, confidence: 0 });
    handleRestart();
  }

  const activeMessage = useMemo(() => {
    if (modelError) return modelError;
    if (loading && !landmarker) return "Preparing verifier...";
    return ui.instruction;
  }, [landmarker, loading, modelError, ui.instruction]);

  return (
    <div className={`retela-face-scan-shell retela-face-scan-live${complete ? " is-complete" : ""}`}>
      <header className="retela-face-scan-topbar">
        <button type="button" className="retela-face-scan-text-button" onClick={handleCancel} aria-label="Cancel face verification">
          <ArrowLeft size={20} />
          <span>Cancel</span>
        </button>
        <div className="retela-face-scan-title">
          <span>Face Verification</span>
          <strong>Step 2 of 5</strong>
        </div>
        <div className="retela-face-scan-secure">
          <ShieldCheck size={15} />
          <span>Secure</span>
        </div>
      </header>

      <main className="retela-face-scan-main">
        <div className="retela-face-camera-wrap" onContextMenu={(event) => event.preventDefault()}>
          <div className="retela-face-camera-circle">
            {selfiePreview ? (
              <img src={selfiePreview} className="retela-face-camera-media" alt="Captured selfie preview" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="retela-face-camera-media is-live" aria-label="Live selfie camera" />
            )}
          </div>
          <SegmentedProgressRing
            progress={complete ? 1 : ui.progress}
            currentTargetProgress={complete ? 1 : ui.progress}
            complete={complete}
            error={ui.error && ui.phase === "error"}
          />
        </div>

        <section className="retela-face-scan-status" role="status" aria-live="polite">
          <div className="retela-face-scan-status-icon" aria-hidden="true">
            {loading && !landmarker ? <Loader2 className="animate-spin" size={22} /> : complete ? <CheckCircle2 size={24} /> : ui.phase === "error" || modelError ? <TriangleAlert size={23} /> : <Camera size={22} />}
          </div>
          <h1>{complete ? "Face verified" : activeMessage}</h1>
          <p>{complete ? "Continuing to the next step" : `${Math.min(scanRef.current.route.length, Math.round((complete ? 1 : ui.progress) * scanRef.current.route.length))} / ${scanRef.current.route.length}`}</p>
        </section>

        {ui.retryVisible || modelError ? (
          <div className="retela-face-scan-retry">
            <Button type="button" variant="secondary" onClick={handleRestart}>
              <RotateCcw size={16} /> Restart verification
            </Button>
          </div>
        ) : null}

        {selfie && !complete ? (
          <div className="retela-face-scan-preview-actions">
            <Button type="button" variant="secondary" onClick={handleRetake}>
              <RotateCcw size={16} /> Recapture
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
