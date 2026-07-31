import { Bell, Package, ShoppingBag, Star, Users } from "lucide-react";

export function Card({ children, className = "" }) {
  return <section className={`premium-card fade-slide min-w-0 p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function Button({ children, className = "", variant = "primary", ...props }) {
  const styles = variant === "primary"
    ? "gradient-btn"
    : "border border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700";
  return (
    <button className={`${styles} inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props}>
      {children}
    </button>
  );
}

export function StatCard({ title, value, type = "sales", onClick }) {
  const icons = { sales: ShoppingBag, products: Package, users: Users, alerts: Bell, rating: Star };
  const Icon = icons[type] || ShoppingBag;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Card className="group overflow-hidden">
      <Wrapper type={onClick ? "button" : undefined} onClick={onClick} className={`flex min-w-0 items-center justify-between gap-4 text-left ${onClick ? "w-full cursor-pointer" : ""}`}>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <strong className="mt-3 block break-words font-display text-2xl font-bold text-slate-900 sm:text-3xl">{value}</strong>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 transition group-hover:scale-105">
          <Icon size={24} />
        </span>
      </Wrapper>
    </Card>
  );
}

export function Field({ icon: Icon, invalid = false, wrapperClassName = "", className = "", ...props }) {
  return (
    <label className={`flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2.5 shadow-sm transition focus-within:ring-4 ${invalid ? "border-red-500 focus-within:border-red-500 focus-within:ring-red-100" : "border-slate-200 focus-within:border-emerald-300 focus-within:ring-emerald-100"} ${wrapperClassName}`}>
      {Icon ? <Icon size={18} className="shrink-0 text-emerald-600" /> : null}
      <input className={`min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 ${className}`} {...props} />
    </label>
  );
}
