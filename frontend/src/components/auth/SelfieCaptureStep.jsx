import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "./imageTools";

export default function SelfieCaptureStep({ selfie, selfiePreview, onCaptured, onBack, onNext }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("Opening camera");
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    openCamera();
    return () => stopCamera();
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setBusy(true);
    setError("");
    setStatus("Opening camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("Center your face inside the oval");
    } catch {
      setError("Camera access is required to capture your selfie.");
    } finally {
      setBusy(false);
    }
  }

  async function startCountdown() {
    setError("");
    for (let value = 3; value >= 1; value -= 1) {
      setCountdown(value);
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    }
    setCountdown(0);
    await captureSelfie();
  }

  async function captureSelfie() {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      const raw = captureVideoFrame(videoRef.current, "selfie-verification.jpg");
      const compressed = await compressImage(raw, 1100, 0.84);
      stopCamera();
      onCaptured(compressed, URL.createObjectURL(compressed));
      setStatus("Selfie captured");
    } catch (captureError) {
      setError(captureError.message || "Selfie capture failed. Please retake.");
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    onCaptured(null, "");
    openCamera();
  }

  return (
    <div className="retela-wizard-step">
      <div className="retela-selfie-stage">
        {selfiePreview ? (
          <img src={selfiePreview} className="retela-camera-preview retela-selfie-preview" alt="Selfie verification preview" />
        ) : (
          <div className="retela-selfie-camera-wrap">
            <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview retela-camera-preview-live" />
            <div className="retela-face-oval" aria-hidden="true" />
            {countdown ? <div className="retela-countdown">{countdown}</div> : null}
          </div>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-600">{busy ? <Loader2 className="mr-2 inline animate-spin" size={15} /> : null}{status}</p>
      {error ? <p className="retela-register-alert">{error}</p> : null}
      <div className="retela-wizard-actions">
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        {selfie ? (
          <>
            <Button type="button" variant="secondary" onClick={retake}><RotateCcw size={16} /> Retake</Button>
            <Button type="button" onClick={onNext}>Continue</Button>
          </>
        ) : (
          <Button type="button" disabled={busy || Boolean(countdown)} onClick={startCountdown}><Camera size={16} /> Capture Selfie</Button>
        )}
      </div>
    </div>
  );
}
