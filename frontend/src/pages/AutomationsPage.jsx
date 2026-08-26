import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  Megaphone,
  Package,
  Plus,
  ReceiptText,
  RefreshCcw,
  Save,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { Button, Card, Field } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";
import { api, cachedGet, getApiErrorMessage } from "../api/client";

const storageKey = "retela_automations_config";
const logStorageKey = "retela_automations_logs";

const iconMap = {
  lowStock: Bell,
  outOfStock: Package,
  newOrder: ShoppingCart,
  orderStatus: RefreshCcw,
  payment: CreditCard,
  cart: Clock,
  broadcast: Megaphone,
  salesReport: BarChart3,
  inventoryReport: SlidersHorizontal,
  returns: ReceiptText
};

const automationSeed = [
  {
    id: "low-stock-alert",
    icon: "lowStock",
    title: "Low Stock Alert",
    description: "Watches product quantities and warns the admin before items run out.",
    trigger: "Apparel stock is 3 or below",
    action: "Notify admin",
    active: true,
    lastTriggered: "May 19, 2026 10:42 AM"
  },
  {
    id: "out-of-stock-alert",
    icon: "outOfStock",
    title: "Out of Stock Alert",
    description: "Escalates products that reach zero stock so restocking can be handled immediately.",
    trigger: "Apparel stock becomes 0",
    action: "Notify admin immediately",
    active: true,
    lastTriggered: "May 19, 2026 09:18 AM"
  },
  {
    id: "new-order-notification",
    icon: "newOrder",
    title: "New Order Notification",
    description: "Keeps the admin order workflow updated whenever a customer checks out.",
    trigger: "Customer places an order",
    action: "Notify admin and update order dashboard",
    active: true,
    lastTriggered: "May 19, 2026 11:04 AM"
  },
  {
    id: "order-status-update",
    icon: "orderStatus",
    title: "Order Status Update",
    description: "Sends customers a status notice when fulfillment progress changes.",
    trigger: "Admin changes order status",
    action: "Notify customer",
    active: true,
    lastTriggered: "May 18, 2026 04:36 PM"
  },
  {
    id: "gcash-payment-verification",
    icon: "payment",
    title: "GCash Payment Verification",
    description: "Routes submitted GCash proof or reference numbers into the admin review flow.",
    trigger: "Customer submits GCash payment proof/reference number",
    action: "Mark payment as For Verification and notify admin",
    active: true,
    lastTriggered: "May 18, 2026 01:12 PM"
  },
  {
    id: "abandoned-cart-reminder",
    icon: "cart",
    title: "Abandoned Cart Reminder",
    description: "Reminds customers to complete carts that have been idle for a full day.",
    trigger: "Cart is inactive for 24 hours",
    action: "Notify customer",
    active: false,
    lastTriggered: "Not triggered yet"
  },
  {
    id: "new-product-broadcast",
    icon: "broadcast",
    title: "New Apparel Broadcast",
    description: "Announces newly listed thrift items to approved customers.",
    trigger: "Admin adds new product",
    action: "Notify all customers",
    active: true,
    lastTriggered: "May 17, 2026 06:21 PM"
  },
  {
    id: "sales-report-automation",
    icon: "salesReport",
    title: "Sales Report Automation",
    description: "Prepares scheduled sales reports for operations review.",
    trigger: "Daily, weekly, and monthly schedule",
    action: "Generate sales report automatically",
    active: true,
    lastTriggered: "May 19, 2026 08:00 AM"
  },
  {
    id: "inventory-report-automation",
    icon: "inventoryReport",
    title: "Inventory Report Automation",
    description: "Builds a weekly stock report from current inventory records.",
    trigger: "Weekly schedule",
    action: "Generate inventory stock report",
    active: true,
    lastTriggered: "May 18, 2026 08:00 AM"
  },
  {
    id: "return-and-refund-alert",
    icon: "returns",
    title: "Return and Refund Alert",
    description: "Surfaces new return and refund requests for admin handling.",
    trigger: "Customer submits return/refund request",
    action: "Notify admin",
    active: true,
    lastTriggered: "May 16, 2026 03:44 PM"
  }
];

const blankAutomation = {
  title: "",
  description: "",
  trigger: "",
  action: "",
  active: true,
  icon: "lowStock",
  lastTriggered: "Not triggered yet"
};

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function currentStamp() {
  return new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function makeLog(type, title, message) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    message,
    createdAt: currentStamp()
  };
}

function initialLogs() {
  return [
    makeLog("active", "New Order Notification", "Automation is listening for checkout events."),
    makeLog("active", "Sales Report Automation", "Scheduled report generation is active."),
    makeLog("inactive", "Abandoned Cart Reminder", "Automation is currently paused.")
  ];
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState(() => safeParse(localStorage.getItem(storageKey), automationSeed));
  const [, setLowStockThreshold] = useState(3);
  const [logs, setLogs] = useState(() => safeParse(localStorage.getItem(logStorageKey), initialLogs()));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingAutomation, setEditingAutomation] = useState(null);
  const [deletingAutomation, setDeletingAutomation] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(automations));
  }, [automations]);

  useEffect(() => {
    localStorage.setItem(logStorageKey, JSON.stringify(logs.slice(0, 30)));
  }, [logs]);

  useEffect(() => {
    let active = true;
    cachedGet("/settings", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        const threshold = Number(data?.inventory?.lowStockThreshold);
        if (!active || !Number.isFinite(threshold) || threshold < 0) return;
        setLowStockThreshold(threshold);
        setAutomations((items) => items.map((item) => item.id === "low-stock-alert"
          ? { ...item, trigger: `Apparel stock is ${threshold} or below` }
          : item));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const filteredAutomations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return automations.filter((automation) => {
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? automation.active : !automation.active);
      const text = `${automation.title} ${automation.description} ${automation.trigger} ${automation.action}`.toLowerCase();
      return matchesStatus && (!query || text.includes(query));
    });
  }, [automations, search, statusFilter]);

  const activeCount = automations.filter((automation) => automation.active).length;
  const inactiveCount = automations.length - activeCount;

  function addLog(type, title, message) {
    setLogs((items) => [makeLog(type, title, message), ...items].slice(0, 30));
  }

  function toggleAutomation(id) {
    const selected = automations.find((automation) => automation.id === id);
    if (!selected) return;
    const nextActive = !selected.active;
    setAutomations((items) => items.map((automation) => {
      if (automation.id !== id) return automation;
      return { ...automation, active: nextActive, lastTriggered: nextActive ? currentStamp() : automation.lastTriggered };
    }));
    addLog(nextActive ? "active" : "inactive", selected.title, `${selected.title} was turned ${nextActive ? "active" : "inactive"}.`);
  }

  function simulateTrigger(automation) {
    setAutomations((items) => items.map((item) => item.id === automation.id ? { ...item, lastTriggered: currentStamp() } : item));
    addLog("triggered", automation.title, `${automation.action} after: ${automation.trigger}.`);
  }

  async function saveAutomation(values) {
    const title = values.title.trim() || "Untitled Automation";
    const payload = {
      ...values,
      title,
      description: values.description.trim(),
      trigger: values.trigger.trim(),
      action: values.action.trim(),
      lastTriggered: values.lastTriggered || "Not triggered yet"
    };

    if (values.id === "low-stock-alert" || payload.title.toLowerCase().includes("low stock")) {
      const thresholdMatch = payload.trigger.match(/\b(\d+)\b/);
      if (thresholdMatch) {
        const threshold = Math.max(0, Number(thresholdMatch[1]));
        try {
          await api.put("/settings/inventory-threshold", { threshold });
          setLowStockThreshold(threshold);
          payload.trigger = `Apparel stock is ${threshold} or below`;
        } catch (error) {
          setToast({ message: getApiErrorMessage(error, "Could not save the low-stock threshold.") });
        }
      }
    }

    if (values.id) {
      setAutomations((items) => items.map((automation) => automation.id === values.id ? payload : automation));
      addLog(payload.active ? "active" : "inactive", payload.title, "Automation settings were updated.");
    } else {
      const created = { ...payload, id: `custom-${Date.now()}` };
      setAutomations((items) => [created, ...items]);
      addLog(created.active ? "active" : "inactive", created.title, "New automation was created.");
    }
    setEditingAutomation(null);
  }

  function deleteAutomation() {
    if (!deletingAutomation) return;
    const deletedTitle = deletingAutomation.title;
    setAutomations((items) => items.filter((automation) => automation.id !== deletingAutomation.id));
    setDeletingAutomation(null);
    setToast({ message: "Automation deleted successfully." });
    addLog("deleted", deletedTitle, "Automation was deleted.");
  }

  return (
    <motion.div className="relative grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
      {toast ? (
        <div className="fixed right-5 top-5 z-[1900] flex max-w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-neonbrand/30 bg-[#07110d] px-4 py-3 text-sm font-bold text-neonbrand shadow-2xl" role="status">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="shrink-0 text-white/55 hover:text-white" aria-label="Dismiss notification"><X size={16} /></button>
        </div>
      ) : null}
      <AutomationHero onCreate={() => setEditingAutomation(blankAutomation)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <AutomationMetric title="Total Automations" value={automations.length} icon={Sparkles} />
        <AutomationMetric title="Active" value={activeCount} icon={CheckCircle2} tone="active" />
        <AutomationMetric title="Inactive" value={inactiveCount} icon={Clock} tone="inactive" />
      </div>

      <AutomationToolbar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onCreate={() => setEditingAutomation(blankAutomation)} />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filteredAutomations.map((automation, index) => (
          <AutomationCard
            key={automation.id}
            automation={automation}
            index={index}
            onToggle={() => toggleAutomation(automation.id)}
            onEdit={() => setEditingAutomation(automation)}
            onTrigger={() => simulateTrigger(automation)}
            onDelete={() => setDeletingAutomation(automation)}
          />
        ))}
      </div>

      {!filteredAutomations.length ? (
        <Card>
          <div className="grid min-h-40 place-items-center text-center">
            <div>
              <Sparkles className="mx-auto text-neonbrand" size={28} />
              <h3 className="mt-3 font-display text-xl font-bold text-white">No automations found</h3>
              <p className="mt-2 text-sm text-white/50">Adjust the search or status filter to view matching automation rules.</p>
            </div>
          </div>
        </Card>
      ) : null}

      <AutomationLogs logs={logs} clearLogs={() => setLogs([])} />

      <AutomationEditor
        automation={editingAutomation}
        open={Boolean(editingAutomation)}
        onClose={() => setEditingAutomation(null)}
        onSave={saveAutomation}
      />
      <ConfirmDialog
        open={Boolean(deletingAutomation)}
        title="Delete Automation?"
        message="Are you sure you want to delete this automation? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={deleteAutomation}
        onClose={() => setDeletingAutomation(null)}
      />
    </motion.div>
  );
}

function AutomationHero({ onCreate }) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
      <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_50%_30%,rgba(56,255,136,0.2),transparent_55%)] lg:block" />
      <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">RETELA automation center</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Automations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58 sm:text-base">Manage notification rules, report schedules, payment verification, and inventory workflows from one operational view.</p>
        </div>
        <Button type="button" onClick={onCreate} className="w-full sm:w-auto">
          <Plus size={18} />
          Create New Automation
        </Button>
      </div>
    </section>
  );
}

function AutomationMetric({ title, value, icon: Icon, tone = "default" }) {
  const toneClass = tone === "active" ? "text-neonbrand" : tone === "inactive" ? "text-amber-300" : "text-white";
  return (
    <Card className="group">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">{title}</p>
          <strong className={`mt-3 block font-display text-3xl font-bold ${toneClass}`}>{Number(value).toLocaleString()}</strong>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)] transition group-hover:scale-105">
          <Icon size={23} />
        </span>
      </div>
    </Card>
  );
}

function AutomationToolbar({ search, setSearch, statusFilter, setStatusFilter, onCreate }) {
  return (
    <Card>
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto_auto]">
        <Field icon={Search} placeholder="Search automations" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="inline-flex min-w-0 overflow-hidden rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-1">
          {[
            ["all", "All"],
            ["active", "Active"],
            ["inactive", "Inactive"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`rounded-xl px-3 py-2 text-xs font-bold uppercase transition ${statusFilter === value ? "bg-neonbrand text-black" : "text-neonbrand hover:bg-neonbrand/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button type="button" onClick={onCreate} className="w-full lg:w-auto">
          <Plus size={17} />
          Create New Automation
        </Button>
      </div>
    </Card>
  );
}

function AutomationCard({ automation, index, onToggle, onEdit, onTrigger, onDelete }) {
  const Icon = iconMap[automation.icon] || Sparkles;
  return (
    <motion.article
      className="group relative min-w-0 overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/25 backdrop-blur-2xl transition duration-300 hover:border-neonbrand/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ duration: 0.35, delay: index * 0.035 }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(56,255,136,0.08),transparent_45%)] opacity-80" />
      <div className="relative z-10 flex min-w-0 items-start justify-between gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)] transition group-hover:scale-105">
          <Icon size={23} />
        </span>
        <StatusBadge active={automation.active} />
      </div>

      <div className="relative z-10 mt-4 min-w-0">
        <h2 className="font-display text-xl font-bold text-white">{automation.title}</h2>
        <p className="mt-2 min-h-12 text-sm leading-6 text-white/55">{automation.description}</p>
      </div>

      <div className="relative z-10 mt-4 grid gap-3">
        <AutomationDetail label="Trigger" value={automation.trigger} />
        <AutomationDetail label="Action" value={automation.action} />
        <AutomationDetail label="Last Triggered" value={automation.lastTriggered} />
      </div>

      <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-3">
        <ToggleSwitch active={automation.active} onClick={onToggle} label={automation.active ? "Active" : "Inactive"} />
        <div className="flex gap-2">
          <button type="button" onClick={onTrigger} className="inline-flex items-center gap-2 rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-3 py-2 text-xs font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
            <Activity size={15} />
            Test
          </button>
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/72 transition hover:border-neonbrand/45 hover:text-neonbrand">
            <Edit3 size={15} />
            Edit
          </button>
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-2 rounded-2xl border border-red-400/50 bg-red-500/15 px-3 py-2 text-xs font-extrabold text-red-300 transition hover:border-red-300 hover:bg-red-500/25 hover:text-red-200">
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function AutomationDetail({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/35">{label}</p>
      <p className="mt-1 text-sm leading-5 text-white/72">{value}</p>
    </div>
  );
}

function StatusBadge({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${active ? "border-neonbrand/30 bg-neonbrand/10 text-neonbrand" : "border-amber-300/25 bg-amber-300/10 text-amber-200"}`}>
      <span className={`h-2 w-2 rounded-full ${active ? "bg-neonbrand" : "bg-amber-300"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ToggleSwitch({ active, onClick, label }) {
  const switchClass = active ? "bg-neonbrand" : "bg-white/20";
  const knobClass = active ? "left-6 bg-black" : "left-1 bg-white";
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 transition hover:border-neonbrand/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neonbrand" aria-pressed={active}>
      <span className={`relative h-6 w-11 rounded-full transition ${switchClass}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full shadow transition ${knobClass}`} />
      </span>
      <span className="text-xs font-bold text-white/65">{label}</span>
    </button>
  );
}

function AutomationEditorToggle({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 w-fit items-center gap-3 rounded-2xl border border-[#cfded4] bg-white px-3 py-2 text-[#17211b] transition hover:border-[#20b66a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20b66a]"
      aria-pressed={active}
    >
      <span className={`relative h-6 w-11 rounded-full transition ${active ? "bg-[#20b66a]" : "bg-slate-300"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full shadow transition ${active ? "left-6 bg-white" : "left-1 bg-white"}`} />
      </span>
      <span className="text-sm font-bold text-[#17211b]">{label}</span>
    </button>
  );
}

function AutomationLogs({ logs, clearLogs }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">Automation Logs</h2>
          <p className="mt-1 text-sm text-white/45">Recent frontend automation actions and test runs.</p>
        </div>
        <button type="button" onClick={clearLogs} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand">
          Clear Logs
        </button>
      </div>
      <div className="mt-4 grid gap-3">
        {logs.length ? logs.map((log) => <AutomationLogItem key={log.id} log={log} />) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/50">No automation logs yet.</div>
        )}
      </div>
    </Card>
  );
}

function AutomationLogItem({ log }) {
  const tone = log.type === "active" ? "text-neonbrand" : log.type === "inactive" ? "text-amber-200" : "text-sky-200";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className={`text-sm font-bold ${tone}`}>{log.title}</p>
        <p className="mt-1 text-sm text-white/58">{log.message}</p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-white/38">{log.createdAt}</span>
    </div>
  );
}

function AutomationEditor({ automation, open, onClose, onSave }) {
  const [form, setForm] = useState(blankAutomation);

  useEffect(() => {
    if (automation) setForm(automation);
  }, [automation]);

  if (!open) return null;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <AnimatePresence>
      <motion.div className="retela-modal-backdrop z-[140]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <button type="button" className="absolute inset-0 cursor-default bg-[rgba(10,20,14,0.55)] backdrop-blur-sm" aria-label="Close automation editor overlay" onClick={onClose} />
        <motion.form onSubmit={submit} className="retela-modal-card modal-md relative z-10 bg-[#f8fbf9]" initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 12 }} role="dialog" aria-modal="true" aria-labelledby="automation-editor-title">
          <div className="retela-modal-header bg-[#f8fbf9]">
            <div>
              <h3 id="automation-editor-title" className="font-display text-2xl font-bold text-[#17211b]">{form.id ? "Edit Automation" : "Create Automation"}</h3>
              <p className="mt-1 text-sm text-[#5f6f65]">Update the frontend rule configuration and status.</p>
            </div>
            <button type="button" onClick={onClose} className="retela-modal-close" aria-label="Close automation editor">
              <X size={18} />
            </button>
          </div>

          <div className="retela-modal-body grid gap-4 md:grid-cols-2">
            <AutomationInput label="Title" value={form.title} onChange={(value) => updateField("title", value)} required />
            <label className="grid gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#17211b]">Icon</span>
              <select value={form.icon} onChange={(event) => updateField("icon", event.target.value)} className="min-h-12 rounded-2xl border border-[#cfded4] bg-white px-3 py-3 text-sm text-[#17211b] outline-none transition focus:border-[#20b66a] focus:outline focus:outline-3 focus:outline-[rgba(32,182,106,0.18)] disabled:bg-slate-100 disabled:text-slate-500">
                {Object.keys(iconMap).map((key) => <option key={key} value={key}>{key.replace(/([A-Z])/g, " $1")}</option>)}
              </select>
            </label>
            <AutomationTextarea label="Description" value={form.description} onChange={(value) => updateField("description", value)} />
            <AutomationTextarea label="Trigger Condition" value={form.trigger} onChange={(value) => updateField("trigger", value)} />
            <AutomationTextarea label="Action Performed" value={form.action} onChange={(value) => updateField("action", value)} />
            <div className="grid content-start gap-3">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#17211b]">Status</span>
              <AutomationEditorToggle active={form.active} onClick={() => updateField("active", !form.active)} label={form.active ? "Active" : "Inactive"} />
            </div>
          </div>

          <div className="retela-modal-footer bg-[#f8fbf9]">
            <button type="button" onClick={onClose} className="min-h-12 rounded-2xl border border-[#cfded4] bg-white px-4 py-2.5 text-sm font-bold text-[#17211b] transition hover:border-[#20b66a] hover:text-[#15884f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20b66a]">Cancel</button>
            <Button type="submit" className="min-h-12">
              <Save size={17} />
              Save Automation
            </Button>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}

function AutomationInput({ label, value, onChange, required }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#17211b]">{label}</span>
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-12 rounded-2xl border border-[#cfded4] bg-white px-3 py-3 text-sm text-[#17211b] outline-none placeholder:text-[#8b9a91] transition focus:border-[#20b66a] focus:outline focus:outline-3 focus:outline-[rgba(32,182,106,0.18)] disabled:bg-slate-100 disabled:text-slate-500" />
    </label>
  );
}

function AutomationTextarea({ label, value, onChange }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#17211b]">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="min-h-32 resize-none rounded-2xl border border-[#cfded4] bg-white px-3 py-3 text-sm leading-6 text-[#17211b] outline-none placeholder:text-[#8b9a91] transition focus:border-[#20b66a] focus:outline focus:outline-3 focus:outline-[rgba(32,182,106,0.18)] disabled:bg-slate-100 disabled:text-slate-500" />
    </label>
  );
}
