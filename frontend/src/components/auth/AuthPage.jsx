import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Mail, MapPin, Phone, RotateCcw, ShieldCheck, User } from "lucide-react";
import { api, cachedGet, getApiErrorMessage } from "../../api/client";
import { logoFromSettings, RETELA_LOGO_URL } from "../../config/branding";
import { useAuth } from "../../context/AuthContext";
import { getPasswordBlueprint, getPasswordStrength, PasswordBlueprint } from "../PasswordBlueprint";
import { Button, Field } from "../ui";
import Register from "./Register";

function savedLogoUrl() {
  const cached = localStorage.getItem("retela_logo_url");
  return cached && !cached.includes("scontent.") ? cached : RETELA_LOGO_URL;
}

export default function AuthPage() {
  const { login } = useAuth();
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupStep, setSignupStep] = useState("form");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState("phone");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [signupForm, setSignupForm] = useState({ username: "", email: "", phoneNumber: "", location: "", otp: "", password: "", confirmPassword: "" });
  const [resetForm, setResetForm] = useState({ phoneNumber: "", otp: "", password: "", confirmPassword: "" });
  const [logoUrl, setLogoUrl] = useState(savedLogoUrl);
  const signupPasswordBlueprint = useMemo(() => getPasswordBlueprint(signupForm.password), [signupForm.password]);
  const signupPasswordStrength = useMemo(() => getPasswordStrength(signupPasswordBlueprint), [signupPasswordBlueprint]);
  const signupPasswordStrong = signupPasswordBlueprint.every((item) => item.met);
  const resetPasswordBlueprint = useMemo(() => getPasswordBlueprint(resetForm.password), [resetForm.password]);
  const resetPasswordStrength = useMemo(() => getPasswordStrength(resetPasswordBlueprint), [resetPasswordBlueprint]);
  const resetPasswordStrong = resetPasswordBlueprint.every((item) => item.met);

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

  function normalizePhoneInput(value) {
    return value.replace(/\D/g, "").slice(0, 11);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setMessage("");
    setLoading("login");
    try {
      await login(loginForm);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Invalid credentials or email OTP is not verified yet"));
    } finally {
      setLoading("");
    }
  }

  async function submitSignup(event) {
    event.preventDefault();
    setMessage("");
    if (signupForm.password !== signupForm.confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }
    if (signupForm.username === "AdministratorRetela" && signupForm.password === "Retela2026") {
      setLoading("signup");
      try {
        await login({ username: signupForm.username, password: signupForm.password });
      } catch (error) {
        setMessage(getApiErrorMessage(error, "Admin login failed"));
      } finally {
        setLoading("");
      }
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
      const { data } = await api.post("/auth/password-reset/request", { phoneNumber: resetForm.phoneNumber });
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
      const { data } = await api.post("/auth/password-reset/request", { phoneNumber: resetForm.phoneNumber });
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
        phoneNumber: resetForm.phoneNumber,
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
        phoneNumber: resetForm.phoneNumber,
        password: resetForm.password
      });
      setMessage(data.message);
      setResetOpen(false);
      setResetStep("phone");
      setSignupOpen(false);
      setLoginForm({ ...loginForm, username: resetForm.phoneNumber, password: "" });
      setResetForm({ phoneNumber: "", otp: "", password: "", confirmPassword: "" });
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not change password"));
    } finally {
      setLoading("");
    }
  }

  function openSignup() {
    setSignupOpen(true);
    setResetOpen(false);
    setSignupStep("form");
    setMessage("");
  }

  function closeSignup() {
    setSignupOpen(false);
    setResetOpen(false);
    setSignupStep("form");
    setResetStep("phone");
    setMessage("");
  }

  function openReset() {
    setResetOpen(true);
    setSignupOpen(false);
    setResetStep("phone");
    setMessage("");
  }

  const Spinner = () => <Loader2 className="animate-spin" size={16} />;

  return (
    <main className="auth-shell grid place-items-center overflow-x-hidden p-4 py-6">
      <div className={`auth-card grid w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-2xl md:min-h-[640px] md:grid-cols-2 ${(signupOpen || resetOpen) ? "auth-card-shifted" : ""}`}>
        <section className="auth-info-panel hidden flex-col justify-center bg-emerald-700 p-12 text-white md:flex">
          <img src={logoUrl} className="mb-6 h-20 w-20 rounded-3xl border border-white/30 bg-white object-cover" alt="RETELA SYSTEM logo" />
          <h1 className="font-display text-4xl font-bold">Retela</h1>
          <p className="mt-4 text-lg text-white/90">Sales, inventory, and ecommerce management for Tela to Pera Thrift Shop.</p>
          <Button variant="secondary" className="mt-8 w-fit border-white/20 bg-white/10 text-white hover:bg-white hover:text-emerald-800" onClick={(signupOpen || resetOpen) ? closeSignup : openSignup}>
            {(signupOpen || resetOpen) ? "Back to Login" : "Register"}
          </Button>
        </section>

        <section className="auth-form-panel p-5 sm:p-7 md:p-12">
          <div className="mb-4 flex items-center gap-3 md:hidden">
            <img src={logoUrl} className="h-12 w-12 rounded-2xl border border-emerald-100 bg-white object-cover shadow-sm" alt="RETELA SYSTEM logo" />
            <div>
              <p className="font-display text-xl font-bold text-emerald-900">RETELA</p>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Commerce System</p>
            </div>
          </div>
          {!signupOpen ? (
            !resetOpen ? (
            <form name="retela-login-form" data-feature="auth-login" onSubmit={submitLogin} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <div>
                <h2 className="mt-2 font-display text-3xl font-bold uppercase">Login</h2>
              </div>
              <Field id="login-username" name="username" autoComplete="username" icon={User} placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} />
              <Field id="login-password" name="password" autoComplete="current-password" icon={KeyRound} type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
              <Button type="submit" disabled={loading === "login"}>{loading === "login" ? <><Spinner /> Logging in</> : "Login"}</Button>
              <button type="button" className="text-sm font-semibold text-bluebrand" onClick={openReset}>Forgot password?</button>
              <button type="button" className="text-sm font-semibold text-bluebrand" onClick={openSignup}>No account? Register first</button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
            ) : null
          ) : null}

          {resetOpen && resetStep === "phone" ? (
            <form name="retela-password-reset-request-form" data-feature="auth-password-reset-request" onSubmit={requestPasswordReset} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">Password reset</p>
                <h2 className="mt-2 font-display text-3xl font-bold">Verify phone</h2>
              </div>
              <Field id="reset-phone-number" name="phoneNumber" autoComplete="tel" icon={Phone} placeholder="Phone number" value={resetForm.phoneNumber} onChange={(e) => setResetForm({ ...resetForm, phoneNumber: e.target.value })} />
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
              <button type="button" className="text-sm font-semibold text-slate-500" onClick={() => setResetStep("phone")}>Change phone number</button>
              {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
            </form>
          ) : null}

          {resetOpen && resetStep === "password" ? (
            <form name="retela-password-reset-complete-form" data-feature="auth-password-reset-complete" onSubmit={completePasswordReset} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
              <div>
                <p className="font-display text-sm font-semibold text-bluebrand">Phone verified</p>
                <h2 className="mt-2 font-display text-3xl font-bold">New password</h2>
              </div>
              <Field id="reset-new-password" name="newPassword" autoComplete="new-password" icon={KeyRound} type="password" placeholder="New password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} />
              <PasswordBlueprint blueprint={resetPasswordBlueprint} strength={resetPasswordStrength} />
              <Field id="reset-confirm-password" name="confirmNewPassword" autoComplete="new-password" icon={KeyRound} type="password" placeholder="Confirm new password" value={resetForm.confirmPassword} onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })} />
              <Button type="submit" disabled={loading === "reset-complete"}>{loading === "reset-complete" ? <><Spinner /> Changing password</> : "Change password"}</Button>
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
    </main>
  );
}
