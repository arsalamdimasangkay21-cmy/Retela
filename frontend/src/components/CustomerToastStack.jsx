import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

const toastIcons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

export function dispatchCustomerToast(toast) {
  if (typeof window === "undefined") return;
  const message = typeof toast === "string" ? toast : toast?.message;
  if (!message) return;
  window.dispatchEvent(new CustomEvent("retela:customer-toast", {
    detail: {
      type: "info",
      duration: 3200,
      ...(typeof toast === "string" ? { message } : toast)
    }
  }));
}

export default function CustomerToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="customer-toast-stack" role="region" aria-label="Customer notifications">
      {toasts.map((toast) => {
        const type = ["success", "error", "warning", "info"].includes(toast.type) ? toast.type : "info";
        const Icon = toastIcons[type];
        return (
          <div key={toast.id} className={`customer-toast customer-toast-${type}`} role="status" aria-live="polite">
            <span className="customer-toast-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <div className="customer-toast-content">
              {toast.title ? <strong>{toast.title}</strong> : null}
              <p>{toast.message}</p>
              {toast.actionLabel ? (
                <button
                  type="button"
                  className="customer-toast-action"
                  onClick={() => {
                    toast.onAction?.();
                    onDismiss?.(toast.id);
                  }}
                >
                  {toast.actionLabel}
                </button>
              ) : null}
            </div>
            <button type="button" className="customer-toast-close" onClick={() => onDismiss?.(toast.id)} aria-label="Close notification">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
