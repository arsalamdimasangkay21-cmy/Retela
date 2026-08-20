import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Save, X } from "lucide-react";
import { api, getApiErrorMessage } from "../api/client";
import { getPasswordBlueprint, getPasswordStrength, PasswordBlueprint } from "./PasswordBlueprint";

const emptyPasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
};

const hiddenPasswordFields = {
  currentPassword: false,
  newPassword: false,
  confirmPassword: false
};

export function ChangePasswordForm({ onSuccess, onError } = {}) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(emptyPasswordForm);
  const [visible, setVisible] = useState(hiddenPasswordFields);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const blueprint = useMemo(() => getPasswordBlueprint(form.newPassword), [form.newPassword]);
  const strength = useMemo(() => getPasswordStrength(blueprint), [blueprint]);
  const strong = blueprint.every((item) => item.met);

  function resetForm() {
    setForm(emptyPasswordForm);
    setVisible(hiddenPasswordFields);
    setMessage("");
  }

  function cancelPasswordChange() {
    if (loading) return;
    resetForm();
    setExpanded(false);
  }

  async function submit(event) {
    event.preventDefault();
    setMessage("");

    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setMessage("Complete all password fields");
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    if (!strong) {
      setMessage("Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
      return;
    }

    setLoading(true);
    try {
      await api.patch("/users/me/password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      resetForm();
      setExpanded(false);
      onSuccess?.("Password changed successfully.");
    } catch (error) {
      const nextMessage = getApiErrorMessage(error, "Could not change password");
      setMessage(nextMessage);
      onError?.(nextMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="admin-password-card">
      <div className="admin-password-summary">
        <div className="admin-password-copy">
          <p className="admin-profile-eyebrow">Security</p>
          <h3>Password</h3>
          <span>Keep your account password secure.</span>
        </div>
        {!expanded ? (
          <button type="button" className="admin-password-expand-button" onClick={() => setExpanded(true)}>
            <KeyRound size={16} />
            Change Password
          </button>
        ) : null}
      </div>

      {expanded ? (
        <form name="retela-profile-change-password-form" data-feature="profile-change-password" onSubmit={submit} className="admin-password-form">
          <div className="admin-password-grid">
            <PasswordField id="profile-current-password" name="currentPassword" autoComplete="current-password" visible={visible.currentPassword} onToggle={() => setVisible((state) => ({ ...state, currentPassword: !state.currentPassword }))} placeholder="Current password" value={form.currentPassword} onChange={(event) => setForm((state) => ({ ...state, currentPassword: event.target.value }))} />
            <PasswordField id="profile-new-password" name="newPassword" autoComplete="new-password" visible={visible.newPassword} onToggle={() => setVisible((state) => ({ ...state, newPassword: !state.newPassword }))} placeholder="New password" value={form.newPassword} onChange={(event) => setForm((state) => ({ ...state, newPassword: event.target.value }))} />
            <PasswordField id="profile-confirm-password" name="confirmPassword" autoComplete="new-password" visible={visible.confirmPassword} onToggle={() => setVisible((state) => ({ ...state, confirmPassword: !state.confirmPassword }))} placeholder="Confirm new password" value={form.confirmPassword} onChange={(event) => setForm((state) => ({ ...state, confirmPassword: event.target.value }))} />
          </div>

          <div className="admin-password-blueprint">
            <PasswordBlueprint blueprint={blueprint} strength={strength} />
          </div>

          {message ? <p className="admin-password-message">{message}</p> : null}

          <div className="admin-password-actions">
            <button type="button" className="admin-profile-cancel-button" disabled={loading} onClick={cancelPasswordChange}>
              <X size={16} />
              Cancel
            </button>
            <button type="submit" className="admin-profile-save-button" disabled={loading || !form.currentPassword || !form.newPassword || !form.confirmPassword}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Change Password
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function PasswordField({ visible, onToggle, ...props }) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <label className="admin-password-field">
      <KeyRound size={18} className="admin-password-field-icon" />
      <input type={visible ? "text" : "password"} {...props} />
      <button type="button" onClick={onToggle} className="admin-password-visibility-button" aria-label={visible ? "Hide password" : "Show password"}>
        <Icon size={17} />
      </button>
    </label>
  );
}
