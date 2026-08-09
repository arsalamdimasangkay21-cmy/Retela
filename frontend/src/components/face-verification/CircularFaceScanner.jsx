import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { ArrowLeft, Camera, Check, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../ui";
import { detectFacesInImage, loadFaceModels } from "../auth/FaceRecognition";
import { captureVideoFrame, compressImage } from "../auth/imageTools";
import SegmentedProgressRing from "./SegmentedProgressRing";

const DETECTION_INTERVAL_MS = 250;
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

const initialStatus = {
  phase: "starting",
  title: "Position your face inside the frame",
  detail: "Make sure your face is centered and clearly visible.",
  progress: 0,
  validFace: false,
  error: "",
  retryVisible: false,
  lastFaceScore: 0
};

const progressSteps = [
  { number: 1, label: "Fill Up Info", status: "Completed" },
  { number: 2, label: "Face Recognition", status: "In Progress", current: true },
  { number: 3, label: "Government ID", status: "Upcoming" },
  { number: 4, label: "Email Verification", status: "Upcoming" },
  { number: 5, label: "Complete", status: "Upcoming" }
];

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

function pointInsideCircle(point, center, radius) {
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
}

function analyzeDetectedFace(detection, video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return {
      valid: false,
      title: "Position your face inside the frame",
      detail: "Make sure your face is centered and clearly visible.",
      progress: 0
    };
  }

  const box = detection.detection.box;
  const score = detection.detection.score || 0;
  const videoWidth = Math.max(video.videoWidth, 1);
  const videoHeight = Math.max(video.videoHeight, 1);
  const center = { x: videoWidth / 2, y: videoHeight / 2 };
  const guideRadius = Math.min(videoWidth, videoHeight) * 0.42;
  const faceCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const widthRatio = box.width / videoWidth;
  const heightRatio = box.height / videoHeight;
  const offsetX = Math.abs(faceCenter.x - center.x) / videoWidth;
  const offsetY = Math.abs(faceCenter.y - center.y) / videoHeight;

  if (score < 0.45) {
    return {
      valid: false,
      title: "Position your face inside the frame",
      detail: "Make sure your face is centered and clearly visible.",
      progress: 0.1
    };
  }

  if (widthRatio < 0.28 || heightRatio < 0.24) {
    return {
      valid: false,
      title: "Move closer to the camera",
      detail: "Your face should fill more of the circular guide.",
      progress: 0.22
    };
  }

  if (widthRatio > 0.78 || heightRatio > 0.72) {
    return {
      valid: false,
      title: "Move back slightly",
      detail: "Keep your full face visible inside the circle.",
      progress: 0.3
    };
  }

  if (offsetX > 0.18 || offsetY > 0.18) {
    return {
      valid: false,
      title: "Center your face inside the circle",
      detail: "Move your face toward the middle of the frame.",
      progress: 0.42
    };
  }

  const guidePoints = [
    { x: box.x + box.width / 2, y: box.y },
    { x: box.x + box.width, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height },
    { x: box.x, y: box.y + box.height / 2 }
  ];
  const insideCount = guidePoints.filter((point) => pointInsideCircle(point, center, guideRadius)).length;

  if (insideCount < 3) {
    return {
      valid: false,
      title: "Center your face inside the circle",
      detail: "Keep your entire face within the circular guide.",
      progress: 0.52
    };
  }

  return {
    valid: true,
    title: "You're ready!",
    detail: "Your face is centered and clearly visible.",
    progress: 1,
    score
  };
}

function ProgressTracker() {
  return (
    <ol className="retela-face-progress" aria-label="Registration progress">
      {progressSteps.map((step) => (
        <li key={step.label} className={step.current ? "is-current" : step.status === "Completed" ? "is-complete" : ""}>
          <span>{step.number}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.status}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function CircularFaceScanner({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const lastDetectionRef = useRef(0);
  const processingRef = useRef(false);
  const stoppedRef = useRef(false);
  const modelReadyRef = useRef(false);
  const captureLockRef = useRef(false);
  const mountedRef = useRef(false);
  const capturedPreviewRef = useRef("");

  const [ui, setUi] = useState(() => (
    selfiePreview && livenessVerified
      ? {
        ...initialStatus,
        phase: "success",
        title: "Face captured successfully",
        detail: "Review your captured photo, then continue.",
        progress: 1,
        validFace: false
      }
      : initialStatus
  ));

  const captured = Boolean(selfie && selfiePreview && livenessVerified);
  const captureDisabled = !ui.validFace || ui.phase === "capturing" || ui.phase === "error" || captured;

  const publishUi = useCallback((updates) => {
    if (!mountedRef.current) return;
    setUi((previous) => {
      const next = { ...previous, ...updates };
      return Object.keys(next).some((key) => next[key] !== previous[key]) ? next : previous;
    });
  }, []);

  const stopAll = useCallback(() => {
    stoppedRef.current = true;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    processingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const resetScannerState = useCallback(() => {
    captureLockRef.current = false;
    lastDetectionRef.current = 0;
    publishUi({
      ...initialStatus,
      phase: modelReadyRef.current ? "scanning" : "starting",
      title: modelReadyRef.current ? "Position your face inside the frame" : "Loading camera verifier",
      detail: modelReadyRef.current ? "Make sure your face is centered and clearly visible." : "Camera will start as soon as the verifier is ready."
    });
  }, [publishUi]);

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
      const detections = await faceapi.detectAllFaces(video, TINY_OPTIONS);

      if (detections.length > 1) {
        publishUi({
          phase: "scanning",
          title: "Only one person should be visible",
          detail: "Ask anyone nearby to step out of the camera view.",
          progress: 0.12,
          validFace: false,
          error: "",
          retryVisible: false,
          lastFaceScore: 0
        });
        return;
      }

      if (detections.length === 0) {
        publishUi({
          phase: "scanning",
          title: "Position your face inside the frame",
          detail: "Make sure your face is centered and clearly visible.",
          progress: 0.06,
          validFace: false,
          error: "",
          retryVisible: false,
          lastFaceScore: 0
        });
        return;
      }

      const faceState = analyzeDetectedFace(detections[0], video);
      publishUi({
        phase: "scanning",
        title: faceState.title,
        detail: faceState.detail,
        progress: faceState.progress,
        validFace: faceState.valid,
        error: "",
        retryVisible: false,
        lastFaceScore: faceState.score || detections[0].detection.score || 0
      });
    } catch (error) {
      publishUi({
        phase: "error",
        title: "Face verifier paused. Tap Retry.",
        detail: "Camera detection needs to restart.",
        error: error?.message || "Face detection failed.",
        retryVisible: true,
        validFace: false
      });
    } finally {
      processingRef.current = false;
    }
  }, [publishUi]);

  const startLoop = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    const loop = (timestamp) => {
      void analyzeFrame(timestamp);
      if (!stoppedRef.current) frameRef.current = window.requestAnimationFrame(loop);
    };
    frameRef.current = window.requestAnimationFrame(loop);
  }, [analyzeFrame]);

  const openCamera = useCallback(async () => {
    stopAll();
    stoppedRef.current = false;
    resetScannerState();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not available in this browser.");
      }

      const video = videoRef.current;
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;

      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (!stoppedRef.current) {
            publishUi({
              phase: "error",
              title: "Camera stopped. Tap Retry.",
              detail: "Camera access ended before capture.",
              retryVisible: true,
              validFace: false
            });
          }
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

      publishUi({
        phase: "scanning",
        title: "Position your face inside the frame",
        detail: "Make sure your face is centered and clearly visible.",
        error: "",
        retryVisible: false
      });
      startLoop();
    } catch (error) {
      const message = cameraErrorMessage(error);
      publishUi({
        phase: "error",
        title: message,
        detail: "Check your camera permission and try again.",
        error: message,
        retryVisible: true,
        validFace: false
      });
    }
  }, [publishUi, resetScannerState, startLoop, stopAll]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (captureDisabled || captureLockRef.current || !video || video.readyState < 2) return;

    captureLockRef.current = true;
    publishUi({
      phase: "capturing",
      title: "Capturing face",
      detail: "Hold still while we save this frame.",
      progress: 1,
      validFace: false,
      error: "",
      retryVisible: false
    });

    try {
      const liveDetections = await faceapi.detectAllFaces(video, TINY_OPTIONS);
      if (liveDetections.length !== 1) {
        throw new Error(liveDetections.length > 1 ? "Only one person should be visible" : "Position your face inside the frame");
      }

      const liveFaceState = analyzeDetectedFace(liveDetections[0], video);
      if (!liveFaceState.valid) {
        throw new Error(liveFaceState.title);
      }

      const raw = captureVideoFrame(video, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      const descriptorFaces = await detectFacesInImage(compressed);

      if (descriptorFaces.length !== 1) {
        throw new Error(descriptorFaces.length > 1 ? "Only one person should be visible" : "Position your face inside the frame");
      }

      const faceDescriptor = Array.from(descriptorFaces[0].descriptor);
      const preview = URL.createObjectURL(compressed);
      capturedPreviewRef.current = preview;
      stopAll();

      onCaptured(compressed, preview, {
        manualCaptureVerified: true,
        liveCapture: true,
        confidence: Math.max(0.8, Math.min(1, ui.lastFaceScore || descriptorFaces[0].detection.score || 0.95)),
        faceDescriptor
      });

      if (navigator.vibrate) navigator.vibrate(80);
      publishUi({
        phase: "success",
        title: "Face captured successfully",
        detail: "Review your captured photo, then continue.",
        progress: 1,
        validFace: false,
        error: "",
        retryVisible: false
      });
    } catch (error) {
      captureLockRef.current = false;
      publishUi({
        phase: "scanning",
        title: error?.message || "Capture failed. Please try again.",
        detail: "Reposition your face and press Capture Face again.",
        progress: 0.34,
        validFace: false,
        error: "",
        retryVisible: false
      });
    }
  }, [captureDisabled, onCaptured, publishUi, stopAll, ui.lastFaceScore]);

  useEffect(() => {
    mountedRef.current = true;
    modelReadyRef.current = false;
    publishUi({
      phase: "starting",
      title: "Loading camera verifier",
      detail: "Camera will start as soon as the verifier is ready."
    });

    loadFaceModels()
      .then(() => {
        if (!mountedRef.current) return;
        modelReadyRef.current = true;
        publishUi({
          title: "Position your face inside the frame",
          detail: "Make sure your face is centered and clearly visible."
        });
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        console.error("Face verifier model failed to load", error);
        publishUi({
          phase: "error",
          title: "Face verification could not start. Tap Retry.",
          detail: "Models failed to load.",
          error: "Models failed to load.",
          retryVisible: true,
          validFace: false
        });
      });

    return () => {
      mountedRef.current = false;
      stopAll();
    };
  }, [publishUi, stopAll]);

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

  useEffect(() => () => {
    if (capturedPreviewRef.current) URL.revokeObjectURL(capturedPreviewRef.current);
    capturedPreviewRef.current = "";
  }, []);

  function handleCancel() {
    stopAll();
    onBack();
  }

  async function handleRestart() {
    await openCamera();
  }

  function handleRetake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    if (capturedPreviewRef.current && capturedPreviewRef.current !== selfiePreview) {
      URL.revokeObjectURL(capturedPreviewRef.current);
    }
    capturedPreviewRef.current = "";
    onCaptured(null, "", { manualCaptureVerified: false, liveCapture: false, confidence: 0, faceDescriptor: null });
    void openCamera();
  }

  const statusBadge = useMemo(() => {
    if (captured) return "Captured";
    if (ui.validFace) return "Face detected";
    if (ui.phase === "capturing") return "Capturing";
    return "";
  }, [captured, ui.phase, ui.validFace]);

  return (
    <div className="retela-face-scan-shell">
      <section className="retela-face-card" aria-labelledby="retela-face-title">
        <header className="retela-face-header">
          <button type="button" className="retela-face-back" onClick={handleCancel} aria-label="Back to registration information">
            <ArrowLeft size={19} />
          </button>
          <div>
            <h1 id="retela-face-title">Face Recognition</h1>
            <p>Position your face within the frame. When ready, capture your photo.</p>
          </div>
        </header>

        <ProgressTracker />

        <div className="retela-face-layout">
          <main className="retela-face-primary">
            <div className={`retela-face-camera-wrap${ui.validFace || captured ? " is-ready" : ""}${ui.phase === "error" ? " is-error" : ""}`} onContextMenu={(event) => event.preventDefault()}>
              <div className="retela-face-camera-circle">
                {selfiePreview ? (
                  <img src={selfiePreview} className="retela-face-camera-media" alt="Captured selfie preview" />
                ) : (
                  <video ref={videoRef} autoPlay muted playsInline className="retela-face-camera-media is-live" aria-label="Live selfie camera" />
                )}
                <span className="retela-face-guide retela-face-guide-top-left" aria-hidden="true" />
                <span className="retela-face-guide retela-face-guide-top-right" aria-hidden="true" />
                <span className="retela-face-guide retela-face-guide-bottom-left" aria-hidden="true" />
                <span className="retela-face-guide retela-face-guide-bottom-right" aria-hidden="true" />
                {statusBadge ? (
                  <div className="retela-face-detected-badge">
                    <CheckCircle2 size={15} />
                    <span>{statusBadge}</span>
                  </div>
                ) : null}
              </div>
              <SegmentedProgressRing progress={captured ? 1 : ui.progress} currentTargetProgress={captured ? 1 : ui.progress} complete={captured} error={ui.phase === "error"} />
            </div>

            <section className={`retela-face-ready-panel${ui.validFace || captured ? " is-ready" : ""}`} role="status" aria-live="polite">
              <h2>{ui.validFace && !captured ? <Check size={22} aria-hidden="true" /> : null}{ui.title}</h2>
              <p>{ui.detail}</p>
            </section>

            {captured ? (
              <div className="retela-face-actions">
                <Button type="button" variant="secondary" onClick={handleRetake}>
                  <RotateCcw size={17} /> Retake
                </Button>
                <Button type="button" className="retela-face-continue" onClick={onNext}>
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <button type="button" className="retela-face-capture" disabled={captureDisabled} onClick={handleCapture}>
                  <Camera size={20} />
                  <span>Capture Face</span>
                </button>
                <p className="retela-face-capture-note">Photo will be captured only when you press the button.</p>
              </>
            )}

            {ui.retryVisible ? (
              <div className="retela-face-actions">
                <Button type="button" variant="secondary" onClick={handleRestart}>
                  <RotateCcw size={17} /> Retry
                </Button>
              </div>
            ) : null}
          </main>

          <aside className="retela-face-side">
            <section className="retela-face-info-panel">
              <h2>How it works</h2>
              <ol>
                <li>
                  <strong>Well-lit environment</strong>
                  <span>Ensure your face is well-lit and clearly visible.</span>
                </li>
                <li>
                  <strong>Face the camera</strong>
                  <span>Look straight at the camera and keep a neutral expression.</span>
                </li>
                <li>
                  <strong>Stay within the frame</strong>
                  <span>Keep your entire face inside the circle until capture.</span>
                </li>
                <li>
                  <strong>Capture manually</strong>
                  <span>Press the capture button only when you see "Face detected".</span>
                </li>
              </ol>
            </section>

            <section className="retela-face-security-panel">
              <ShieldCheck size={22} />
              <div>
                <h2>Your data is secure</h2>
                <p>Your face data is used only for identity verification.</p>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
