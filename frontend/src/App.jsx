import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import AuthPage from "./components/auth/AuthPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { FloatingCustomerAssistant } from "./components/FloatingCustomerAssistant";
import AppLayout from "./components/layout/AppLayout";
import { api, clearGetCache } from "./api/client";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AdminDashboard from "./pages/AdminDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import PosPage from "./pages/PosPage";

function Shell() {
  const { user, authReady } = useAuth();
  const [active, setActive] = useState(user?.role === "admin" ? "Dashboard" : user?.role === "staff" ? "POS" : "Home");
  const [paymentReturn, setPaymentReturn] = useState(null);

  useEffect(() => {
    if (user?.role === "admin") setActive("Dashboard");
    if (user?.role === "staff") setActive("POS");
    if (user?.role === "customer") setActive("Home");
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user || user.role !== "customer") return;
    const path = window.location.pathname;
    if (!path.startsWith("/payment/success") && !path.startsWith("/payment/cancel")) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order");
    const success = path.includes("success");
    setActive("Orders");
    setPaymentReturn({ loading: true, success, orderId, details: null });
    if (orderId) {
      const request = success ? api.post(`/payments/orders/${orderId}/verify`) : api.get(`/payments/status/${orderId}`);
      request
        .then(({ data }) => {
          const details = data?.order || data;
          clearGetCache("/orders");
          window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "order_update", payload: details } }));
          setPaymentReturn({
            loading: false,
            success,
            orderId,
            details,
            confirmed: Boolean(data?.confirmed || details?.payment_status === "paid")
          });
        })
        .catch(() => setPaymentReturn({ loading: false, success, orderId, details: null, confirmed: false }));
    } else {
      setPaymentReturn({ loading: false, success, orderId: null, details: null, confirmed: false });
    }
    window.history.replaceState({}, "", "/");
  }, [user]);

  if (!authReady) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center text-white">
        <div>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-400/30 border-t-emerald-400" />
          <p className="mt-4 text-sm font-bold text-white/70">Restoring your RETELA session...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <AppLayout active={active} onChange={setActive}>
      {user.role === "admin" ? <AdminDashboard active={active} onChange={setActive} /> : user.role === "staff" ? <PosPage /> : <CustomerDashboard active={active} onChange={setActive} />}
      {user.role === "customer" ? <FloatingCustomerAssistant /> : null}
      {paymentReturn ? <PaymentReturnNotice data={paymentReturn} onClose={() => setPaymentReturn(null)} /> : null}
    </AppLayout>
  );
}

function PaymentReturnNotice({ data, onClose }) {
  const Icon = data.success ? CheckCircle2 : XCircle;
  const paid = data.details?.payment_status === "paid" || data.confirmed;
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-2xl shadow-slate-300/60">
        <Icon className={`mx-auto ${data.success ? "text-emerald-600" : "text-rose-500"}`} size={48} />
        <h3 className="mt-4 font-display text-2xl font-bold">{data.success ? paid ? "Payment Confirmed" : "Payment Submitted" : "Payment Cancelled"}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {data.success
            ? paid
              ? "PayMongo confirmed your payment. Your order status has been updated."
              : "We are verifying your PayMongo payment. Your order status will update automatically."
            : "Your payment was cancelled or failed. You can retry from your Orders page."}
        </p>
        {data.details ? (
          <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-sm">
            <p><strong>Order:</strong> #{data.details.id}</p>
            <p><strong>Status:</strong> {data.details.payment_status}</p>
            <p><strong>Reference:</strong> {data.details.payment_reference || "Pending"}</p>
            <p><strong>Amount:</strong> PHP {data.details.total_amount}</p>
          </div>
        ) : null}
        <button type="button" onClick={onClose} className="mt-5 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white">View Orders</button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
