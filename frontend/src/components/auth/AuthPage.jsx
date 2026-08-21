import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Mail, RotateCcw, ShieldCheck, User, UserPlus } from "lucide-react";
import { api, cachedGet, getApiErrorMessage } from "../../api/client";
import { logoFromSettings, RETELA_LOGO_URL } from "../../config/branding";
import { useAuth } from "../../context/AuthContext";
import { getPasswordBlueprint, getPasswordStrength, PasswordBlueprint } from "../PasswordBlueprint";
import { Button, Field } from "../ui";
import Register from "./Register";
import RegistrationAgreementModal from "./RegistrationAgreementModal";

function savedLogoUrl() {
  const cached = localStorage.getItem("retela_logo_url");
  return cached && !cached.includes("scontent.") ? cached : RETELA_LOGO_URL;
}

let recaptchaScriptPromise;

function loadRecaptchaScript() {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (recaptchaScriptPromise) return recaptchaScriptPromise;
  recaptchaScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("retela-recaptcha-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.grecaptcha), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "retela-recaptcha-script";
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.grecaptcha);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return recaptchaScriptPromise;
}

function RecaptchaCheckbox({ siteKey, resetKey, onChange, onExpired, onError }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadRecaptchaScript()
      .then((grecaptcha) => {
        grecaptcha.ready(() => {
          if (cancelled || !containerRef.current || widgetIdRef.current !== null) return;
          widgetIdRef.current = grecaptcha.render(containerRef.current, {
            sitekey: siteKey,
            callback: onChange,
            "expired-callback": onExpired,
            "error-callback": onError
          });
        });
      })
      .catch(onError);
    return () => {
      cancelled = true;
    };
  }, [siteKey, onChange, onExpired, onError]);

  useEffect(() => {
    if (!siteKey || widgetIdRef.current === null || !window.grecaptcha?.reset) return;
    window.grecaptcha.reset(widgetIdRef.current);
  }, [siteKey, resetKey]);

  if (!siteKey) {
    return <p className="auth-captcha-config">CAPTCHA is not configured for this environment.</p>;
  }

  return (
    <div className="auth-captcha-box" aria-label="CAPTCHA verification">
      <div ref={containerRef} />
    </div>
  );
}

export default function AuthPage() {
  const { login } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);
  const [registrationAgreementOpen, setRegistrationAgreementOpen] = useState(false);
  const [signupStep, setSignupStep] = useState("form");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState("email");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [signupForm, setSignupForm] = useState({ username: "", email: "", phoneNumber: "", location: "", otp: "", password: "", confirmPassword: "" });
  const [resetForm, setResetForm] = useState({ email: "", otp: "", password: "", confirmPassword: "" });
  const [logoUrl, setLogoUrl] = useState(savedLogoUrl);
  const signupPasswordBlueprint = useMemo(() => getPasswordBlueprint(signupForm.password), [signupForm.password]);
  const signupPasswordStrength = useMemo(() => getPasswordStrength(signupPasswordBlueprint), [signupPasswordBlueprint]);
  const signupPasswordStrong = signupPasswordBlueprint.every((item) => item.met);
  const resetPasswordBlueprint = useMemo(() => getPasswordBlueprint(resetForm.password), [resetForm.password]);
  const resetPasswordStrength = useMemo(() => getPasswordStrength(resetPasswordBlueprint), [resetPasswordBlueprint]);
  const resetPasswordStrong = resetPasswordBlueprint.every((item) => item.met);
  const captchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || "";
  const captchaConfigured = Boolean(captchaSiteKey);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("reCAPTCHA configured:", captchaConfigured);
    }
  }, [captchaConfigured]);

  useEffect(() => {
    let cancelled = false;
    document.documentElement.classList.remove("retela-dark");
    document.documentElement.style.colorScheme = "light";
    cachedGet("/settings/public", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        const nextLogo = logoFromSettings(data);
        setLogoUrl(nextLogo);
        localStorage.setItem("retela_logo_url", nextLogo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitLogin(event) {
    event.preventDefault();
    if (loading === "login") return;
    setMessage("");
    if (!captchaConfigured) {
      setMessage("CAPTCHA is not configured. Please contact support.");
      return;
    }
    if (!captchaToken) {
      setMessage("Please complete the CAPTCHA first.");
      return;
    }
    setLoading("login");
    try {
      await login({ ...loginForm, captchaToken });
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Login is taking longer than expected. Please try again."));
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
    } finally {
      setLoading("");
    }
  }

  const handleCaptchaChange = useCallback((token) => {
    setCaptchaToken(token || "");
    setMessage("");
  }, []);

  const handleCaptchaExpired = useCallback(() => {
    setCaptchaToken("");
    setMessage("CAPTCHA expired. Please verify again.");
  }, []);

  const handleCaptchaError = useCallback(() => {
    setCaptchaToken("");
    setMessage("CAPTCHA verification failed. Please try again.");
  }, []);

  async function submitSignup(event) {
    event.preventDefault();
    setMessage("");
    if (signupForm.password !== signupForm.confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }
    if (!/^09\d{9}$/.test(signupForm.phoneNumber)) {
      setMessage("Phone number must be 11 digits and start with 09");
      return;
    }
    if (!signupPasswordStrong) {
      setMessage("Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
      return;
    }
    try {
      setLoading("signup");
      const { data } = await api.post("/auth/register", {
        username: signupForm.username,
        email: signupForm.email,
        phone: signupForm.phoneNumber,
        location: signupForm.location,
        password: signupForm.password
      });
      setSignupStep("otp");
      setMessage(data.message || "We sent a verification code to your email address.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Sign up failed"));
    } finally {
      setLoading("");
    }
  }

  async function verifySignupOtp(event) {
    event.preventDefault();
    setMessage("");
    setLoading("signup-verify");
    try {
      const { data } = await api.post("/auth/verify-otp", {
        contact: signupForm.email || signupForm.phoneNumber,
        otp: signupForm.otp
      });
      setSignupStep("submitted");
      setMessage(data.message);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Invalid or expired OTP"));
    } finally {
      setLoading("");
    }
  }

  async function resendSignupOtp() {
    setMessage("");
    setLoading("signup-resend");
    try {
      const { data } = await api.post("/auth/resend-otp", { contact: signupForm.email || signupForm.phoneNumber });
      setMessage(data.message);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not send OTP again"));
    } finally {
      setLoading("");
    }
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    setMessage("");
    setLoading("reset-request");
    try {
      const { data } = await api.post("/auth/password-reset/request", { email: resetForm.email });
      setResetStep("otp");
      setMessage(data.message);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not send OTP"));
    } finally {
      setLoading("");
    }
  }

  async function resendPasswordReset() {
    setMessage("");
    setLoading("reset-resend");
    try {
      const { data } = await api.post("/auth/password-reset/resend", { email: resetForm.email });
      setMessage(data.message);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not send OTP again"));
    } finally {
      setLoading("");
    }
  }

  async function verifyPasswordReset(event) {
    event.preventDefault();
    setMessage("");
    setLoading("reset-verify");
    try {
      const { data } = await api.post("/auth/password-reset/verify", {
        email: resetForm.email,
        otp: resetForm.otp
      });
      setResetStep("password");
      setMessage(data.message);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Invalid or expired OTP"));
    } finally {
      setLoading("");
    }
  }

  async function completePasswordReset(event) {
    event.preventDefault();
    setMessage("");
    if (resetForm.password !== resetForm.confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }
    if (!resetPasswordStrong) {
      setMessage("Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
      return;
    }
    setLoading("reset-complete");
    try {
      const { data } = await api.post("/auth/password-reset/complete", {
        email: resetForm.email,
        password: resetForm.password
      });
      setMessage(data.message);
      setResetOpen(false);
      setResetStep("email");
      setSignupOpen(false);
      setLoginForm({ ...loginForm, username: resetForm.email, password: "" });
      setResetForm({ email: "", otp: "", password: "", confirmPassword: "" });
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not change password"));
    } finally {
      setLoading("");
    }
  }

  function openSignup() {
    setRegistrationAgreementOpen(true);
    setSignupOpen(false);
    setResetOpen(false);
    setSignupStep("form");
    setMessage("");
  }

  function agreeToRegistration() {
    setRegistrationAgreementOpen(false);
    setSignupOpen(true);
    setResetOpen(false);
    setSignupStep("form");
    setMessage("");
  }

  function disagreeToRegistration() {
    setRegistrationAgreementOpen(false);
    setSignupOpen(false);
    setResetOpen(false);
    setSignupStep("form");
    setMessage("");
  }

  function closeSignup() {
    setSignupOpen(false);
    setRegistrationAgreementOpen(false);
    setResetOpen(false);
    setSignupStep("form");
    setResetStep("email");
    setMessage("");
  }

  function openReset() {
    setResetOpen(true);
    setSignupOpen(false);
    setResetStep("email");
    setMessage("");
  }

  const Spinner = () => <Loader2 className="animate-spin" size={16} />;

  return (
    <main className="auth-shell grid place-items-center overflow-x-hidden px-4 py-6 sm:px-6">
      <div className={`auth-card grid w-full max-w-5xl overflow-hidden bg-white md:min-h-[640px] md:grid-cols-[0.96fr_1.04fr] ${(signupOpen || resetOpen) ? "auth-card-shifted" : ""}`}>
        <section className="auth-info-panel relative flex flex-col justify-center overflow-hidden bg-emerald-800 p-7 text-white sm:p-9 md:p-12">
          <div className="auth-panel-dots" aria-hidden="true" />
          <div className="auth-panel-ring auth-panel-ring-one" aria-hidden="true" />
          <div className="auth-panel-ring auth-panel-ring-two" aria-hidden="true" />
          <div className="relative z-10">
            <img src={logoUrl} className="mb-6 h-20 w-20 rounded-3xl border border-white/30 bg-white object-cover shadow-lg shadow-emerald-950/20" alt="RETELA SYSTEM logo" />
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Retela</h1>
            <p className="mt-4 max-w-sm text-base leading-7 text-white/85 sm:text-lg">Sales, inventory, and ecommerce management for Tela to Pera Thrift Shop.</p>
          </div>
          <Button variant="secondary" className="relative z-10 mt-8 w-fit border-white/30 bg-white/10 px-5 py-3 text-white shadow-none hover:border-white/50 hover:bg-white/15 hover:text-white" onClick={(signupOpen || resetOpen) ? closeSignup : openSignup}>
            <UserPlus size={17} />
            {(signupOpen || resetOpen) ? "Back to Login" : "Register"}
          </Button>
        </section>

        <section className="auth-form-panel bg-white p-5 sm:p-8 md:p-12">
          <div className="mb-4 flex items-center gap-3 md:hidden">
            <img src={logoUrl} className="h-12 w-12 rounded-2xl border border-emerald-100 bg-white object-cover shadow-sm" alt="RETELA SYSTEM logo" />
            <div>
              <p className="font-display text-xl font-bold text-emerald-900">RETELA</p>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Commerce System</p>
            </div>
          </div>
          {!signupOpen ? (
            !resetOpen ? (
            <form name="retela-login-form" data-feature="auth-login" onSubmit={submitLogin} className="auth-login-form mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <h2 className="font-display text-4xl font-black uppercase tracking-[0.08em] text-slate-950">LOGIN</h2>
              <Field id="login-username" name="username" autoComplete="username" icon={User} placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} wrapperClassName="auth-login-field" />
              <Field id="login-password" name="password" autoComplete="current-password" icon={KeyRound} type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} wrapperClassName="auth-login-field" />
              <RecaptchaCheckbox
                siteKey={captchaSiteKey}
                resetKey={captchaResetKey}
                onChange={handleCaptchaChange}
                onExpired={handleCaptchaExpired}
                onError={handleCaptchaError}
              />
              <button type="submit" className="auth-login-button" disabled={loading === "login" || !captchaConfigured}>
                <span>{loading === "login" ? <><Spinner /> Logging in...</> : "Login"}</span>
                {loading === "login" ? null : <ArrowRight size={18} />}
              </button>
              <button type="button" className="auth-forgot-link" onClick={openReset}>Forgot password?</button>
              <div className="auth-divider"><span>or</span></div>
              <p className="text-center text-sm font-semibold text-slate-500">
                No account?{" "}
                <button type="button" className="font-bold text-emerald-700 transition hover:text-emerald-900" onClick={openSignup}>Register first</button>
              </p>
              {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}
            </form>
            ) : null
          ) : null}

          {resetOpen && resetStep === "email" ? (
            <form name="retela-password-reset-request-form" data-feature="auth-password-reset-request" onSubmit={requestPasswordReset} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">Password reset</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Verify email</h2>
              </div>
              <Field id="reset-email" name="email" type="email" autoComplete="email" icon={Mail} placeholder="Email address" value={resetForm.email} onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })} />
              <Button type="submit" disabled={loading === "reset-request"}>{loading === "reset-request" ? <><Spinner /> Sending OTP</> : "Send OTP"}</Button>
              <button type="button" className="text-sm font-semibold text-bluebrand" onClick={closeSignup}>Back to Login</button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
          ) : null}

          {resetOpen && resetStep === "otp" ? (
            <form name="retela-password-reset-code-form" data-feature="auth-password-reset-code" onSubmit={verifyPasswordReset} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <ShieldCheck className="text-bluebrand" size={42} />
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">OTP sent</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Enter code</h2>
              </div>
              <Field id="reset-otp-code" name="resetOtpCode" autoComplete="one-time-code" icon={KeyRound} inputMode="numeric" maxLength={6} placeholder="6-digit OTP" value={resetForm.otp} onChange={(e) => setResetForm({ ...resetForm, otp: e.target.value.replace(/\D/g, "") })} />
              <Button type="submit" disabled={loading === "reset-verify"}>{loading === "reset-verify" ? <><Spinner /> Verifying</> : "Verify OTP"}</Button>
              <button type="button" className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-bluebrand disabled:opacity-60" onClick={resendPasswordReset} disabled={loading === "reset-resend"}>
                {loading === "reset-resend" ? <Spinner /> : <RotateCcw size={15} />} Send again
              </button>
              <button type="button" className="text-sm font-semibold text-slate-500" onClick={() => setResetStep("email")}>Change email address</button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
          ) : null}

          {resetOpen && resetStep === "password" ? (
            <form name="retela-password-reset-complete-form" data-feature="auth-password-reset-complete" onSubmit={completePasswordReset} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">Email verified</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Create new password</h2>
              </div>
              <Field id="reset-new-password" name="newPassword" autoComplete="new-password" icon={KeyRound} type="password" placeholder="New password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} />
              <PasswordBlueprint blueprint={resetPasswordBlueprint} strength={resetPasswordStrength} />
              <Field id="reset-confirm-password" name="confirmNewPassword" autoComplete="new-password" icon={KeyRound} type="password" placeholder="Confirm new password" value={resetForm.confirmPassword} onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })} />
              <Button type="submit" disabled={loading === "reset-complete"}>{loading === "reset-complete" ? <><Spinner /> Resetting password</> : "Reset password"}</Button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
          ) : null}

          {signupOpen && signupStep === "form" ? (
            <Register
              onBackToLogin={closeSignup}
              message={message}
              setMessage={setMessage}
              onComplete={(data) => {
                setSignupStep("submitted");
                setMessage(data?.message || "Email verified. Your account is ready.");
              }}
            />
          ) : null}

          {signupOpen && signupStep === "otp" ? (
            <form name="retela-signup-code-form" data-feature="auth-signup-code" onSubmit={verifySignupOtp} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <ShieldCheck className="text-bluebrand" size={42} />
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">OTP verification</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Enter code</h2>
              </div>
              <Field id="signup-otp-code" name="signupOtpCode" autoComplete="one-time-code" icon={KeyRound} inputMode="numeric" maxLength={6} placeholder="6-digit OTP" value={signupForm.otp} onChange={(e) => setSignupForm({ ...signupForm, otp: e.target.value.replace(/\D/g, "") })} />
              <Button type="submit" disabled={loading === "signup-verify"}>{loading === "signup-verify" ? <><Spinner /> Verifying</> : "Verify OTP"}</Button>
              <button type="button" className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-bluebrand disabled:opacity-60" onClick={resendSignupOtp} disabled={loading === "signup-resend"}>
                {loading === "signup-resend" ? <Spinner /> : <RotateCcw size={15} />} Send again
              </button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
          ) : null}

          {signupOpen && signupStep === "submitted" ? (
            <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <CheckCircle2 className="text-emerald-500" size={48} />
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">Email verified</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Account ready</h2>
              </div>
              <p className="text-sm text-slate-500">Your account is verified. You can now log in with your username, email, or phone number.</p>
              <Button type="button" onClick={closeSignup}>Back to Login</Button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
      <RegistrationAgreementModal open={registrationAgreementOpen} onAgree={agreeToRegistration} onDisagree={disagreeToRegistration} />
    </main>
  );
}
