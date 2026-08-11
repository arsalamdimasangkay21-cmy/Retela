import { useCallback, useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { ArrowLeft, Camera, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../ui";
import { loadFaceModels } from "../auth/FaceRecognition";
import { captureVideoFrame, compressImage } from "../auth/imageTools";
import SegmentedProgressRing from "./SegmentedProgressRing";

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 480 },
    height: { ideal: 640 },
    frameRate: { ideal: 24, max: 30 }
  }
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

export default function CircularFaceScanner({
  selfie,
  selfiePreview,
  captureVerified = false,
  onCaptured,
  onBack,
  onNext
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);
  const captureLockRef = useRef(false);
  const capturedPreviewRef = useRef("");

  const [cameraReady, setCameraReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [phase, setPhase] = useState(selfiePreview && captureVerified ? "success" : "starting");
  const [message, setMessage] = useState(
    selfiePreview && captureVerified
      ? "Face captured successfully"
      : "Make sure your face is visible before capturing."
  );

  const captured = Boolean(selfie && selfiePreview && captureVerified);
  const captureDisabled = !cameraReady || !faceDetected || phase === "capturing" || captured;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const openCamera = useCallback(async () => {
    stopCamera();
    captureLockRef.current = false;
    if (!mountedRef.current) return;

    setPhase("starting");
    setFaceDetected(false);
    setMessage("Make sure your face is visible before capturing.");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not available in this browser.");
      }

      const video = videoRef.current;
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (video) {
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.srcObject = stream;
        await video.play();
        await waitForVideoReady(video);
      }

      if (!mountedRef.current) return;
      setCameraReady(true);
      setPhase("ready");
      setMessage("Detecting your face...");
    } catch (error) {
      if (!mountedRef.current) return;
      setCameraReady(false);
      setFaceDetected(false);
      setPhase("camera-error");
      setMessage(cameraErrorMessage(error));
    }
  }, [stopCamera]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (captureDisabled || captureLockRef.current || !video || video.readyState < 2) return;

    captureLockRef.current = true;
    setPhase("capturing");
    setMessage("Capturing your photo...");

    try {
      const raw = captureVideoFrame(video, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      const preview = URL.createObjectURL(compressed);
      capturedPreviewRef.current = preview;

      stopCamera();
      onCaptured(compressed, preview, {
        manualCaptureVerified: true,
        liveCapture: true,
        confidence: 1
      });

      if (navigator.vibrate) navigator.vibrate(80);
      setPhase("success");
      setMessage("Face captured successfully");
    } catch (error) {
      console.error("Manual face capture failed", error);
      captureLockRef.current = false;
      setPhase("ready");
      setMessage("Unable to process face data. Please retake your photo.");
    }
  }, [captureDisabled, onCaptured, stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    if (!selfiePreview) void openCamera();

    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [openCamera, selfiePreview, stopCamera]);

  useEffect(() => {
    if (!cameraReady || selfiePreview) {
      setFaceDetected(false);
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let detecting = false;

    async function detectFace() {
      if (cancelled || detecting) return;
      detecting = true;
      try {
        await loadFaceModels();
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
          return;
        }
        const faces = await faceapi.detectAllFaces(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 })
        );
        if (cancelled) return;
        const hasOneFace = faces.length === 1;
        setFaceDetected(hasOneFace);
        setMessage(hasOneFace
          ? "Face detected. Press Capture Face when you are ready."
          : faces.length > 1
            ? "Only one face should be visible before capturing."
            : "Position your face in the frame before capturing.");
      } catch (error) {
        if (!cancelled) {
          setFaceDetected(false);
          setMessage("Face detection is unavailable. Please refresh and try again.");
        }
      } finally {
        detecting = false;
        if (!cancelled) timer = window.setTimeout(detectFace, 700);
      }
    }

    void detectFace();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [cameraReady, selfiePreview]);

  useEffect(() => () => {
    if (capturedPreviewRef.current) URL.revokeObjectURL(capturedPreviewRef.current);
    capturedPreviewRef.current = "";
  }, []);

  function handleCancel() {
    stopCamera();
    onBack();
  }

  function handleRetake() {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
    if (capturedPreviewRef.current && capturedPreviewRef.current !== selfiePreview) {
      URL.revokeObjectURL(capturedPreviewRef.current);
    }
    capturedPreviewRef.current = "";
    setFaceDetected(false);
    onCaptured(null, "", { manualCaptureVerified: false, liveCapture: false, confidence: 0 });
    void openCamera();
  }

  return (
    <div className="retela-face-scan-shell">
      <section className="retela-face-card" aria-labelledby="retela-face-title">
        <header className="retela-face-header">
          <button type="button" className="retela-face-back" onClick={handleCancel} aria-label="Back to registration information">
            <ArrowLeft size={19} />
          </button>
          <div>
            <h1 id="retela-face-title">Face Recognition</h1>
            <p>Position your face in the frame, then capture your photo manually.</p>
          </div>
        </header>

        <ProgressTracker />

        <div className="retela-face-layout">
          <main className="retela-face-primary">
            <div className={`retela-face-camera-wrap${captured ? " is-ready" : ""}`} onContextMenu={(event) => event.preventDefault()}>
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
                {captured ? (
                  <div className="retela-face-detected-badge">
                    <span>Captured</span>
                  </div>
                ) : null}
              </div>
              <SegmentedProgressRing progress={captured ? 1 : cameraReady ? 0.7 : 0.2} currentTargetProgress={captured ? 1 : cameraReady ? 0.7 : 0.2} complete={captured} />
            </div>

            <section className={`retela-face-ready-panel${captured ? " is-ready" : ""}`} role="status" aria-live="polite">
              <h2>{message}</h2>
              <p>{captured ? "Review your captured photo, then continue." : "Photo will be captured only when you press the button."}</p>
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
              <button type="button" className="retela-face-capture" disabled={captureDisabled} onClick={handleCapture}>
                <Camera size={20} />
                <span>{phase === "capturing" ? "Capturing..." : "Capture Face"}</span>
              </button>
            )}
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
                  <span>Keep your face inside the circle before capture.</span>
                </li>
                <li>
                  <strong>Capture manually</strong>
                  <span>Press the capture button when you are ready.</span>
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
