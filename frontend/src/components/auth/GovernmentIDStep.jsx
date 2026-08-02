import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, ScanLine, TriangleAlert, Upload } from "lucide-react";
import { checkRegistrationField } from "../../api/registration";
import { Button } from "../ui";
import { captureVideoFrame, compressImage, fileToImage } from "./imageTools";

const idTypes = ["National ID", "Passport", "Driver's License", "PhilHealth ID", "UMID", "Postal ID", "PRC ID", "Voter's ID"];
const AUTO_CAPTURE_THRESHOLD = 90;
const ID_AUTO_CAPTURE_STABILITY_MS = 400;
const ID_CAPTURE_RETRY_LIMIT = 3;
const ID_DETECTION_INTERVAL_MS = 160;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission denied. Allow camera access to capture your ID.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera found. Connect or enable a camera and try again.";
  return "Camera could not start. Check browser permissions and try again.";
}

function analyzeImageData(imageData) {
  const { data, width, height } = imageData;
  let brightness = 0;
  let glarePixels = 0;
  let edgeTotal = 0;
  let samples = 0;

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = (y * width + x) * 4;
      const gray = (data[index] + data[index + 1] + data[index + 2]) / 3;
      brightness += gray;
      if (data[index] > 242 && data[index + 1] > 242 && data[index + 2] > 242) glarePixels += 1;
      const left = ((y * width + x - 1) * 4);
      const right = ((y * width + x + 1) * 4);
      const top = (((y - 1) * width + x) * 4);
      const bottom = (((y + 1) * width + x) * 4);
      edgeTotal += Math.abs(((data[left] + data[left + 1] + data[left + 2]) / 3) - ((data[right] + data[right + 1] + data[right + 2]) / 3));
      edgeTotal += Math.abs(((data[top] + data[top + 1] + data[top + 2]) / 3) - ((data[bottom] + data[bottom + 1] + data[bottom + 2]) / 3));
      samples += 1;
    }
  }

  const averageBrightness = brightness / Math.max(samples, 1);
  const glareRatio = glarePixels / Math.max(samples, 1);
  const edgeScore = edgeTotal / Math.max(samples, 1);
  return { averageBrightness, glareRatio, edgeScore };
}

function qualityMessage(metrics, movement) {
  if (!metrics) return "Place your ID inside the frame.";
  if (movement > 9) return "Hold steady";
  if (metrics.averageBrightness < 62) return "Improve lighting";
  if (metrics.averageBrightness > 225) return "ID too bright";
  if (metrics.glareRatio > 0.045) return "Reduce glare";
  if (metrics.edgeScore < 14) return "ID blurry";
  if (metrics.edgeScore < 18) return "Move closer";
  return "";
}

function calculateIdQuality(metrics, movement) {
  if (!metrics) return 0;
  let score = 100;

  if (metrics.averageBrightness < 62) score -= 45;
  else if (metrics.averageBrightness < 82) score -= (82 - metrics.averageBrightness) * 0.9;
  if (metrics.averageBrightness > 225) score -= 45;
  else if (metrics.averageBrightness > 195) score -= (metrics.averageBrightness - 195) * 0.85;

  if (metrics.glareRatio > 0.045) score -= 55;
  else score -= metrics.glareRatio * 260;

  if (metrics.edgeScore < 14) score -= 55;
  else if (metrics.edgeScore < 18) score -= 28;
  else if (metrics.edgeScore < 24) score -= (24 - metrics.edgeScore) * 3.2;

  if (movement > 9) score -= 45;
  else score -= movement * 2.4;

  return clamp(Math.round(score), 0, 100);
}

function idStatusMessage(message, score) {
  if (message) return message;
  if (score >= AUTO_CAPTURE_THRESHOLD) return "ID ready. Capturing...";
  if (score >= 70) return "Almost ready";
  return "Place your ID inside the frame.";
}

async function analyzeStillFile(file) {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  const width = 420;
  canvas.width = width;
  canvas.height = Math.round((image.height / image.width) * width);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return analyzeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
}

export default function GovernmentIDStep({ data, onChange, onNext, onBack, loading = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(0);
  const lastAnalyzeRef = useRef(0);
  const stoppedRef = useRef(false);
  const stableSinceRef = useRef(0);
  const lastEdgeRef = useRef(null);
  const capturedRef = useRef(false);
  const idCaptureLockedRef = useRef(false);
  const captureRetryRef = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [status, setStatus] = useState("Camera Starting...");
  const [quality, setQuality] = useState({ ok: false, ready: false, message: "Place your ID inside the frame.", progress: 0, score: 0 });
  const [error, setError] = useState("");
  const [idNumberError, setIdNumberError] = useState("");
  const [idNumberChecking, setIdNumberChecking] = useState(false);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    window.cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const idNumber = data.idNumber?.trim();
    setIdNumberError("");
    if (!idNumber || idNumber.length < 3) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setIdNumberChecking(true);
      try {
        await checkRegistrationField("idNumber", idNumber);
        if (active) setIdNumberError("");
      } catch (requestError) {
        if (active) setIdNumberError(requestError?.response?.data?.errors?.idNumber || "Government ID already exists.");
      } finally {
        if (active) setIdNumberChecking(false);
      }
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [data.idNumber]);

  const capture = useCallback(async (liveCapture = true) => {
    if (!videoRef.current || idCaptureLockedRef.current) return;
    idCaptureLockedRef.current = true;
    capturedRef.current = true;
    setStatus("ID ready. Capturing...");
    try {
      const raw = captureVideoFrame(videoRef.current, "government-id.jpg");
      const compressed = await compressImage(raw, 1800, 0.9);
      onChange({
        ...data,
        idImage: compressed,
        idPreview: URL.createObjectURL(compressed),
        idQualityVerified: true,
        idLiveCapture: liveCapture
      });
      stopCamera();
      setStatus("ID captured");
    } catch (captureError) {
      captureRetryRef.current += 1;
      idCaptureLockedRef.current = false;
      capturedRef.current = false;
      if (captureRetryRef.current <= ID_CAPTURE_RETRY_LIMIT) {
        stableSinceRef.current = 0;
        setStatus("Capture failed. Retrying...");
        setQuality({ ok: false, ready: false, message: "Capture failed. Retrying...", progress: 0, score: 0 });
        return;
      }
      setError(captureError.message || "Capture failed. Please retake your ID.");
    }
  }, [data, onChange, stopCamera]);

  const analyzeFrame = useCallback((timestamp = 0) => {
    if (stoppedRef.current || capturedRef.current || idCaptureLockedRef.current) return;

    if (timestamp - lastAnalyzeRef.current < ID_DETECTION_INTERVAL_MS) {
      loopRef.current = window.requestAnimationFrame(analyzeFrame);
      return;
    }
    lastAnalyzeRef.current = timestamp;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      loopRef.current = window.requestAnimationFrame(analyzeFrame);
      return;
    }

    const canvas = document.createElement("canvas");
    const width = 360;
    const height = Math.round(width * (video.videoHeight / Math.max(video.videoWidth, 1)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    const frame = {
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.2),
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.52)
    };
    const metrics = analyzeImageData(context.getImageData(frame.x, frame.y, frame.width, frame.height));
    const previousEdge = lastEdgeRef.current;
    lastEdgeRef.current = metrics.edgeScore;
    const movement = previousEdge === null ? 0 : Math.abs(metrics.edgeScore - previousEdge);
    const message = qualityMessage(metrics, movement);
    const score = calculateIdQuality(metrics, movement);
    const nextStatus = idStatusMessage(message, score);
    const idReady = score >= AUTO_CAPTURE_THRESHOLD && !message;

    if (!idReady) {
      stableSinceRef.current = 0;
      setQuality({ ok: false, ready: false, message: nextStatus, progress: score / 100, score });
      setStatus(nextStatus);
    } else {
      if (!stableSinceRef.current) stableSinceRef.current = timestamp;
      const stableFor = timestamp - stableSinceRef.current;
      const stableComplete = stableFor >= ID_AUTO_CAPTURE_STABILITY_MS;
      setQuality({ ok: stableComplete, ready: true, message: nextStatus, progress: score / 100, score });
      setStatus(nextStatus);
      if (stableComplete) {
        capture(true);
        return;
      }
    }

    loopRef.current = window.requestAnimationFrame(analyzeFrame);
  }, [capture]);

  const openCamera = useCallback(async () => {
    setError("");
    setStatus("Camera Starting...");
    setQuality({ ok: false, ready: false, message: "Place your ID inside the frame.", progress: 0, score: 0 });
    stoppedRef.current = false;
    capturedRef.current = false;
    idCaptureLockedRef.current = false;
    captureRetryRef.current = 0;
    stableSinceRef.current = 0;
    lastEdgeRef.current = null;
    lastAnalyzeRef.current = 0;
    window.cancelAnimationFrame(loopRef.current);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      streamRef.current = stream;
      setCameraOpen(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("Place your ID inside the frame.");
      loopRef.current = window.requestAnimationFrame(analyzeFrame);
    } catch (cameraError) {
      setError(cameraErrorMessage(cameraError));
      setStatus("Camera unavailable");
    }
  }, [analyzeFrame]);

  useEffect(() => {
    if (!data.idPreview) openCamera();
    // Camera auto-start is intentionally mount-scoped; recapture/restart is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const metrics = await analyzeStillFile(file);
      const message = qualityMessage(metrics, 0);
      if (message) {
        setError(message === "ID blurry" ? "ID blurry. Retake a sharper image." : `${message}. Retake or upload a clearer ID image.`);
        return;
      }
      const compressed = await compressImage(file, 1800, 0.9);
      onChange({ ...data, idImage: compressed, idPreview: URL.createObjectURL(compressed), idQualityVerified: true, idLiveCapture: false });
      stopCamera();
    } catch {
      setError("Capture failed. Choose a clear JPG, PNG, or WebP image.");
    }
  }

  function recapture() {
    if (data.idPreview) URL.revokeObjectURL(data.idPreview);
    onChange({ ...data, idImage: null, idPreview: "", idQualityVerified: false, idLiveCapture: false });
    idCaptureLockedRef.current = false;
    captureRetryRef.current = 0;
    openCamera();
  }

  const canContinue = data.idType && data.idNumber?.trim() && data.idImage && data.idQualityVerified && !idNumberError && !idNumberChecking && !loading;

  return (
    <div className="retela-wizard-step">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Government ID
          <select className="retela-register-input" value={data.idType || ""} onChange={(event) => onChange({ ...data, idType: event.target.value })} aria-label="Government ID type">
            <option value="">Select Government ID</option>
            {idTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          ID Number
          <input className={`retela-register-input ${idNumberError ? "retela-register-invalid" : ""}`} value={data.idNumber || ""} onChange={(event) => onChange({ ...data, idNumber: event.target.value })} placeholder="Enter ID number" aria-invalid={Boolean(idNumberError)} />
          {idNumberChecking ? <span className="retela-register-hint">Checking...</span> : null}
          {idNumberError ? <span className="retela-register-error">{idNumberError}</span> : null}
        </label>
      </div>

      <div className="retela-guidance-panel" aria-live="polite">
        <span><ScanLine size={16} /> Place your ID inside the frame.</span>
        <span>Hold steady.</span>
        <span>Improve lighting if needed.</span>
      </div>

      <div className="retela-upload-panel">
        {data.idPreview ? (
          <img src={data.idPreview} alt="Government ID preview" className="retela-id-preview" />
        ) : (
          <div className={`retela-id-camera-wrap ${quality.ready ? "retela-id-camera-ready" : ""}`}>
            <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview" aria-label="Live government ID camera" />
            <div className={`retela-id-outline ${quality.ready ? "retela-id-outline-ready" : ""}`} aria-hidden="true">
              <span />
            </div>
          </div>
        )}

        <div className={`retela-live-status ${data.idQualityVerified ? "retela-live-status-ok" : ""}`} role="status" aria-live="polite">
          {cameraOpen && !data.idPreview ? <Loader2 className="animate-spin" size={16} /> : data.idQualityVerified ? <CheckCircle2 size={17} /> : <Camera size={17} />}
          <span>{data.idQualityVerified ? "Government ID verified" : status}</span>
          {!data.idQualityVerified && quality.score ? <strong>{quality.score}%</strong> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="retela-file-button">
            <Upload size={16} />
            Upload Image
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} />
          </label>
          <Button type="button" variant="secondary" onClick={openCamera}><Camera size={16} /> Open Camera</Button>
          {data.idPreview ? <Button type="button" variant="secondary" onClick={recapture}><RotateCcw size={16} /> Recapture</Button> : null}
        </div>
      </div>

      {error ? <p className="retela-register-alert"><TriangleAlert size={16} /> {error}</p> : null}
      <div className="retela-wizard-actions">
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        <Button type="button" disabled={!canContinue} onClick={onNext}>
          {loading ? <><Loader2 className="animate-spin" size={16} /> Sending OTP</> : "Continue"}
        </Button>
      </div>
    </div>
  );
}
