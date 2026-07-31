import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Upload } from "lucide-react";
import { checkRegistrationField } from "../../api/registration";
import { Button } from "../ui";
import { captureVideoFrame, compressImage } from "./imageTools";

const idTypes = ["National ID", "Passport", "Driver's License", "PhilHealth ID", "UMID", "Postal ID", "PRC ID", "Voter's ID"];

export default function GovernmentIDStep({ data, onChange, onNext }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [idNumberError, setIdNumberError] = useState("");
  const [idNumberChecking, setIdNumberChecking] = useState(false);

  useEffect(() => () => stopCamera(), []);

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

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 0);
    } catch {
      setError("Camera access is required to capture your ID.");
    }
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    onChange({ ...data, idImage: compressed, idPreview: URL.createObjectURL(compressed) });
  }

  async function capture() {
    if (!videoRef.current) return;
    const raw = captureVideoFrame(videoRef.current, "government-id.jpg");
    const compressed = await compressImage(raw);
    onChange({ ...data, idImage: compressed, idPreview: URL.createObjectURL(compressed) });
    stopCamera();
    setCameraOpen(false);
  }

  const canContinue = data.idType && data.idNumber?.trim() && data.idImage && !idNumberError && !idNumberChecking;

  return (
    <div className="retela-wizard-step">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Government ID
          <select className="retela-register-input" value={data.idType || ""} onChange={(event) => onChange({ ...data, idType: event.target.value })}>
            <option value="">Select Government ID</option>
            {idTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          ID Number
          <input className={`retela-register-input ${idNumberError ? "retela-register-invalid" : ""}`} value={data.idNumber || ""} onChange={(event) => onChange({ ...data, idNumber: event.target.value })} placeholder="Enter ID number" />
          {idNumberChecking ? <span className="retela-register-hint">Checking...</span> : null}
          {idNumberError ? <span className="retela-register-error">{idNumberError}</span> : null}
        </label>
      </div>

      <div className="retela-upload-panel">
        {data.idPreview ? <img src={data.idPreview} alt="Government ID preview" className="retela-id-preview" /> : <div className="retela-empty-preview">No ID image selected</div>}
        {cameraOpen ? (
          <div className="grid gap-3">
            <video ref={videoRef} autoPlay playsInline muted className="retela-camera-preview" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={capture}><Camera size={16} /> Capture ID</Button>
              <Button type="button" variant="secondary" onClick={() => { stopCamera(); setCameraOpen(false); }}><RotateCcw size={16} /> Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <label className="retela-file-button">
              <Upload size={16} />
              Upload Image
              <input type="file" accept="image/*" onChange={selectFile} />
            </label>
            <Button type="button" variant="secondary" onClick={openCamera}><Camera size={16} /> Open Camera</Button>
            {data.idPreview ? <Button type="button" variant="secondary" onClick={() => onChange({ ...data, idImage: null, idPreview: "" })}><RotateCcw size={16} /> Retake</Button> : null}
          </div>
        )}
      </div>
      {error ? <p className="retela-register-alert">{error}</p> : null}
      <div className="retela-wizard-actions">
        <Button type="button" disabled={!canContinue} onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}
