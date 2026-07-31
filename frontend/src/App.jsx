import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import AuthPage from "./components/auth/AuthPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { FloatingCustomerAssistant } from "./components/FloatingCustomerAssistant";
import AppLayout from "./components/layout/AppLayout";
import { api } from "./api/client";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AdminDashboard from "./pages/AdminDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import PosPage from "./pages/PosPage";

function Shell() {
  const { user } = useAuth();
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
      api.get(`/payments/status/${orderId}`)
        .then(({ data }) => setPaymentReturn({ loading: false, success, orderId, details: data }))
        .catch(() => setPaymentReturn({ loading: false, success, orderId, details: null }));
    }
    window.history.replaceState({}, "", "/");
  }, [user]);

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
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-2xl shadow-slate-300/60">
        <Icon className={`mx-auto ${data.success ? "text-emerald-600" : "text-rose-500"}`} size={48} />
        <h3 className="mt-4 font-display text-2xl font-bold">{data.success ? "Payment Submitted" : "Payment Cancelled"}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {data.success ? "We are verifying your PayMongo payment. Your order status will update automatically." : "Your payment was cancelled or failed. You can retry from your Orders page."}
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
