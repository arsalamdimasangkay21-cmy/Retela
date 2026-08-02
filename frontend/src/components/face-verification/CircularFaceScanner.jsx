import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "../auth/imageTools";
import SegmentedProgressRing from "./SegmentedProgressRing";

const MODEL_URL = "/models/face-api";
const SUCCESS_ADVANCE_MS = 700;
const DETECTION_INTERVAL_MS = 250;
const CENTER_HOLD_MS = 450;
const CAPTURE_HOLD_MS = 350;
const BLINK_MIN_CLOSED_FRAMES = 2;
const BLINK_MAX_DURATION_MS = 900;
const TINY_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 160,
  scoreThreshold: 0.45
});

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 480 },
    height: { ideal: 640 },
    frameRate: { ideal: 24, max: 30 }
  }
};

let liveModelPromise;

function loadLiveFaceModels() {
  liveModelPromise ||= Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
  ]);
  return liveModelPromise;
}

function waitForVideoReady(video) {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera is taking too long to start."));
    }, 7000);

    function cleanup() {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    }

    function handleReady() {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(new Error("Unable to start camera."));
    }

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission is required.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera detected.";
  if (error?.name === "NotReadableError") return "Camera is currently being used by another application.";
  return error?.message || "Unable to start camera.";
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(points = []) {
  if (points.length < 6) return 0;
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * Math.max(distance(points[0], points[3]), 1));
}

function createBlinkState() {
  return {
    phase: "CALIBRATING",
    samples: [],
    baselineEar: 0,
    closeThreshold: 0.18,
    openThreshold: 0.21,
    closedFrames: 0,
    closedAt: 0,
    detected: false
  };
}

function updateBlink(blink, landmarks, now) {
  if (blink.detected) return blink;

  const leftEar = eyeAspectRatio(landmarks.getLeftEye());
  const rightEar = eyeAspectRatio(landmarks.getRightEye());
  const averageEar = (leftEar + rightEar) / 2;

  if (blink.phase === "CALIBRATING") {
    if (averageEar > 0.16) {
      blink.samples.push(averageEar);
      if (blink.samples.length > 10) blink.samples.shift();
      blink.baselineEar = blink.samples.reduce((sum, value) => sum + value, 0) / blink.samples.length;
      blink.closeThreshold = Math.max(0.15, Math.min(0.26, blink.baselineEar * 0.72));
      blink.openThreshold = blink.closeThreshold + 0.025;
      if (blink.samples.length >= 4) blink.phase = "WAITING_CLOSE";
    }
    return blink;
  }

  const bothEyesClosed = leftEar <= blink.closeThreshold && rightEar <= blink.closeThreshold + 0.015;
  const bothEyesOpen = leftEar >= blink.openThreshold && rightEar >= blink.openThreshold;

  if (blink.phase === "WAITING_CLOSE") {
    if (bothEyesClosed) {
      blink.phase = "WAITING_REOPEN";
      blink.closedFrames = 1;
      blink.closedAt = now;
    }
    return blink;
  }

  if (blink.phase === "WAITING_REOPEN") {
    const duration = now - blink.closedAt;
    if (bothEyesClosed) blink.closedFrames += 1;
    if (duration > BLINK_MAX_DURATION_MS) {
      blink.phase = "WAITING_CLOSE";
      blink.closedFrames = 0;
      blink.closedAt = 0;
      return blink;
    }
    if (blink.closedFrames >= BLINK_MIN_CLOSED_FRAMES && bothEyesOpen) {
      blink.phase = "BLINK_CONFIRMED";
      blink.detected = true;
    }
  }

  return blink;
}

function analyzeFace(detection, video) {
  const box = detection.detection.box;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const offsetX = Math.abs(centerX - video.videoWidth / 2) / video.videoWidth;
  const offsetY = Math.abs(centerY - video.videoHeight / 2) / video.videoHeight;
  const widthRatio = box.width / video.videoWidth;

  if (widthRatio < 0.28) return { valid: false, message: "Move a little closer" };
  if (widthRatio > 0.78) return { valid: false, message: "Move slightly farther away" };
  if (offsetX > 0.18 || offsetY > 0.2) return { valid: false, message: "Center your face" };

  return { valid: true, message: "Blink once" };
}

export default function CircularFaceScanner({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const lastDetectionRef = useRef(0);
  const processingRef = useRef(false);
  const stoppedRef = useRef(false);
  const modelReadyRef = useRef(false);
  const centeredSinceRef = useRef(0);
  const readySinceRef = useRef(0);
  const blinkRef = useRef(createBlinkState());
  const captureLockRef = useRef(false);
  const successLockRef = useRef(false);
  const successTimerRef = useRef(0);

  const [ui, setUi] = useState({
    phase: selfiePreview && livenessVerified ? "success" : "starting",
    instruction: selfiePreview && livenessVerified ? "Face verified" : "Position your face inside the circle",
    progress: selfiePreview && livenessVerified ? 1 : 0,
    error: "",
    retryVisible: false
  });

  const complete = ui.phase === "success" || Boolean(selfie && livenessVerified);

  const publishUi = useCallback((updates) => {
    setUi((previous) => {
      const next = { ...previous, ...updates };
      return Object.keys(next).some((key) => next[key] !== previous[key]) ? next : previous;
    });
  }, []);

  const stopAll = useCallback(() => {
    stoppedRef.current = true;
    window.cancelAnimationFrame(frameRef.current);
    window.clearTimeout(successTimerRef.current);
    frameRef.current = 0;
    processingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetLiveState = useCallback(() => {
    centeredSinceRef.current = 0;
    readySinceRef.current = 0;
    blinkRef.current = createBlinkState();
    captureLockRef.current = false;
    successLockRef.current = false;
    publishUi({
      phase: "scanning",
      instruction: modelReadyRef.current ? "Position your face inside the circle" : "Loading verifier while camera starts...",
      progress: 0,
      error: "",
      retryVisible: false
    });
  }, [publishUi]);

  const captureFinalSelfie = useCallback(async () => {
    const video = videoRef.current;
    if (captureLockRef.current || !video || video.readyState < 2) return;

    captureLockRef.current = true;
    publishUi({ phase: "capturing", instruction: "Capturing...", progress: 1, error: "" });
    try {
      const raw = captureVideoFrame(video, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      const preview = URL.createObjectURL(compressed);
      stopAll();
      onCaptured(compressed, preview, {
        blinkVerified: true,
        liveCapture: true,
        confidence: 0.95
      });
      if (!successLockRef.current) {
        successLockRef.current = true;
        if (navigator.vibrate) navigator.vibrate(100);
        publishUi({ phase: "success", instruction: "Face verified", progress: 1 });
        successTimerRef.current = window.setTimeout(() => onNext(), SUCCESS_ADVANCE_MS);
      }
    } catch (error) {
      captureLockRef.current = false;
      publishUi({
        phase: "scanning",
        instruction: "Hold still",
        error: error?.message || "Capture failed. Please try again.",
        retryVisible: true
      });
    }
  }, [onCaptured, onNext, publishUi, stopAll]);

  const analyzeFrame = useCallback(async (timestamp) => {
    const video = videoRef.current;
    if (
      stoppedRef.current ||
      !modelReadyRef.current ||
      captureLockRef.current ||
      processingRef.current ||
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      timestamp - lastDetectionRef.current < DETECTION_INTERVAL_MS
    ) {
      return;
    }

    processingRef.current = true;
    lastDetectionRef.current = timestamp;

    try {
      const detections = await faceapi.detectAllFaces(video, TINY_OPTIONS).withFaceLandmarks();
      const strongDetections = detections.filter((item) => {
        const box = item.detection.box;
        const score = item.detection.score || 0;
        const widthRatio = box.width / Math.max(video.videoWidth, 1);
        return score >= 0.45 && widthRatio >= 0.18;
      });

      if (strongDetections.length > 1) {
        centeredSinceRef.current = 0;
        readySinceRef.current = 0;
        publishUi({ phase: "scanning", instruction: "Only one person should be visible", progress: 0.05, error: "" });
        return;
      }

      if (strongDetections.length !== 1) {
        centeredSinceRef.current = 0;
        readySinceRef.current = 0;
        blinkRef.current = createBlinkState();
        publishUi({ phase: "scanning", instruction: "Position your face inside the circle", progress: 0.05, error: "" });
        return;
      }

      const face = strongDetections[0];
      const faceState = analyzeFace(face, video);
      if (!faceState.valid) {
        centeredSinceRef.current = 0;
        readySinceRef.current = 0;
        publishUi({ phase: "scanning", instruction: faceState.message, progress: 0.18, error: "" });
        return;
      }

      if (!centeredSinceRef.current) centeredSinceRef.current = timestamp;
      if (timestamp - centeredSinceRef.current < CENTER_HOLD_MS) {
        publishUi({ phase: "scanning", instruction: "Hold still", progress: 0.36, error: "" });
        return;
      }

      updateBlink(blinkRef.current, face.landmarks, timestamp);
      if (!blinkRef.current.detected) {
        publishUi({
          phase: "scanning",
          instruction: blinkRef.current.phase === "CALIBRATING" ? "Open your eyes normally" : "Blink once",
          progress: 0.62,
          error: ""
        });
        return;
      }

      if (!readySinceRef.current) readySinceRef.current = timestamp;
      publishUi({ phase: "scanning", instruction: "Blink detected. Capturing...", progress: 0.9, error: "" });
      if (timestamp - readySinceRef.current >= CAPTURE_HOLD_MS) captureFinalSelfie();
    } catch (error) {
      publishUi({
        phase: "error",
        instruction: "Face verifier paused. Tap Retry.",
        error: error?.message || "Face detection failed.",
        retryVisible: true
      });
    } finally {
      processingRef.current = false;
    }
  }, [captureFinalSelfie, publishUi]);

  const startLoop = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    const loop = (timestamp) => {
      analyzeFrame(timestamp);
      if (!stoppedRef.current) frameRef.current = window.requestAnimationFrame(loop);
    };
    frameRef.current = window.requestAnimationFrame(loop);
  }, [analyzeFrame]);

  const openCamera = useCallback(async () => {
    stopAll();
    stoppedRef.current = false;
    resetLiveState();

    try {
      const video = videoRef.current;
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;

      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (!stoppedRef.current) publishUi({ phase: "error", instruction: "Camera stopped. Tap Retry.", retryVisible: true });
        }, { once: true });
      });

      if (video) {
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.srcObject = stream;
        await video.play();
        await waitForVideoReady(video);
      }

      publishUi({ phase: "scanning", instruction: "Position your face inside the circle", error: "" });
      startLoop();
    } catch (error) {
      publishUi({ phase: "error", instruction: cameraErrorMessage(error), error: cameraErrorMessage(error), retryVisible: true });
    }
  }, [publishUi, resetLiveState, startLoop, stopAll]);

  useEffect(() => {
    let cancelled = false;
    modelReadyRef.current = false;
    publishUi({ instruction: "Loading verifier while camera starts..." });
    loadLiveFaceModels()
      .then(() => {
        if (cancelled) return;
        modelReadyRef.current = true;
        publishUi({ instruction: "Position your face inside the circle" });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Face verifier model failed to load", error);
        publishUi({ phase: "error", instruction: "Face verification could not start. Tap Retry.", error: "Models failed to load.", retryVisible: true });
      });
    return () => {
      cancelled = true;
    };
  }, [publishUi]);

  useEffect(() => {
    if (!selfiePreview) openCamera();
    return () => stopAll();
  }, [openCamera, selfiePreview, stopAll]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        window.cancelAnimationFrame(frameRef.current);
      } else if (!stoppedRef.current && streamRef.current) {
        lastDetectionRef.current = 0;
        startLoop();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [startLoop]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleCancel() {
    stopAll();
    onBack();
  }

  function handleRestart() {
    if (!modelReadyRef.current) {
      publishUi({ phase: "starting", instruction: "Loading verifier while camera starts...", error: "", retryVisible: false });
      loadLiveFaceModels()
        .then(() => {
          modelReadyRef.current = true;
          publishUi({ phase: "scanning", instruction: "Position your face inside the circle", error: "", retryVisible: false });
        })
        .catch((error) => {
          console.error("Face verifier model failed to load", error);
          publishUi({ phase: "error", instruction: "Face verification could not start. Tap Retry.", error: "Models failed to load.", retryVisible: true });
        });
    }
    openCamera();
  }

  function handleRetake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    onCaptured(null, "", { blinkVerified: false, liveCapture: false, confidence: 0 });
    handleRestart();
  }

  const activeMessage = useMemo(() => ui.error || ui.instruction, [ui.error, ui.instruction]);

  return (
    <div className={`retela-face-scan-shell retela-face-scan-live${complete ? " is-complete" : ""}`}>
      <header className="retela-face-scan-topbar">
        <button type="button" className="retela-face-scan-text-button" onClick={handleCancel} aria-label="Cancel face verification">
          <ArrowLeft size={20} />
          <span>Cancel</span>
        </button>
        <div className="retela-face-scan-title">Face Verification</div>
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
          <SegmentedProgressRing progress={complete ? 1 : ui.progress} currentTargetProgress={complete ? 1 : ui.progress} complete={complete} error={ui.phase === "error"} />
        </div>

        <section className="retela-face-scan-status" role="status" aria-live="polite">
          <h1>{complete ? "Face verified" : activeMessage}</h1>
          {complete ? <div className="retela-face-scan-success-mark" aria-hidden="true"><Check size={34} /></div> : null}
        </section>

        {ui.retryVisible ? (
          <div className="retela-face-scan-retry">
            <Button type="button" variant="secondary" onClick={handleRestart}>
              <RotateCcw size={16} /> Retry
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
