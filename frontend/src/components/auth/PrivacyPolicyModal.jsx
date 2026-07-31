import { createPortal } from "react-dom";
import { Button } from "../ui";

export default function PrivacyPolicyModal({ open, onClose }) {
  if (!open) return null;
  return createPortal(
    <div className="retela-register-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="retela-register-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="privacy-title" className="font-display text-2xl font-bold text-slate-900">Privacy Policy</h2>
        <div className="mt-4 grid gap-4 text-sm leading-6 text-slate-600">
          <div>
            <p className="font-bold text-slate-900">RETELA collects:</p>
            <ul className="mt-2 grid gap-2 pl-5">
              <li>Name</li>
              <li>Email</li>
              <li>Phone Number</li>
              <li>Address</li>
              <li>Government ID</li>
              <li>Selfie</li>
              <li>Face Verification Result</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-slate-900">Purpose:</p>
            <ul className="mt-2 grid gap-2 pl-5">
              <li>Identity Verification</li>
              <li>Account Security</li>
              <li>Fraud Prevention</li>
            </ul>
          </div>
          <p>Documents are only visible to authorized administrators.</p>
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={onClose}>Close</Button>
        </div>
      </section>
    </div>,
    document.body
  );
}
