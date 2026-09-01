import { Bell, CreditCard, MessageCircle, PackageCheck, ReceiptText, RotateCcw, Star, Users, Zap } from "lucide-react";

const toneClasses = {
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  sky: "border-sky-100 bg-sky-50 text-sky-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  rose: "border-rose-100 bg-rose-50 text-rose-700",
  slate: "border-slate-100 bg-slate-50 text-slate-700"
};

const typeConfig = {
  order: { icon: ReceiptText, badge: "Order", tone: "emerald" },
  order_cancelled: { icon: ReceiptText, badge: "Order", tone: "rose" },
  message: { icon: MessageCircle, badge: "Message", tone: "sky" },
  feedback: { icon: Star, badge: "Feedback", tone: "amber" },
  return: { icon: RotateCcw, badge: "Return", tone: "rose" },
  refund: { icon: RotateCcw, badge: "Return", tone: "rose" },
  registration: { icon: Users, badge: "Customer", tone: "emerald" },
  customer_registration: { icon: Users, badge: "Customer", tone: "emerald" },
  approval: { icon: Users, badge: "Customer", tone: "emerald" },
  inventory: { icon: PackageCheck, badge: "Inventory", tone: "amber" },
  payment: { icon: CreditCard, badge: "Payment", tone: "emerald" },
  system: { icon: Zap, badge: "System", tone: "slate" }
};

function formatPreviewTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diffMs >= 0 && diffMs < minute) return "Now";
  if (diffMs >= 0 && diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs >= 0 && diffMs < 24 * hour) return `${Math.floor(diffMs / hour)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function normalizeItem(notification) {
  if (notification.icon) return notification;
  const config = typeConfig[notification.type] || { icon: Bell, badge: notification.type || "Notice", tone: "slate" };
  return {
    ...notification,
    icon: config.icon,
    badge: notification.badge || config.badge,
    tone: config.tone,
    time: formatPreviewTime(notification.created_at),
    body: notification.body || notification.message || ""
  };
}

export default function NotificationPreviewPanel({
  notifications = [],
  title = "Notifications",
  viewAllLabel = "View All",
  onViewAll,
  onNotificationClick,
  loading = false,
  emptyTitle = "No notifications yet",
  maxItems = 4,
  className = ""
}) {
  const items = notifications.slice(0, maxItems).map(normalizeItem);

  return (
    <aside className={`group h-fit min-h-[220px] rounded-[20px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_55px_rgba(15,23,42,0.12)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(15,23,42,0.16)] ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700">
            <Bell size={18} />
          </span>
          <h2 className="truncate font-display text-lg font-bold text-slate-950">{title}</h2>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll} className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50">
            {viewAllLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2">
        {loading ? (
          Array.from({ length: Math.min(4, maxItems) }).map((_, index) => <div key={index} className="skeleton h-[76px] rounded-2xl" />)
        ) : items.length ? items.map((rawItem) => {
          const item = normalizeItem(rawItem);
          const Icon = item.icon;
          const unread = item.is_read === false;
          const content = (
            <>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl border ${toneClasses[item.tone] || toneClasses.slate}`}>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <strong className="line-clamp-1 text-sm text-slate-950">{item.title}</strong>
                  <span className="shrink-0 text-[11px] font-semibold text-slate-400">{item.time}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</p>
                <span className="mt-1.5 inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{item.badge}</span>
              </div>
              {unread ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-label="Unread notification" /> : null}
            </>
          );
          const classes = `flex w-full gap-3 rounded-2xl border p-2.5 text-left shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-emerald-100 hover:shadow-md ${unread ? "border-emerald-100 bg-emerald-50/65" : "border-slate-100 bg-white/88"}`;
          return onNotificationClick ? (
            <button key={item.id || item.title} type="button" onClick={() => onNotificationClick(item)} className={classes}>
              {content}
            </button>
          ) : (
            <article key={item.id || item.title} className={classes}>
              {content}
            </article>
          );
        }) : (
          <div className="rounded-2xl border border-slate-100 bg-white/88 p-4 text-sm font-semibold text-slate-500">{emptyTitle}</div>
        )}
      </div>
    </aside>
  );
}
