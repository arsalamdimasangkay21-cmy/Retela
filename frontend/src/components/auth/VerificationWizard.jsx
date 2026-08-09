import { createPortal } from "react-dom";
import { useCallback, useState } from "react";
import { Loader2, X } from "lucide-react";
import { sendRegistrationOtp } from "../../api/registration";
import { getApiErrorMessage } from "../../api/client";
import GovernmentIDStep from "./GovernmentIDStep";
import OTPVerification from "./OTPVerification";
import SelfieCaptureStep from "./SelfieCaptureStep";

const steps = ["Fill Up Info", "Face Recognition", "Government ID", "Email Verification", "Complete"];

function getStepStatus(index, currentStep) {
  if (index === 0) return "Completed";
  if (index < currentStep) return "Completed";
  if (index === currentStep) return "In Progress";
  return "Upcoming";
}

export default function VerificationWizard({ open, registration, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [verification, setVerification] = useState({
    idType: "",
    idNumber: "",
    idImage: null,
    idPreview: "",
    idQualityVerified: false,
    idLiveCapture: false,
    selfieImage: null,
    selfiePreview: "",
    selfieManualCaptureVerified: false,
    selfieLiveCapture: false,
    faceMatchScore: 0
  });
  const [otpEmail, setOtpEmail] = useState("");
  const [otpMeta, setOtpMeta] = useState({ expiresInSeconds: 300, resendAfterSeconds: 60, maxAttempts: 5 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendOtpAfterId = useCallback(async () => {
    if (!verification.selfieImage || !verification.selfieManualCaptureVerified || !verification.selfieLiveCapture || !verification.idImage || !verification.idQualityVerified) {
      setError("Complete face recognition and government ID capture before email verification.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await sendRegistrationOtp({
        ...registration,
        idType: verification.idType,
        idNumber: verification.idNumber,
        faceMatchScore: verification.faceMatchScore,
        selfieBlinkVerified: verification.selfieManualCaptureVerified,
        selfieLiveCapture: verification.selfieLiveCapture,
        idQualityVerified: verification.idQualityVerified,
        idLiveCapture: verification.idLiveCapture,
        idImage: verification.idImage,
        selfieImage: verification.selfieImage
      });
      setOtpEmail(data.email || registration.email);
      setOtpMeta({
        expiresInSeconds: data.expiresInSeconds || 300,
        resendAfterSeconds: data.resendAfterSeconds || 60,
        maxAttempts: data.maxAttempts || 5
      });
      setStep(3);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not send OTP after registration review"));
    } finally {
      setLoading(false);
    }
  }, [registration, verification.faceMatchScore, verification.idImage, verification.idLiveCapture, verification.idNumber, verification.idQualityVerified, verification.idType, verification.selfieImage, verification.selfieLiveCapture, verification.selfieManualCaptureVerified]);

  if (!open) return null;

  function close() {
    if (!loading) onClose();
  }

  return createPortal(
    <div className="retela-register-modal-backdrop retela-wizard-backdrop" role="presentation" onMouseDown={close}>
      <section className={`retela-wizard-modal ${step === 1 ? "retela-wizard-modal-faceid" : ""}`} role="dialog" aria-modal="true" aria-labelledby={step === 1 ? undefined : "verification-title"} aria-label={step === 1 ? "Face Recognition" : undefined} onMouseDown={(event) => event.stopPropagation()}>
        {step !== 1 ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Identity Verification</p>
              <h2 id="verification-title" className="mt-1 font-display text-2xl font-bold text-slate-900">Complete Registration</h2>
            </div>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={close} aria-label="Close verification">
              <X size={18} />
            </button>
          </div>
        ) : null}

        {step !== 1 ? (
          <div className="retela-stepper">
            {steps.map((label, index) => {
              const status = getStepStatus(index, step);
              return (
                <span key={label} className={`retela-step-pill ${status === "In Progress" ? "retela-step-pill-active" : ""}${status === "Completed" ? " retela-step-pill-complete" : ""}`}>
                  {index + 1}. {label}
                  <small>{status}</small>
                </span>
              );
            })}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="retela-wizard-step">
            <SelfieCaptureStep
              selfie={verification.selfieImage}
              selfiePreview={verification.selfiePreview}
              captureVerified={verification.selfieManualCaptureVerified}
              onBack={onClose}
              onCaptured={(file, preview, meta = {}) => setVerification((value) => ({
                ...value,
                selfieImage: file,
                selfiePreview: preview,
                selfieManualCaptureVerified: Boolean(meta.manualCaptureVerified),
                selfieLiveCapture: Boolean(meta.liveCapture),
                faceMatchScore: meta.confidence ? Math.round(meta.confidence * 100) : value.faceMatchScore
              }))}
              onNext={() => setStep(2)}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <GovernmentIDStep
            data={verification}
            onChange={setVerification}
            onBack={() => setStep(1)}
            onNext={sendOtpAfterId}
            loading={loading}
          />
        ) : null}

        {step === 2 && loading ? <p className="text-sm font-semibold text-emerald-700"><Loader2 className="mr-2 inline animate-spin" size={16} />Sending Gmail OTP</p> : null}
        {step === 2 && error ? <p className="retela-register-alert">{error}</p> : null}

        {step === 3 ? (
          <OTPVerification email={otpEmail || registration.email} initialExpiresIn={otpMeta.expiresInSeconds} initialResendIn={otpMeta.resendAfterSeconds} maxAttempts={otpMeta.maxAttempts} onVerified={(data) => { setStep(4); onComplete(data); }} />
        ) : null}
      </section>
    </div>,
    document.body
  );
}
