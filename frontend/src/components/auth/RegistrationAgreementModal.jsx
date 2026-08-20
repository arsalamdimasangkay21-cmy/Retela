import { createPortal } from "react-dom";
import { Button } from "../ui";
import "./Register.css";

export default function RegistrationAgreementModal({ open, onAgree, onDisagree }) {
  if (!open) return null;

  return createPortal(
    <div className="retela-register-modal-backdrop" role="presentation" onMouseDown={onDisagree}>
      <section
        className="retela-register-modal retela-registration-agreement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-agreement-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="retela-registration-agreement-content">
          <h2 id="registration-agreement-title" className="font-display text-2xl font-bold text-slate-900">Registration Agreement</h2>
          <div className="mt-4 grid gap-4 text-sm leading-6 text-slate-600">
            <p>By continuing with registration, you confirm that you have read and understood this agreement.</p>
            <p>By creating a RETELA account, you agree to provide accurate and valid information during registration. Your account information will be used to support your shopping experience, order processing, account verification, and other services provided by Tela to Pera Thrift Shop.</p>
            <p>You are responsible for keeping your account information secure and for using RETELA appropriately. By selecting Agree, you consent to the collection and use of the information you provide for legitimate account, order, verification, and customer service purposes in accordance with the shop's applicable policies.</p>
          </div>
        </div>
        <div className="retela-registration-agreement-actions">
          <Button type="button" variant="secondary" onClick={onDisagree}>Disagree</Button>
          <Button type="button" onClick={onAgree}>Agree</Button>
        </div>
      </section>
    </div>,
    document.body
  );
}
