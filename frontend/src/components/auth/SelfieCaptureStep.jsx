import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "./imageTools";

const MODEL_URL = "/models/face-api";
const BLINK_EAR_THRESHOLD = 0.2;
const OPEN_EAR_THRESHOLD = 0.25;

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

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(points = []) {
  if (points.length < 6) return 0;
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * Math.max(distance(points[0], points[3]), 1));
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission denied. Allow camera access to verify your selfie.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera found. Connect or enable a camera and try again.";
  return "Camera could not start. Check browser permissions and try again.";
}

export default function SelfieCaptureStep({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const stoppedRef = useRef(false);
  const blinkArmedRef = useRef(false);
  const blinkDetectedRef = useRef(false);
  const faceSeenRef = useRef(false);
  const capturedRef = useRef(false);
  const loopRef = useRef(0);
  const [status, setStatus] = useState("Camera Starting...");
  const [confidence, setConfidence] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [blinkDetected, setBlinkDetected] = useState(Boolean(livenessVerified));

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    window.clearTimeout(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const drawOverlay = useCallback((detection) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    const display = { width: video.clientWidth || video.videoWidth, height: video.clientHeight || video.videoHeight };
    canvas.width = display.width;
    canvas.height = display.height;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!detection) return;
    const faceapi = faceapiModule;
    if (!faceapi) return;
    const resized = faceapi.resizeResults(detection, display);
    const box = resized.detection.box;
    context.strokeStyle = "#22c55e";
    context.lineWidth = 3;
    context.shadowColor = "rgba(34,197,94,0.55)";
    context.shadowBlur = 8;
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.shadowBlur = 0;
    context.fillStyle = "rgba(15,23,42,0.78)";
    context.fillRect(box.x, Math.max(0, box.y - 28), Math.min(190, box.width), 24);
    context.fillStyle = "#ffffff";
    context.font = "700 13px system-ui";
    context.fillText(`Confidence ${Math.round(detection.detection.score * 100)}%`, box.x + 8, Math.max(18, box.y - 11));
  }, []);

  const captureSelfie = useCallback(async (finalConfidence) => {
    if (!videoRef.current || capturedRef.current) return;
    capturedRef.current = true;
    setBusy(true);
    setStatus("Capturing...");
    try {
      const raw = captureVideoFrame(videoRef.current, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1200, 0.86);
      stopCamera();
      onCaptured(compressed, URL.createObjectURL(compressed), {
        blinkVerified: true,
        liveCapture: true,
        confidence: finalConfidence
      });
      setStatus("Selfie Verified");
    } catch (captureError) {
      capturedRef.current = false;
      setError(captureError.message || "Capture failed. Please retake your selfie.");
      setStatus("Capture failed");
    } finally {
      setBusy(false);
    }
  }, [onCaptured, stopCamera]);

  const analyzeFrame = useCallback(async () => {
    if (stoppedRef.current || capturedRef.current || selfiePreview) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      loopRef.current = window.setTimeout(analyzeFrame, 250);
      return;
    }

    try {
      const faceapi = faceapiModule || await loadLivenessModels();
      const detections = await faceapi.detectAllFaces(video, faceOptions(faceapi)).withFaceLandmarks();
      if (stoppedRef.current || capturedRef.current) return;
      if (!detections.length) {
        drawOverlay(null);
        faceSeenRef.current = false;
        blinkArmedRef.current = false;
        setConfidence(0);
        setStatus("Searching for Face...");
        setError("Face not detected. Look directly at the camera.");
      } else if (detections.length > 1) {
        drawOverlay(null);
        faceSeenRef.current = false;
        blinkArmedRef.current = false;
        setConfidence(0);
        setStatus("Searching for Face...");
        setError("Multiple faces detected. Only one person can be in the frame.");
      } else {
        const detection = detections[0];
        drawOverlay(detection);
        setConfidence(Math.round(detection.detection.score * 100));
        setError("");
        const boxRatio = detection.detection.box.width / Math.max(video.videoWidth, 1);
        const leftEar = eyeAspectRatio(detection.landmarks.getLeftEye());
        const rightEar = eyeAspectRatio(detection.landmarks.getRightEye());
        const ear = (leftEar + rightEar) / 2;

        if (boxRatio < 0.18) {
          setStatus("Move closer");
        } else if (boxRatio > 0.62) {
          setStatus("Move farther");
        } else if (!faceSeenRef.current) {
          faceSeenRef.current = true;
          setStatus("Face Detected");
        } else if (!blinkDetectedRef.current) {
          if (ear > OPEN_EAR_THRESHOLD) blinkArmedRef.current = true;
          if (blinkArmedRef.current && ear < BLINK_EAR_THRESHOLD) {
            blinkDetectedRef.current = true;
            setBlinkDetected(true);
            setStatus("Blink Detected");
            window.setTimeout(() => captureSelfie(detection.detection.score), 350);
            return;
          } else {
            setStatus("Please Blink");
          }
        } else {
          setStatus("Face Detected");
        }
      }
    } catch (analysisError) {
      setError(analysisError.message || "Face verification failed. Please try again.");
    }

    loopRef.current = window.setTimeout(analyzeFrame, 260);
  }, [captureSelfie, drawOverlay, selfiePreview]);

  const openCamera = useCallback(async () => {
    stoppedRef.current = false;
    capturedRef.current = false;
    blinkArmedRef.current = false;
    blinkDetectedRef.current = false;
    faceSeenRef.current = false;
    setBusy(true);
    setError("");
    setBlinkDetected(false);
    setConfidence(0);
    setStatus("Camera Starting...");
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("Searching for Face...");
      analyzeFrame();
    } catch (cameraError) {
      setError(cameraErrorMessage(cameraError));
      setStatus("Camera unavailable");
    } finally {
      setBusy(false);
    }
  }, [analyzeFrame]);

  useEffect(() => {
    if (!selfiePreview) openCamera();
    return () => stopCamera();
    // Camera auto-start is intentionally mount-scoped; recapture/restart is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    URL.revokeObjectURL(selfiePreview);
    onCaptured(null, "", { blinkVerified: false, liveCapture: false, confidence: 0 });
    openCamera();
  }

  const verified = Boolean(selfie && (blinkDetected || livenessVerified));

  return (
    <div className="retela-wizard-step">
      <div className="retela-guidance-panel" aria-live="polite">
        <span><ShieldCheck size={16} /> Look directly at the camera.</span>
        <span>Remove hats or sunglasses.</span>
        <span>Blink once.</span>
      </div>

      <div className="retela-selfie-stage">
        {selfiePreview ? (
          <img src={selfiePreview} className="retela-camera-preview retela-selfie-preview" alt="Selfie verification preview" />
        ) : (
          <div className="retela-selfie-camera-wrap" onContextMenu={(event) => event.preventDefault()}>
            <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview retela-camera-preview-live" aria-label="Live selfie camera" />
            <canvas ref={canvasRef} className="retela-face-overlay" aria-hidden="true" />
            <div className="retela-face-oval" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className={`retela-live-status ${verified ? "retela-live-status-ok" : ""}`} role="status" aria-live="polite">
        {busy ? <Loader2 className="animate-spin" size={16} /> : verified ? <CheckCircle2 size={17} /> : blinkDetected ? <CheckCircle2 size={17} /> : <Camera size={17} />}
        <span>{status}</span>
        {confidence ? <strong>{confidence}%</strong> : null}
      </div>

      {error ? <p className="retela-register-alert"><TriangleAlert size={16} /> {error}</p> : null}

      <div className="retela-wizard-actions">
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        {selfie ? (
          <>
            <Button type="button" variant="secondary" onClick={retake}><RotateCcw size={16} /> Recapture</Button>
            <Button type="button" disabled={!verified} onClick={onNext}>Continue</Button>
          </>
        ) : (
          <Button type="button" disabled={busy} onClick={openCamera}><Camera size={16} /> Restart Camera</Button>
        )}
      </div>
    </div>
  );
}
