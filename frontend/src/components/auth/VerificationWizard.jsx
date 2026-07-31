import { createPortal } from "react-dom";
import { useCallback, useState } from "react";
import { Loader2, X } from "lucide-react";
import { sendRegistrationOtp } from "../../api/registration";
import { getApiErrorMessage } from "../../api/client";
import GovernmentIDStep from "./GovernmentIDStep";
import OTPVerification from "./OTPVerification";
import SelfieCaptureStep from "./SelfieCaptureStep";

const steps = ["Government ID", "Selfie", "Gmail OTP"];

export default function VerificationWizard({ open, registration, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [verification, setVerification] = useState({ idType: "", idNumber: "", idImage: null, idPreview: "", selfieImage: null, selfiePreview: "", faceMatchScore: 0 });
  const [otpEmail, setOtpEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendOtpAfterSelfie = useCallback(async () => {
    setVerification((value) => ({ ...value, faceMatchScore: 100 }));
    setLoading(true);
    setError("");
    try {
      const { data } = await sendRegistrationOtp({
        ...registration,
        idType: verification.idType,
        idNumber: verification.idNumber,
        faceMatchScore: 100,
        idImage: verification.idImage,
        selfieImage: verification.selfieImage
      });
      setOtpEmail(data.email || registration.email);
      setStep(2);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not send OTP after registration review"));
    } finally {
      setLoading(false);
    }
  }, [registration, verification.idImage, verification.idNumber, verification.idType, verification.selfieImage]);

  if (!open) return null;

  function close() {
    if (!loading) onClose();
  }

  return createPortal(
    <div className="retela-register-modal-backdrop retela-wizard-backdrop" role="presentation" onMouseDown={close}>
      <section className="retela-wizard-modal" role="dialog" aria-modal="true" aria-labelledby="verification-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Identity Verification</p>
            <h2 id="verification-title" className="mt-1 font-display text-2xl font-bold text-slate-900">Complete Registration</h2>
          </div>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={close} aria-label="Close verification">
            <X size={18} />
          </button>
        </div>

        <div className="retela-stepper">
          {steps.map((label, index) => (
            <span key={label} className={`retela-step-pill ${index <= step ? "retela-step-pill-active" : ""}`}>{index + 1}. {label}</span>
          ))}
        </div>

        {step === 0 ? (
          <GovernmentIDStep
            data={verification}
            onChange={setVerification}
            onNext={() => setStep(1)}
          />
        ) : null}

        {step === 1 ? (
          <div className="retela-wizard-step">
            <SelfieCaptureStep
              selfie={verification.selfieImage}
              selfiePreview={verification.selfiePreview}
              onBack={() => setStep(0)}
              onCaptured={(file, preview) => setVerification((value) => ({ ...value, selfieImage: file, selfiePreview: preview }))}
              onNext={sendOtpAfterSelfie}
            />
            {loading ? <p className="text-sm font-semibold text-emerald-700"><Loader2 className="mr-2 inline animate-spin" size={16} />Sending Gmail OTP</p> : null}
            {error ? <p className="retela-register-alert">{error}</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <OTPVerification email={otpEmail || registration.email} onVerified={onComplete} />
        ) : null}
      </section>
    </div>,
    document.body
  );
}
