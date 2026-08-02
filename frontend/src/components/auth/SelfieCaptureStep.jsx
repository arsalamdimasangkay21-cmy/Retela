import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, CheckCircle2, Loader2, LockKeyhole, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "./imageTools";

const MODEL_URL = "/models/face-api";
const DETECTION_INTERVAL_MS = 180;
const STABLE_CAPTURE_MS = 1500;
const COUNTDOWN_SECONDS = 3;
const CAMERA_RESTART_LIMIT = 1;
const FACE_DISTANCE_MIN = 0.23;
const FACE_DISTANCE_MAX = 0.58;
const CENTER_TOLERANCE_X = 0.13;
const CENTER_TOLERANCE_Y = 0.16;
const HEAD_TILT_MAX_DEGREES = 10;
const MIN_BRIGHTNESS = 55;
const MIN_BLUR_SCORE = 4.5;
const GUIDE_BOUNDS = { left: 0.18, top: 0.12, right: 0.82, bottom: 0.88 };

let faceapiModule;
let modelPromise;

async function loadLivenessModels() {
  faceapiModule ||= await import("face-api.js");
  const faceapi = faceapiModule;
  modelPromise ||= Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
  ]);
  await modelPromise;
  return faceapi;
}

function faceOptions(faceapi) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointCenter(points = []) {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function eyeAspectRatio(points = []) {
  if (points.length < 6) return 0;
  return (pointDistance(points[1], points[5]) + pointDistance(points[2], points[4])) / (2 * Math.max(pointDistance(points[0], points[3]), 1));
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission is required.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera detected.";
  if (error?.name === "NotReadableError") return "Camera is currently being used by another application.";
  return "Unable to start camera.";
}

function isMeaningfullyDifferent(previous, next) {
  return Object.keys(next).some((key) => previous[key] !== next[key]);
}

function getFrameMetrics(video, canvas) {
  const width = 48;
  const height = 36;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Array(width * height);
  let brightness = 0;

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[pixel] = luminance;
    brightness += luminance;
  }

  brightness /= gray.length;

  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian = Math.abs((gray[index] * 4) - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width]);
      edgeTotal += laplacian;
      edgeCount += 1;
    }
  }

  return {
    brightness,
    blurScore: edgeCount ? edgeTotal / edgeCount : 0
  };
}

function buildFaceQuality(video, detection, previousFrame) {
  const box = detection.detection.box;
  const landmarks = detection.landmarks;
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();
  const mouth = landmarks.getMouth();
  const leftEyeCenter = pointCenter(leftEye);
  const rightEyeCenter = pointCenter(rightEye);
  const eyeMidpoint = {
    x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
    y: (leftEyeCenter.y + rightEyeCenter.y) / 2
  };
  const noseTip = nose[nose.length - 1] || eyeMidpoint;
  const mouthCenter = pointCenter(mouth);
  const leftEar = eyeAspectRatio(leftEye);
  const rightEar = eyeAspectRatio(rightEye);
  const ear = (leftEar + rightEar) / 2;
  const eyeDistance = pointDistance(leftEyeCenter, rightEyeCenter);
  const eyeAngle = Math.abs(Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x) * 180 / Math.PI);
  const videoWidth = Math.max(video.videoWidth, 1);
  const videoHeight = Math.max(video.videoHeight, 1);
  const faceCenterX = (box.x + box.width / 2) / videoWidth;
  const faceCenterY = (box.y + box.height / 2) / videoHeight;
  const faceRatio = box.width / videoWidth;
  const insideGuide = (
    faceCenterX >= GUIDE_BOUNDS.left &&
    faceCenterX <= GUIDE_BOUNDS.right &&
    faceCenterY >= GUIDE_BOUNDS.top &&
    faceCenterY <= GUIDE_BOUNDS.bottom
  );
  const centered = Math.abs(faceCenterX - 0.5) <= CENTER_TOLERANCE_X && Math.abs(faceCenterY - 0.5) <= CENTER_TOLERANCE_Y;
  const lookingForward = Math.abs(noseTip.x - eyeMidpoint.x) / Math.max(box.width, 1) <= 0.16;
  const eyesVisible = leftEye.length >= 6 && rightEye.length >= 6 && eyeDistance / Math.max(box.width, 1) > 0.22 && ear > 0.09;
  const partiallyHidden = (
    mouthCenter.y <= noseTip.y ||
    box.x < 2 ||
    box.y < 2 ||
    box.x + box.width > videoWidth - 2 ||
    box.y + box.height > videoHeight - 2
  );
  const now = performance.now();
  const movement = previousFrame?.time
    ? Math.hypot(faceCenterX - previousFrame.centerX, faceCenterY - previousFrame.centerY) / Math.max((now - previousFrame.time) / 1000, 0.1)
    : 0;

  return {
    box,
    centerX: faceCenterX,
    centerY: faceCenterY,
    ear,
    eyesVisible,
    faceRatio,
    headStraight: eyeAngle <= HEAD_TILT_MAX_DEGREES,
    insideGuide,
    centered,
    lookingForward,
    movement,
    partiallyHidden,
    score: detection.detection.score,
    time: now
  };
}

function resetBlink(blinkRef) {
  blinkRef.current = {
    baseline: 0,
    openFrames: 0,
    closedSeen: false,
    detected: false
  };
}

function updateBlinkState(blinkRef, ear) {
  const blink = blinkRef.current;
  if (ear > 0.22) {
    blink.openFrames += 1;
    blink.baseline = blink.baseline ? (blink.baseline * 0.82) + (ear * 0.18) : ear;
  }

  if (blink.openFrames < 3 || !blink.baseline) return blink.detected;

  const closedThreshold = Math.min(0.2, blink.baseline * 0.72);
  const reopenedThreshold = blink.baseline * 0.88;

  // Blink detection watches for a normal open, closed, open sequence after the face is already aligned.
  if (!blink.closedSeen && ear < closedThreshold) {
    blink.closedSeen = true;
  } else if (blink.closedSeen && ear > reopenedThreshold) {
    blink.detected = true;
  }

  return blink.detected;
}

const progressSteps = ["Personal Info", "Selfie", "Government ID", "OTP", "Completed"];

export default function SelfieCaptureStep({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const metricsCanvasRef = useRef(null);
  const animationRef = useRef(0);
  const lastDetectionTimeRef = useRef(0);
  const detectionRunningRef = useRef(false);
  const detectionLoopActiveRef = useRef(false);
  const stoppedRef = useRef(false);
  const captureLockRef = useRef(false);
  const successLockRef = useRef(false);
  const restartAttemptsRef = useRef(0);
  const stabilityStartRef = useRef(0);
  const countdownTimerRef = useRef(0);
  const countdownActiveRef = useRef(false);
  const countdownValueRef = useRef(0);
  const successTimerRef = useRef(0);
  const previousFrameRef = useRef(null);
  const latestConfidenceRef = useRef(0);
  const openCameraRef = useRef(null);
  const analyzeFrameRef = useRef(null);
  const hasVerifiedPreview = Boolean(selfiePreview && livenessVerified);
  const blinkRef = useRef({
    baseline: 0,
    openFrames: 0,
    closedSeen: false,
    detected: Boolean(livenessVerified)
  });
  const [ui, setUi] = useState({
    phase: hasVerifiedPreview ? "success" : "starting",
    instruction: hasVerifiedPreview ? "Verification Successful" : selfiePreview ? "Recapture your selfie" : "Starting camera",
    guideState: hasVerifiedPreview ? "success" : selfiePreview ? "warn" : "scanning",
    countdown: 0,
    confidence: 0,
    busy: !selfiePreview,
    error: "",
    restartable: false
  });

  const publishUi = useCallback((updates) => {
    setUi((previous) => {
      if (!isMeaningfullyDifferent(previous, updates)) return previous;
      return { ...previous, ...updates };
    });
  }, []);

  const clearCountdown = useCallback(() => {
    window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = 0;
    countdownActiveRef.current = false;
    countdownValueRef.current = 0;
  }, []);

  const releaseCameraStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    // Cleanup must cancel the camera, the detection loop, and every pending timer.
    stoppedRef.current = true;
    detectionLoopActiveRef.current = false;
    window.cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    clearCountdown();
    window.clearTimeout(successTimerRef.current);
    releaseCameraStream();
  }, [clearCountdown, releaseCameraStream]);

  const captureSelfie = useCallback(async (finalConfidence = latestConfidenceRef.current) => {
    // The capture lock prevents the countdown, a late frame, or StrictMode from submitting twice.
    if (!videoRef.current || captureLockRef.current) return;
    captureLockRef.current = true;
    clearCountdown();
    publishUi({
      phase: "verifying",
      instruction: "Verifying your face...",
      guideState: "ready",
      countdown: 0,
      busy: true,
      error: "",
      restartable: false
    });

    try {
      const raw = captureVideoFrame(videoRef.current, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      const preview = URL.createObjectURL(compressed);
      stopCamera();
      onCaptured(compressed, preview, {
        blinkVerified: true,
        liveCapture: true,
        confidence: finalConfidence
      });

      if (!successLockRef.current) {
        successLockRef.current = true;
        if (navigator.vibrate) navigator.vibrate(100);
        publishUi({
          phase: "success",
          instruction: "Verification Successful",
          guideState: "success",
          busy: false,
          confidence: Math.round(finalConfidence * 100)
        });
        successTimerRef.current = window.setTimeout(() => onNext(), 1000);
      }
    } catch (error) {
      captureLockRef.current = false;
      publishUi({
        phase: "error",
        instruction: "We could not verify your identity. Please try again.",
        guideState: "error",
        busy: false,
        error: error?.message || "Descriptor generation failed.",
        restartable: true
      });
    }
  }, [clearCountdown, onCaptured, onNext, publishUi, stopCamera]);

  const startCountdown = useCallback(() => {
    if (countdownActiveRef.current || captureLockRef.current) return;
    countdownActiveRef.current = true;
    countdownValueRef.current = COUNTDOWN_SECONDS;
    publishUi({ countdown: COUNTDOWN_SECONDS, instruction: "Hold still", guideState: "ready" });

    const tick = () => {
      countdownTimerRef.current = window.setTimeout(() => {
        if (!countdownActiveRef.current || captureLockRef.current) return;
        countdownValueRef.current -= 1;
        if (countdownValueRef.current <= 0) {
          publishUi({ countdown: 0 });
          captureSelfie(latestConfidenceRef.current);
          return;
        }
        publishUi({ countdown: countdownValueRef.current, instruction: "Hold still", guideState: "ready" });
        tick();
      }, 1000);
    };

    tick();
  }, [captureSelfie, publishUi]);

  const cancelReadyState = useCallback(() => {
    stabilityStartRef.current = 0;
    clearCountdown();
  }, [clearCountdown]);

  const startDetectionLoop = useCallback(() => {
    if (detectionLoopActiveRef.current || captureLockRef.current || selfiePreview) return;
    detectionLoopActiveRef.current = true;

    const loop = async (timestamp) => {
      if (!detectionLoopActiveRef.current || stoppedRef.current || captureLockRef.current) return;

      if (!detectionRunningRef.current && timestamp - lastDetectionTimeRef.current >= DETECTION_INTERVAL_MS) {
        detectionRunningRef.current = true;
        lastDetectionTimeRef.current = timestamp;
        try {
          await analyzeFrameRef.current?.(timestamp);
        } finally {
          detectionRunningRef.current = false;
        }
      }

      animationRef.current = window.requestAnimationFrame(loop);
    };

    animationRef.current = window.requestAnimationFrame(loop);
  }, [selfiePreview]);

  const handleTrackEnded = useCallback(() => {
    if (stoppedRef.current) return;
    if (restartAttemptsRef.current < CAMERA_RESTART_LIMIT) {
      restartAttemptsRef.current += 1;
      window.setTimeout(() => openCameraRef.current?.(), 250);
      return;
    }

    publishUi({
      phase: "error",
      instruction: "Unable to start camera.",
      guideState: "error",
      busy: false,
      error: "Camera stopped unexpectedly.",
      restartable: true
    });
  }, [publishUi]);

  const openCamera = useCallback(async () => {
    // Camera initialization keeps the front camera active and mirrors only the visual preview.
    stoppedRef.current = true;
    detectionLoopActiveRef.current = false;
    window.cancelAnimationFrame(animationRef.current);
    clearCountdown();
    releaseCameraStream();
    stoppedRef.current = false;
    captureLockRef.current = false;
    successLockRef.current = false;
    previousFrameRef.current = null;
    latestConfidenceRef.current = 0;
    stabilityStartRef.current = 0;
    if (!livenessVerified) resetBlink(blinkRef);
    publishUi({
      phase: "starting",
      instruction: "Starting camera",
      guideState: "scanning",
      countdown: 0,
      confidence: 0,
      busy: true,
      error: "",
      restartable: false
    });

    try {
      await loadLivenessModels();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", handleTrackEnded, { once: true }));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      publishUi({ phase: "scanning", instruction: "Center your face", guideState: "scanning", busy: false });
      startDetectionLoop();
    } catch (error) {
      publishUi({
        phase: "error",
        instruction: cameraErrorMessage(error),
        guideState: "error",
        busy: false,
        error: cameraErrorMessage(error),
        restartable: true
      });
    }
  }, [clearCountdown, handleTrackEnded, livenessVerified, publishUi, releaseCameraStream, startDetectionLoop]);

  openCameraRef.current = openCamera;

  useEffect(() => {
    metricsCanvasRef.current ||= document.createElement("canvas");

    analyzeFrameRef.current = async (timestamp) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || selfiePreview) return;

      try {
        const faceapi = faceapiModule || await loadLivenessModels();
        const detections = await faceapi.detectAllFaces(video, faceOptions(faceapi)).withFaceLandmarks();
        if (stoppedRef.current || captureLockRef.current) return;

        if (detections.length > 1) {
          resetBlink(blinkRef);
          previousFrameRef.current = null;
          cancelReadyState();
          publishUi({ phase: "scanning", instruction: "Only one face is allowed", guideState: "error", confidence: 0, error: "" });
          return;
        }

        if (!detections.length) {
          resetBlink(blinkRef);
          previousFrameRef.current = null;
          cancelReadyState();
          publishUi({ phase: "scanning", instruction: "No face detected", guideState: "scanning", confidence: 0, error: "" });
          return;
        }

        const quality = buildFaceQuality(video, detections[0], previousFrameRef.current);
        previousFrameRef.current = quality;
        latestConfidenceRef.current = quality.score;
        const metrics = getFrameMetrics(video, metricsCanvasRef.current);
        const facePositionValid = quality.insideGuide && quality.centered && quality.faceRatio >= FACE_DISTANCE_MIN && quality.faceRatio <= FACE_DISTANCE_MAX;
        const blinkDetected = livenessVerified || updateBlinkState(blinkRef, quality.ear);

        let next = { phase: "scanning", instruction: "Ready", guideState: "ready", confidence: Math.round(quality.score * 100), error: "" };
        let validForCountdown = false;

        // Guide validation follows the same priority as the single live instruction text.
        if (!quality.insideGuide) {
          next = { ...next, instruction: "Face outside guide", guideState: "warn" };
        } else if (quality.faceRatio < FACE_DISTANCE_MIN) {
          next = { ...next, instruction: "Move closer", guideState: "warn" };
        } else if (quality.faceRatio > FACE_DISTANCE_MAX) {
          next = { ...next, instruction: "Move farther", guideState: "warn" };
        } else if (!quality.centered) {
          next = { ...next, instruction: "Center your face", guideState: "warn" };
        } else if (!quality.lookingForward) {
          next = { ...next, instruction: "Look directly at the camera", guideState: "warn" };
        } else if (!quality.headStraight) {
          next = { ...next, instruction: "Keep your head straight", guideState: "warn" };
        } else if (metrics.brightness < MIN_BRIGHTNESS) {
          next = { ...next, instruction: "Increase lighting", guideState: "warn" };
        } else if (!quality.eyesVisible) {
          next = { ...next, instruction: "Remove sunglasses", guideState: "warn" };
        } else if (quality.partiallyHidden) {
          next = { ...next, instruction: "Face partially hidden", guideState: "warn" };
        } else if (metrics.blurScore < MIN_BLUR_SCORE || quality.movement > 0.38) {
          next = { ...next, instruction: "Hold still", guideState: "warn" };
        } else if (!blinkDetected && facePositionValid) {
          next = { ...next, instruction: "Blink once", guideState: "warn" };
        } else {
          validForCountdown = true;
          next = { ...next, instruction: "Hold still", guideState: "ready" };
        }

        if (!validForCountdown) {
          cancelReadyState();
          if (!facePositionValid) resetBlink(blinkRef);
          publishUi({ ...next, countdown: 0 });
          return;
        }

        if (!stabilityStartRef.current) stabilityStartRef.current = timestamp;
        publishUi(next);

        if (timestamp - stabilityStartRef.current >= STABLE_CAPTURE_MS) {
          startCountdown();
        }
      } catch (error) {
        cancelReadyState();
        publishUi({
          phase: "error",
          instruction: "Models failed to load",
          guideState: "error",
          busy: false,
          error: error?.message || "Face detection failed.",
          restartable: true
        });
      }
    };
  }, [cancelReadyState, livenessVerified, publishUi, selfiePreview, startCountdown]);

  useEffect(() => {
    if (!selfiePreview) openCamera();
    return () => stopCamera();
  }, [openCamera, selfiePreview, stopCamera]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const releaseOnPageExit = () => stopCamera();
    const releaseOnHidden = () => {
      if (document.hidden) stopCamera();
    };
    window.addEventListener("beforeunload", releaseOnPageExit);
    document.addEventListener("visibilitychange", releaseOnHidden);
    return () => {
      window.removeEventListener("beforeunload", releaseOnPageExit);
      document.removeEventListener("visibilitychange", releaseOnHidden);
    };
  }, [stopCamera]);

  function retake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    onCaptured(null, "", { blinkVerified: false, liveCapture: false, confidence: 0 });
    restartAttemptsRef.current = 0;
  }

  const verified = Boolean(selfie && (livenessVerified || ui.phase === "success"));
  const showSuccess = ui.phase === "success" || (selfiePreview && verified);

  return (
    <div className="retela-wizard-step retela-faceid-shell">
      <div className="retela-faceid-header">
        <button type="button" className="retela-faceid-back" onClick={onBack} aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <div className="retela-faceid-title">
          <span>Face Verification</span>
          <strong>Step 2 of 5</strong>
        </div>
        <div className="retela-faceid-secure" aria-label="Secure verification">
          <LockKeyhole size={14} />
          <span>Secure</span>
        </div>
      </div>

      <ol className="retela-faceid-progress" aria-label="Registration progress">
        {progressSteps.map((step, index) => (
          <li key={step} className={index === 1 ? "is-active" : index < 1 ? "is-complete" : ""}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      <div className="retela-faceid-card">
        <div className="retela-selfie-stage">
          <div className={`retela-selfie-camera-wrap retela-faceid-camera is-${ui.guideState}`} onContextMenu={(event) => event.preventDefault()}>
            {selfiePreview ? (
              <img src={selfiePreview} className="retela-camera-preview retela-selfie-preview" alt="Selfie verification preview" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview retela-camera-preview-live" aria-label="Live selfie camera" />
            )}
            <div className={`retela-faceid-guide is-${ui.guideState}`} aria-hidden="true">
              {ui.countdown ? <span className="retela-faceid-countdown">{ui.countdown}</span> : null}
              {showSuccess ? (
                <span className="retela-faceid-success-check">
                  <Check size={52} />
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`retela-faceid-instruction is-${ui.guideState}`} role="status" aria-live="polite">
          {ui.busy ? <Loader2 className="animate-spin" size={18} /> : showSuccess ? <CheckCircle2 size={18} /> : ui.guideState === "error" ? <TriangleAlert size={18} /> : <ShieldCheck size={18} />}
          <span>{showSuccess ? "Verification Successful" : ui.instruction}</span>
          {ui.confidence ? <strong>{ui.confidence}%</strong> : null}
        </div>

        {ui.error ? <p className="retela-register-alert"><TriangleAlert size={16} /> {ui.error}</p> : null}

        <div className="retela-wizard-actions retela-faceid-actions">
          <Button type="button" variant="secondary" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </Button>
          {selfie ? (
            <>
              <Button type="button" variant="secondary" onClick={retake}><RotateCcw size={16} /> Recapture</Button>
              <Button type="button" disabled={!verified} onClick={onNext}>Continue</Button>
            </>
          ) : ui.restartable ? (
            <Button type="button" onClick={openCamera}><Camera size={16} /> Restart Camera</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
