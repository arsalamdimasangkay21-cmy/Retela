import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, Save } from "lucide-react";
import { api, getApiErrorMessage } from "../api/client";
import { Button } from "./ui";
import { getPasswordBlueprint, getPasswordStrength, PasswordBlueprint } from "./PasswordBlueprint";

export function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [visible, setVisible] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const blueprint = useMemo(() => getPasswordBlueprint(form.newPassword), [form.newPassword]);
  const strength = useMemo(() => getPasswordStrength(blueprint), [blueprint]);
  const strong = blueprint.every((item) => item.met);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
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
      const { data } = await api.patch("/users/me/password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      setMessage(data.message);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not change password"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form name="retela-profile-change-password-form" data-feature="profile-change-password" onSubmit={submit} className="mt-6 grid gap-3 border-t border-white/10 pt-5 md:grid-cols-2">
      <div className="md:col-span-2">
        <h4 className="font-display text-lg font-bold">Change Password</h4>
      </div>
      <PasswordField id="profile-current-password" name="currentPassword" autoComplete="current-password" visible={visible.currentPassword} onToggle={() => setVisible({ ...visible, currentPassword: !visible.currentPassword })} placeholder="Current password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      <PasswordField id="profile-new-password" name="newPassword" autoComplete="new-password" visible={visible.newPassword} onToggle={() => setVisible({ ...visible, newPassword: !visible.newPassword })} placeholder="New password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      <div className="md:col-span-2">
        <PasswordBlueprint blueprint={blueprint} strength={strength} />
      </div>
      <PasswordField id="profile-confirm-password" name="confirmPassword" autoComplete="new-password" visible={visible.confirmPassword} onToggle={() => setVisible({ ...visible, confirmPassword: !visible.confirmPassword })} placeholder="Confirm new password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
      <Button type="submit" disabled={loading || !form.currentPassword || !form.newPassword || !form.confirmPassword} className="md:w-fit"><Save size={17} /> {loading ? "Changing" : "Change Password"}</Button>
      {message ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700 md:col-span-2">{message}</p> : null}
    </form>
  );
}

function PasswordField({ visible, onToggle, ...props }) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <label className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5 shadow-sm transition focus-within:border-neonbrand/60 focus-within:ring-4 focus-within:ring-neonbrand/10">
      <KeyRound size={18} className="shrink-0 text-neonbrand" />
      <input className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35" type={visible ? "text" : "password"} {...props} />
      <button type="button" onClick={onToggle} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white/50 transition hover:bg-white/10 hover:text-neonbrand" aria-label={visible ? "Hide password" : "Show password"}>
        <Icon size={17} />
      </button>
    </label>
  );
}
