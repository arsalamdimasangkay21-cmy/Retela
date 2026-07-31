import { createPortal } from "react-dom";
import { Button } from "../ui";

export default function TermsModal({ open, onClose, onUnderstand }) {
  if (!open) return null;
  return createPortal(
    <div className="retela-register-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="retela-register-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="terms-title" className="font-display text-2xl font-bold text-slate-900">Terms & Conditions</h2>
        <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-600">
          <p>Welcome to RETELA.</p>
          <p>By creating an account you agree to:</p>
          <ul className="grid gap-2 pl-5">
            <li>Provide accurate information.</li>
            <li>One account per person.</li>
            <li>Keep your password secure.</li>
            <li>Submit a real government-issued ID.</li>
            <li>Complete face verification.</li>
            <li>Complete Gmail OTP verification.</li>
            <li>Fake information may permanently suspend the account.</li>
            <li>RETELA may store verification documents securely.</li>
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" onClick={onUnderstand}>I Understand</Button>
        </div>
      </section>
    </div>,
    document.body
  );
}
