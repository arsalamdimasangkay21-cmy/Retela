import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { sendRegistrationOtp } from "../../api/registration";
import { API_URL, getApiErrorMessage } from "../../api/client";
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

function firstValidationMessage(errors = {}) {
  const priority = [
    "displayName",
    "email",
    "phone",
    "location",
    "birthday",
    "gender",
    "password",
    "confirmPassword",
    "accepted",
    "selfieImage",
    "idImage",
    "idType",
    "idNumber"
  ];
  for (const key of priority) {
    if (errors[key]) return errors[key];
  }
  return Object.values(errors).find(Boolean) || "";
}

function validateRegistrationContinue(registration, verification) {
  const email = String(registration.email || "").trim();
  const governmentIdVerified = Boolean(verification.idQualityVerified);
  const checks = [
    [String(registration.displayName || "").trim(), "Display Name is required."],
    [/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Please enter a valid email address."],
    [/^09\d{9}$/.test(String(registration.phone || "")), "Please enter a valid phone number."],
    [String(registration.location || "").trim(), "Location is required."],
    [registration.birthday, "Birthday is required."],
    [registration.gender, "Gender is required."],
    [registration.password, "Password is required."],
    [registration.confirmPassword && registration.password === registration.confirmPassword, "Passwords do not match."],
    [registration.accepted, "Please accept the Terms & Conditions."],
    [verification.selfieImage, "Please capture your face before continuing."],
    [verification.selfieManualCaptureVerified, "Please capture your face before continuing."],
    [verification.selfieLiveCapture, "Please capture your face before continuing."],
    [verification.idImage, "Please upload or capture your Government ID."],
    [governmentIdVerified, "Government ID verification is not complete."],
    [verification.idType, "Government ID type is required."],
    [String(verification.idNumber || "").trim(), "Government ID number is required."]
  ];

  const failed = checks.find(([valid]) => !valid);
  return failed ? failed[1] : "";
}

function normalizeFaceMatchScore(confidence, fallback = 100) {
  const value = Number(confidence);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(Math.max(40, Math.min(100, value <= 1 ? value * 100 : value)));
}

export default function VerificationWizard({ open, registration, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const sendingOtpRef = useRef(false);
  const sendOtpAbortRef = useRef(null);
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
    if (sendingOtpRef.current) return;

    const governmentIdVerified = Boolean(verification.idQualityVerified);
    console.log("[registration continue]", {
      currentStep: step,
      apiUrl: API_URL,
      otpEndpoint: "/auth/register/send-otp",
      hasPersonalInfo: Boolean(registration.displayName && registration.email && registration.phone && registration.location),
      hasDisplayName: Boolean(registration.displayName),
      hasEmail: Boolean(registration.email),
      hasPhone: Boolean(registration.phone),
      hasAddress: Boolean(registration.location),
      hasFaceCapture: Boolean(verification.selfieImage && verification.selfieManualCaptureVerified),
      hasFaceDescriptor: false,
      hasGovernmentId: Boolean(verification.idImage),
      governmentIdVerified,
      hasGovernmentIdType: Boolean(verification.idType),
      hasGovernmentIdNumber: Boolean(verification.idNumber)
    });

    const validationError = validateRegistrationContinue(registration, verification);
    if (validationError) {
      console.warn("[registration continue] blocked by frontend validation", { currentStep: step, reason: validationError });
      setError(validationError);
      return;
    }

    const controller = new AbortController();
    sendOtpAbortRef.current = controller;
    sendingOtpRef.current = true;
    setLoading(true);
    setError("");
    try {
      const payload = {
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
      };

      console.log("[registration continue] sending otp request", {
        currentStep: step,
        endpoint: "/auth/register/send-otp",
        hasEmail: Boolean(payload.email),
        hasFaceCapture: Boolean(payload.selfieImage),
        hasGovernmentId: Boolean(payload.idImage),
        governmentIdVerified: Boolean(payload.idQualityVerified)
      });

      const { data } = await sendRegistrationOtp(payload, {
        signal: controller.signal,
        timeout: 60000
      });

      if (data?.success === false) {
        throw new Error(data.message || "Unable to send verification code. Please try again.");
      }

      console.log("[registration continue] otp request succeeded", {
        currentStep: step,
        hasEmail: Boolean(data?.email || registration.email),
        expiresInSeconds: data?.expiresInSeconds || 300
      });
      setOtpEmail(data.email || registration.email);
      setOtpMeta({
        expiresInSeconds: data.expiresInSeconds || 300,
        resendAfterSeconds: data.resendAfterSeconds || 60,
        maxAttempts: data.maxAttempts || 5
      });
      setStep(3);
    } catch (requestError) {
      if (requestError?.code === "ERR_CANCELED") {
        setError("Verification request was cancelled. Please try again.");
        return;
      }

      const responseErrors = requestError?.response?.data?.errors;
      const fieldMessage = responseErrors ? firstValidationMessage(responseErrors) : "";
      const message = fieldMessage || getApiErrorMessage(requestError, "Unable to send verification code. Please try again.");
      console.error("[registration continue] otp request failed", {
        currentStep: step,
        status: requestError?.response?.status || null,
        code: requestError?.code || null,
        message,
        errorFields: responseErrors ? Object.keys(responseErrors) : []
      });
      setError(message);
    } finally {
      sendingOtpRef.current = false;
      if (sendOtpAbortRef.current === controller) sendOtpAbortRef.current = null;
      setLoading(false);
    }
  }, [registration, step, verification.faceMatchScore, verification.idImage, verification.idLiveCapture, verification.idNumber, verification.idQualityVerified, verification.idType, verification.selfieImage, verification.selfieLiveCapture, verification.selfieManualCaptureVerified]);

  useEffect(() => () => {
    sendOtpAbortRef.current?.abort();
  }, []);

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
                faceMatchScore: meta.confidence ? normalizeFaceMatchScore(meta.confidence, value.faceMatchScore || 100) : value.faceMatchScore
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
