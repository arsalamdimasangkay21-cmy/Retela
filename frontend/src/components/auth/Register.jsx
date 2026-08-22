import { useEffect, useMemo, useState } from "react";
import { CalendarDays, KeyRound, Loader2, Mail, Phone, User } from "lucide-react";
import { checkRegistrationField, validateRegistration } from "../../api/registration";
import { getApiErrorMessage } from "../../api/client";
import { getPasswordBlueprint, getPasswordStrength, PasswordBlueprint } from "../PasswordBlueprint";
import StructuredLocationPicker from "../StructuredLocationPicker";
import { Button, Field } from "../ui";
import { locationValidationMessage, registrationFieldsFromLocation } from "../../utils/location";
import PrivacyPolicyModal from "./PrivacyPolicyModal";
import TermsModal from "./TermsModal";
import VerificationWizard from "./VerificationWizard";
import "./Register.css";

const initialForm = {
  username: "",
  displayName: "",
  email: "",
  phone: "",
  location: "",
  formattedAddress: "",
  barangay: "",
  municipality: "",
  province: "",
  region: "",
  postalCode: "",
  latitude: null,
  longitude: null,
  placeId: "",
  locationSource: "",
  birthday: "",
  gender: "",
  password: "",
  confirmPassword: ""
};

export default function Register({ onBackToLogin, onComplete, message, setMessage }) {
  const [form, setForm] = useState(initialForm);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [validationRunning, setValidationRunning] = useState(false);
  const [availabilityRunning, setAvailabilityRunning] = useState({});
  const [termsOpen, setTermsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const passwordBlueprint = useMemo(() => getPasswordBlueprint(form.password), [form.password]);
  const passwordStrength = useMemo(() => getPasswordStrength(passwordBlueprint), [passwordBlueprint]);
  const passwordStrong = passwordBlueprint.every((item) => item.met);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      ...(field === "password" || field === "confirmPassword" ? { confirmPassword: undefined } : {})
    }));
  }

  function normalizePhone(value) {
    return value.replace(/\D/g, "").slice(0, 11);
  }

  const checkingAvailability = Object.values(availabilityRunning).some(Boolean);

  function validateLocal(values = form, termsAccepted = accepted) {
    const nextErrors = {};
    const username = values.username.trim();
    if (!username) nextErrors.username = "Username is required.";
    else if (username.length < 4 || username.length > 20) nextErrors.username = "Username must be between 4 and 20 characters.";
    else if (!/^[A-Za-z0-9_]+$/.test(username)) nextErrors.username = "Username contains invalid characters.";
    if (!values.displayName.trim()) nextErrors.displayName = "Display Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) nextErrors.email = "Invalid email address.";
    if (!/^09\d{9}$/.test(values.phone)) nextErrors.phone = "Invalid phone number.";
    const locationError = locationValidationMessage({
      formattedAddress: values.formattedAddress || values.location,
      barangay: values.barangay,
      municipality: values.municipality,
      province: values.province,
      region: values.region,
      postalCode: values.postalCode,
      latitude: values.latitude,
      longitude: values.longitude,
      placeId: values.placeId,
      locationSource: values.locationSource
    });
    if (locationError) nextErrors.location = locationError;
    if (!values.birthday) nextErrors.birthday = "Birthday is required.";
    if (!values.gender) nextErrors.gender = "Gender is required.";
    if (!values.password) nextErrors.password = "Password is required.";
    else if (values.password.length < 8) nextErrors.password = "Password must contain at least 8 characters.";
    else if (!passwordStrong) nextErrors.password = "Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.";
    if (!values.confirmPassword || values.password !== values.confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (!termsAccepted) nextErrors.accepted = "Please accept the Terms & Conditions.";
    return nextErrors;
  }

  function fieldIsReadyForAvailability(field, value) {
    if (field === "username") return value.trim().length >= 4 && value.trim().length <= 20 && /^[A-Za-z0-9_]+$/.test(value.trim());
    if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    if (field === "phone") return /^09\d{9}$/.test(value);
    return false;
  }

  useEffect(() => {
    const checks = [
      ["username", form.username],
      ["email", form.email],
      ["phone", form.phone]
    ].filter(([field, value]) => fieldIsReadyForAvailability(field, value));
    if (!checks.length) return undefined;

    let active = true;
    const timer = window.setTimeout(() => {
      checks.forEach(async ([field, value]) => {
        setAvailabilityRunning((current) => ({ ...current, [field]: true }));
        try {
          await checkRegistrationField(field, value);
          if (!active) return;
          setErrors((current) => current[field] ? ({ ...current, [field]: undefined }) : current);
        } catch (error) {
          if (!active) return;
          const fieldError = error?.response?.data?.errors?.[field];
          if (fieldError) setErrors((current) => ({ ...current, [field]: fieldError }));
        } finally {
          if (active) setAvailabilityRunning((current) => ({ ...current, [field]: false }));
        }
      });
    }, 450);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.email, form.phone, form.username]);

  function markTouched(field) {
    setTouched((current) => ({ ...current, [field]: true }));
    const localError = validateLocal()[field];
    if (localError) setErrors((current) => ({ ...current, [field]: localError }));
  }

  function displayedError(field) {
    return touched[field] || errors[field] ? errors[field] : "";
  }

  function updateLocation(location) {
    setForm((current) => ({ ...current, ...registrationFieldsFromLocation(location) }));
    setErrors((current) => ({ ...current, location: undefined }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    const allTouched = Object.keys(initialForm).reduce((next, field) => ({ ...next, [field]: true }), { accepted: true });
    setTouched(allTouched);
    const localErrors = validateLocal();
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }
    setValidationRunning(true);
    try {
      await validateRegistration({ ...form, accepted });
      setErrors({});
      setWizardOpen(true);
    } catch (error) {
      const responseErrors = error?.response?.data?.errors;
      if (responseErrors) setErrors(responseErrors);
      else setMessage(getApiErrorMessage(error, "Could not validate registration details."));
    } finally {
      setValidationRunning(false);
    }
  }

  function completed(data) {
    setWizardOpen(false);
    setForm(initialForm);
    setAccepted(false);
    onComplete?.(data);
  }

  return (
    <>
      <form name="retela-signup-form" data-feature="auth-signup" onSubmit={submit} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4">
        <div>
          <h2 className="mt-2 font-display text-3xl font-bold">Register</h2>
        </div>
        <ValidatedField error={displayedError("username")} loading={availabilityRunning.username}>
          <Field id="signup-username" name="username" autoComplete="username" icon={User} placeholder="Username" value={form.username} invalid={Boolean(displayedError("username"))} onBlur={() => markTouched("username")} onChange={(event) => update("username", event.target.value)} />
        </ValidatedField>
        <ValidatedField error={displayedError("displayName")}>
          <Field id="signup-display-name" name="displayName" autoComplete="name" icon={User} placeholder="Display name" value={form.displayName} invalid={Boolean(displayedError("displayName"))} onBlur={() => markTouched("displayName")} onChange={(event) => update("displayName", event.target.value)} />
        </ValidatedField>
        <ValidatedField error={displayedError("email")} loading={availabilityRunning.email}>
          <Field id="signup-email" name="email" autoComplete="email" icon={Mail} type="email" placeholder="Email address" value={form.email} invalid={Boolean(displayedError("email"))} onBlur={() => markTouched("email")} onChange={(event) => update("email", event.target.value)} />
        </ValidatedField>
        <ValidatedField error={displayedError("phone")} loading={availabilityRunning.phone}>
          <Field id="signup-phone-number" name="phoneNumber" autoComplete="tel-national" icon={Phone} inputMode="numeric" maxLength={11} placeholder="Phone number" value={form.phone} invalid={Boolean(displayedError("phone"))} onBlur={() => markTouched("phone")} onChange={(event) => update("phone", normalizePhone(event.target.value))} />
        </ValidatedField>
        <StructuredLocationPicker
          value={{
            formattedAddress: form.formattedAddress || form.location,
            barangay: form.barangay,
            municipality: form.municipality,
            province: form.province,
            region: form.region,
            postalCode: form.postalCode,
            latitude: form.latitude,
            longitude: form.longitude,
            placeId: form.placeId,
            locationSource: form.locationSource
          }}
          onChange={updateLocation}
          onBlur={() => markTouched("location")}
          error={displayedError("location")}
          compact
          label="Search location"
          placeholder="Agriculture, Midsayap, Cotabato"
        />
        <ValidatedField error={displayedError("birthday")}>
          <Field id="signup-birthday" name="birthday" autoComplete="bday" icon={CalendarDays} type="date" placeholder="Birthday" value={form.birthday} invalid={Boolean(displayedError("birthday"))} onBlur={() => markTouched("birthday")} onChange={(event) => update("birthday", event.target.value)} />
        </ValidatedField>
        <ValidatedField error={displayedError("gender")}>
        <label className={`retela-register-select-wrap ${displayedError("gender") ? "retela-register-invalid" : ""}`}>
          <User size={18} className="shrink-0 text-emerald-600" />
          <select value={form.gender} onBlur={() => markTouched("gender")} onChange={(event) => update("gender", event.target.value)} aria-label="Gender">
            <option value="">Gender</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </label>
        </ValidatedField>
        <ValidatedField error={displayedError("password")}>
          <Field id="signup-password" name="password" autoComplete="new-password" icon={KeyRound} type="password" placeholder="Password" value={form.password} invalid={Boolean(displayedError("password"))} onBlur={() => markTouched("password")} onChange={(event) => update("password", event.target.value)} />
        </ValidatedField>
        <PasswordBlueprint blueprint={passwordBlueprint} strength={passwordStrength} />
        <ValidatedField error={displayedError("confirmPassword")}>
          <Field id="signup-confirm-password" name="confirmPassword" autoComplete="new-password" icon={KeyRound} type="password" placeholder="Confirm password" value={form.confirmPassword} invalid={Boolean(displayedError("confirmPassword"))} onBlur={() => markTouched("confirmPassword")} onChange={(event) => update("confirmPassword", event.target.value)} />
        </ValidatedField>
        <div className={`retela-terms-row ${displayedError("accepted") ? "retela-register-invalid" : ""}`}>
          <input id="signup-terms-accepted" type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked); setErrors((current) => ({ ...current, accepted: undefined })); }} />
          <label htmlFor="signup-terms-accepted">
            I have read and agree to the{" "}
            <button type="button" className="retela-policy-link" onClick={() => setTermsOpen(true)}>Terms & Conditions</button>
            {" "}and{" "}
            <button type="button" className="retela-policy-link" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button>.
          </label>
        </div>
        {displayedError("accepted") ? <p className="retela-register-error">{displayedError("accepted")}</p> : null}
        <Button type="submit" disabled={!accepted || validationRunning || checkingAvailability}>
          {validationRunning ? <><Loader2 className="animate-spin" size={16} /> Validating</> : "Register"}
        </Button>
        <button type="button" className="text-sm font-semibold text-bluebrand transition hover:text-neonbrand" onClick={onBackToLogin}>Back to Login</button>
        {message ? <p className="retela-register-alert retela-register-alert-danger">{message}</p> : null}
      </form>

      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} onUnderstand={() => { setAccepted(true); setErrors((current) => ({ ...current, accepted: undefined })); setTermsOpen(false); }} />
      <PrivacyPolicyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <VerificationWizard open={wizardOpen} registration={{ ...form, accepted }} onClose={() => setWizardOpen(false)} onComplete={completed} />
    </>
  );
}

function ValidatedField({ children, error, loading }) {
  return (
    <div className="grid gap-1">
      {children}
      {loading ? <p className="retela-register-hint"><Loader2 className="inline animate-spin" size={13} /> Checking...</p> : null}
      {error ? <p className="retela-register-error">{error}</p> : null}
    </div>
  );
}
