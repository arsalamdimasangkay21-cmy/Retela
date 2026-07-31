import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, RotateCcw } from "lucide-react";
import { completeRegistrationOtp, resendRegistrationOtp } from "../../api/registration";
import { getApiErrorMessage } from "../../api/client";
import { Button, Field } from "../ui";

export default function OTPVerification({ email, onVerified }) {
  const [otp, setOtp] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [expiresIn, setExpiresIn] = useState(300);
  const [resendIn, setResendIn] = useState(60);
  const [loading, setLoading] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setExpiresIn((value) => Math.max(0, value - 1));
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const timeLabel = useMemo(() => {
    const minutes = Math.floor(expiresIn / 60);
    const seconds = String(expiresIn % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [expiresIn]);

  async function verify(event) {
    event.preventDefault();
    if (attempts >= 5) return;
    setLoading("verify");
    setMessage("");
    try {
      const { data } = await completeRegistrationOtp({ email, otp });
      onVerified(data);
    } catch (error) {
      setAttempts((value) => value + 1);
      setMessage(getApiErrorMessage(error, "Invalid or expired OTP"));
    } finally {
      setLoading("");
    }
  }

  async function resend() {
    setLoading("resend");
    setMessage("");
    try {
      const { data } = await resendRegistrationOtp(email);
      setOtp("");
      setAttempts(0);
      setExpiresIn(300);
      setResendIn(data.resendAfterSeconds || 60);
      setMessage(data.message || "OTP resent.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not resend OTP"));
    } finally {
      setLoading("");
    }
  }

  const locked = attempts >= 5;

  return (
    <form className="retela-wizard-step" onSubmit={verify}>
      <CheckCircle2 className="text-emerald-600" size={46} />
      <div>
        <h3 className="font-display text-xl font-bold text-slate-900">Gmail OTP Verification</h3>
        <p className="mt-1 text-sm text-slate-500">Enter the 6-digit OTP sent to {email}. Expires in {timeLabel}.</p>
      </div>
      <Field icon={KeyRound} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="6-digit OTP" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} />
      <p className="text-xs font-semibold text-slate-500">{Math.max(0, 5 - attempts)} attempts remaining</p>
      {message ? <p className="retela-register-alert">{message}</p> : null}
      <div className="retela-wizard-actions">
        <Button type="button" variant="secondary" disabled={loading === "resend" || resendIn > 0} onClick={resend}>
          {loading === "resend" ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend OTP"}
        </Button>
        <Button type="submit" disabled={loading === "verify" || locked || otp.length !== 6 || expiresIn <= 0}>
          {loading === "verify" ? <><Loader2 className="animate-spin" size={16} /> Verifying</> : "Verify OTP"}
        </Button>
      </div>
    </form>
  );
}
