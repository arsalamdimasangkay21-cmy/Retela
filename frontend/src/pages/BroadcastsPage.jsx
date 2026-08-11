import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  Edit3,
  Eye,
  ImagePlus,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  MessageSquareText,
  MousePointerClick,
  Percent,
  RefreshCcw,
  Save,
  Send,
  Sparkles,
  Smartphone,
  Target,
  Trash2,
  Users,
  Wand2
} from "lucide-react";
import { api, API_URL, cachedGet, clearGetCache, getApiErrorMessage } from "../api/client";
import { acquireSocket, releaseSocket } from "../api/socket";
import { RETELA_LOGO_URL } from "../config/branding";
import ConfirmDialog from "../components/ConfirmDialog";
import { Button, Card, Field } from "../components/ui";

const audienceOptions = [
  { value: "all_customers", label: "All Customers", description: "Reach every approved customer." },
  { value: "by_location", label: "By Location", description: "Target customers by saved address or city." },
  { value: "by_product_interest", label: "By Apparel Interest", description: "Reach buyers interested in apparel, brand, or category." },
  { value: "active_customers", label: "Active Customers", description: "Customers active in the last 14 days." },
  { value: "new_customers", label: "New Customers", description: "Customers registered in the last 30 days." }
];

const typeOptions = [
  ["new_arrival", "New Arrival"],
  ["promo_sale", "Promo Sale"],
  ["flash_sale", "Flash Sale"],
  ["restock_alert", "Restock Alert"],
  ["holiday_promo", "Holiday Promo"],
  ["order_update", "Order Update"],
  ["event_announcement", "Event Announcement"],
  ["ai_marketing_campaign", "AI Marketing Campaign"]
];

const campaignTemplates = [
  {
    key: "new-arrival",
    title: "New Arrival",
    type: "new_arrival",
    message: "Fresh thrift finds just landed at RETELA. Browse the latest arrivals now and reserve your favorite pieces before they sell out."
  },
  {
    key: "flash-sale",
    title: "Flash Sale",
    type: "flash_sale",
    message: "Limited-time flash sale is live. Grab selected thrift picks at special prices today while stocks last."
  },
  {
    key: "restock-alert",
    title: "Restock Alert",
    type: "restock_alert",
    message: "Popular RETELA items are back in stock. Check the shop now and complete your order before quantities run out again."
  },
  {
    key: "holiday-promo",
    title: "Holiday Promo",
    type: "holiday_promo",
    message: "Celebrate the season with RETELA holiday deals. Find budget-friendly thrift favorites and checkout while the promo is available."
  }
];

const emptyForm = {
  title: "",
  message: "",
  promo_code: "",
  audience: "all_customers",
  audience_filter: "",
  broadcast_type: "promo_sale",
  scheduled_at: "",
  ai_generated: false,
  sale_enabled: false,
  sale_discount_percent: 0,
  sale_product_ids: [],
  sale_starts_at: "",
  sale_ends_at: "",
  channels: {
    inApp: true,
    email: true,
    sms: false,
    aiChat: true
  },
  image_url: ""
};

function assetUrl(url) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_URL.replace(/\/api$/, "")}${url}`;
}

function toInputDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return "Not sent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Unable to parse broadcast JSON field", error);
    return fallback;
  }
}

export default function BroadcastsPage() {
  const [form, setForm] = useState(emptyForm);
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState({
    totalBroadcasts: 0,
    totalRecipients: 0,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    openRate: 0,
    clickRate: 0,
    conversionRate: 0,
    activeCampaigns: 0
  });
  const [audienceCounts, setAudienceCounts] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState("");
  const [submitProgress, setSubmitProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [busyId, setBusyId] = useState("");
  const [progressByBroadcast, setProgressByBroadcast] = useState({});
  const [toast, setToast] = useState(null);
  const [products, setProducts] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const submittingActionRef = useRef("");

  const scheduledQueue = useMemo(
    () => history.filter((item) => item.status === "scheduled").sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0)),
    [history]
  );

  const deliverySummary = useMemo(() => {
    const summary = { pending: 0, sent: 0, delivered: 0, failed: 0 };
    history.forEach((item) => {
      if (item.status === "failed") summary.failed += 1;
      else if (item.status === "sent") summary.delivered += 1;
      else if (item.status === "sending") summary.sent += 1;
      else summary.pending += 1;
    });
    return summary;
  }, [history]);

  const imagePreview = useMemo(() => {
    if (imageFile) return URL.createObjectURL(imageFile);
    return assetUrl(form.image_url);
  }, [imageFile, form.image_url]);

  const loadBroadcasts = useCallback(async ({ cancelled, force = false } = {}) => {
    try {
      const { data } = await cachedGet("/broadcasts", {}, { cacheMs: 8000, retries: 1, force });
      if (!cancelled?.()) hydrateResponse(data);
    } catch (error) {
      if (!cancelled?.()) pushToast("error", getApiErrorMessage(error, "Could not load broadcasts."));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadBroadcasts({ cancelled: () => cancelled }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    cachedGet("/products/inventory", {}, { cacheMs: 8000, retries: 1 })
      .then(({ data }) => {
        if (!cancelled) setProducts(data);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadBroadcasts]);

  useEffect(() => {
    submittingActionRef.current = submittingAction;
  }, [submittingAction]);

  useEffect(() => {
    const token = localStorage.getItem("retela_token");
    if (!token) return undefined;
    const socket = acquireSocket(token);
    if (!socket) return undefined;
    const handleProgress = (payload) => {
      if (!payload?.broadcast_id) return;
      setProgressByBroadcast((current) => ({
        ...current,
        [payload.broadcast_id]: {
          progress: Number(payload.progress || 0),
          status: payload.status || "pending"
        }
      }));
      if (submittingActionRef.current === "send") setSubmitProgress(Number(payload.progress || 0));
    };
    socket.on("broadcast:progress", handleProgress);
    return () => {
      socket.off("broadcast:progress", handleProgress);
      releaseSocket(socket);
    };
  }, []);

  useEffect(() => () => {
    if (imageFile && imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imageFile, imagePreview]);

  function pushToast(type, message) {
    setToast({ type, message });
    window.clearTimeout(pushToast.timer);
    pushToast.timer = window.setTimeout(() => setToast(null), 3600);
  }

  function hydrateResponse(data) {
    setAnalytics(data.analytics || {
      totalBroadcasts: 0,
      totalRecipients: 0,
      totalSent: 0,
      totalOpened: 0,
      totalClicked: 0,
      openRate: 0,
      clickRate: 0,
      conversionRate: 0,
      activeCampaigns: 0
    });
    setAudienceCounts(data.audienceCounts || {});
    setHistory(Array.isArray(data.broadcasts) ? data.broadcasts : []);
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "audience" && !["by_location", "by_product_interest"].includes(value) ? { audience_filter: "" } : {})
    }));
  }

  function updateChannel(key, value) {
    setForm((current) => ({ ...current, channels: { ...current.channels, [key]: value } }));
  }

  function resetForm() {
    setForm(emptyForm);
    setImageFile(null);
    setEditingId(null);
    setAiPrompt("");
    setSubmitProgress(0);
  }

  function validate(action) {
    if (!form.title.trim()) return "Broadcast title is required.";
    if (form.message.trim().length < 12) return "Write a more complete message for this broadcast.";
    if (["by_location", "by_product_interest"].includes(form.audience) && !form.audience_filter.trim()) return "Enter the location or product interest target for this audience.";
    if (!Object.values(form.channels).some(Boolean)) return "Select at least one delivery channel.";
    if (action === "schedule" && !form.scheduled_at) return "Choose a schedule date and time.";
    if (form.sale_enabled) {
      if (!form.sale_product_ids.length) return "Select at least one sale product.";
      if (!Number(form.sale_discount_percent || 0)) return "Enter a sale discount percentage.";
      if (!form.sale_starts_at || !form.sale_ends_at) return "Choose sale start and end dates.";
    }
    return "";
  }

  async function submit(action) {
    const validationMessage = validate(action);
    if (validationMessage) {
      pushToast("error", validationMessage);
      return;
    }

    const payload = new FormData();
    payload.append("title", form.title.trim());
    payload.append("message", form.message.trim());
    payload.append("promo_code", form.promo_code.trim());
    payload.append("audience", form.audience);
    payload.append("audience_filter", form.audience_filter.trim());
    payload.append("broadcast_type", form.broadcast_type);
    payload.append("scheduled_at", form.scheduled_at || "");
    payload.append("ai_generated", String(form.ai_generated));
    payload.append("sale_enabled", String(form.sale_enabled));
    payload.append("sale_discount_percent", String(form.sale_discount_percent || 0));
    payload.append("sale_product_ids", JSON.stringify(form.sale_product_ids || []));
    payload.append("sale_starts_at", form.sale_starts_at || "");
    payload.append("sale_ends_at", form.sale_ends_at || "");
    payload.append("action", action);
    payload.append("channels", JSON.stringify(form.channels));
    payload.append("image_url", form.image_url || "");
    if (imageFile) payload.append("image", imageFile);

    setSubmittingAction(action);
    setSubmitProgress(action === "send" ? 8 : 0);
    try {
      const { data } = editingId
        ? await api.put(`/broadcasts/${editingId}`, payload, { headers: { "Content-Type": "multipart/form-data" } })
        : await api.post("/broadcasts", payload, { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/broadcasts");
      hydrateResponse(data);
      if (action === "send") setSubmitProgress(100);
      pushToast("success", data.message || "Broadcast saved.");
      resetForm();
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not save the broadcast."));
    } finally {
      setSubmittingAction("");
      window.setTimeout(() => setSubmitProgress(0), 800);
    }
  }

  async function generateAiMessage() {
    if (!form.title.trim() && !aiPrompt.trim()) {
      pushToast("error", "Enter a broadcast title or short AI prompt before generating a message.");
      return;
    }
    setGenerating(true);
    try {
      const { data } = await api.post("/broadcasts/generate", {
        title: form.title.trim(),
        audience: form.audience,
        broadcast_type: form.broadcast_type,
        promo_code: form.promo_code.trim(),
        notes: aiPrompt.trim()
      });
      setForm((current) => ({ ...current, message: data.message || current.message, ai_generated: true }));
      pushToast("success", "AI message generated.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not generate the AI message."));
    } finally {
      setGenerating(false);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setImageFile(null);
    setForm({
      title: item.title || "",
      message: item.message || "",
      promo_code: item.promo_code || "",
      audience: item.audience || "all_customers",
      audience_filter: item.audience_filter || "",
      broadcast_type: item.broadcast_type || "promo_sale",
      scheduled_at: toInputDateTime(item.scheduled_at),
      ai_generated: Boolean(item.ai_generated),
      sale_enabled: Boolean(item.sale_enabled),
      sale_discount_percent: Number(item.sale_discount_percent || 0),
      sale_product_ids: parseJson(item.sale_product_ids_json, []).map(Number),
      sale_starts_at: toInputDateTime(item.sale_starts_at),
      sale_ends_at: toInputDateTime(item.sale_ends_at),
      channels: {
        inApp: Boolean(item.channels?.inApp),
        email: Boolean(item.channels?.email),
        sms: Boolean(item.channels?.sms),
        aiChat: Boolean(item.channels?.aiChat)
      },
      image_url: item.image_url || ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function resend(item) {
    setBusyId(`resend-${item.id}`);
    try {
      const { data } = await api.post(`/broadcasts/${item.id}/resend`);
      clearGetCache("/broadcasts");
      hydrateResponse(data);
      pushToast("success", data.message || "Broadcast resent.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not resend the broadcast."));
    } finally {
      setBusyId("");
    }
  }

  async function duplicate(item) {
    setBusyId(`duplicate-${item.id}`);
    try {
      const { data } = await api.post(`/broadcasts/${item.id}/duplicate`);
      clearGetCache("/broadcasts");
      hydrateResponse(data);
      pushToast("success", data.message || "Campaign duplicated.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not duplicate the campaign."));
    } finally {
      setBusyId("");
    }
  }

  function applyTemplate(template) {
    setForm((current) => ({
      ...current,
      title: current.title || template.title,
      broadcast_type: template.type,
      message: template.message
    }));
  }

  function progressFor(item) {
    if (progressByBroadcast[item.id]) return progressByBroadcast[item.id].progress;
    if (item.status === "sent") return 100;
    if (item.status === "failed") return 100;
    if (item.status === "sending") return 66;
    if (item.status === "scheduled") return 20;
    return 0;
  }

  const hasPreviewContent = Boolean(form.title.trim() || form.message.trim());
  const previewTitle = form.title.trim() || "RETELA Broadcast";
  const previewMessage = form.message.trim();
  const previewPromo = form.promo_code.trim();
  const previewAudience = titleCase(form.audience);
  const previewType = titleCase(form.broadcast_type);
  const previewStatus = form.scheduled_at ? "Scheduled" : hasPreviewContent ? "Ready" : "Not Sent";
  const previewStatusClass = previewStatus === "Ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : previewStatus === "Scheduled"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  const previewAnimationKey = [
    form.title,
    form.message,
    form.promo_code,
    form.audience,
    form.audience_filter,
    form.scheduled_at
  ].join("|");

  async function remove(item) {
    setDeleteTarget(item);
  }

  async function confirmRemove() {
    if (!deleteTarget) return;
    const item = deleteTarget;
    setBusyId(`delete-${item.id}`);
    try {
      const { data } = await api.delete(`/broadcasts/${item.id}`);
      clearGetCache("/broadcasts");
      hydrateResponse(data);
      if (editingId === item.id) resetForm();
      pushToast("success", data.message || "Broadcast deleted.");
      setDeleteTarget(null);
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not delete the broadcast."));
    } finally {
      setBusyId("");
    }
  }

  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
      <section className="relative overflow-hidden rounded-[32px] border border-emerald-300/15 bg-[linear-gradient(135deg,rgba(8,31,20,0.96),rgba(8,20,16,0.88))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(74,222,128,0.2),transparent_28%),radial-gradient(circle_at_88%_10%,rgba(16,185,129,0.18),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-200/75">RETELA campaign console</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Broadcasts</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50/65">Create announcements, promotions, and customer notifications with real backend delivery, scheduled sends, AI message generation, and live campaign history.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[320px]">
            <HeroChip icon={Users} label="Audience Pools" value={Object.keys(audienceCounts).length} />
            <HeroChip icon={Sparkles} label="Live Campaigns" value={analytics.activeCampaigns} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Send} label="Total Sent" value={Number(analytics.totalSent || analytics.totalRecipients || 0).toLocaleString()} />
        <MetricCard icon={Eye} label="Total Opened" value={Number(analytics.totalOpened || 0).toLocaleString()} />
        <MetricCard icon={MousePointerClick} label="Total Clicked" value={Number(analytics.totalClicked || 0).toLocaleString()} />
        <MetricCard icon={Percent} label="Conversion Rate" value={`${analytics.conversionRate ?? analytics.clickRate ?? 0}%`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <Card className="overflow-hidden border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">Broadcast builder</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-white">{editingId ? "Edit Broadcast" : "Create Broadcast"}</h2>
              <p className="mt-2 text-sm text-white/55">Compose the campaign, choose audience and channels, then send instantly, schedule it, or keep it as a draft.</p>
            </div>
            {editingId ? (
              <button type="button" onClick={resetForm} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/70 transition hover:border-emerald-300/40 hover:text-emerald-200">
                Cancel Edit
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4">
            <section className="rounded-[24px] border border-emerald-300/15 bg-emerald-300/8 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100/65">Campaign Templates</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-white">Start from a proven marketing format</h3>
                </div>
                <Layers size={19} className="text-emerald-200" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {campaignTemplates.map((template) => (
                  <button key={template.key} type="button" onClick={() => applyTemplate(template)} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:border-emerald-300/35 hover:bg-emerald-300/10">
                    <strong className="block text-sm text-white">{template.title}</strong>
                    <span className="mt-1 block text-xs leading-5 text-white/45">{template.message}</span>
                  </button>
                ))}
              </div>
            </section>

            <Field icon={Megaphone} placeholder="Broadcast title" value={form.title} onChange={(event) => updateField("title", event.target.value)} />
            <label className="grid gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">Message</span>
              <textarea
                value={form.message}
                onChange={(event) => updateField("message", event.target.value)}
                rows={6}
                className="min-h-36 resize-y rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-emerald-300/55"
                placeholder="Write the customer announcement here."
              />
            </label>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field icon={Sparkles} placeholder="Promo code" value={form.promo_code} onChange={(event) => updateField("promo_code", event.target.value.toUpperCase())} />
              <label className="grid gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">Schedule Date/Time</span>
                <div className="flex min-w-0 items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.06] px-4 py-3 focus-within:border-emerald-300/55">
                  <CalendarClock size={18} className="shrink-0 text-emerald-200" />
                  <input type="datetime-local" value={form.scheduled_at} onChange={(event) => updateField("scheduled_at", event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />
                </div>
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/40">Broadcast Types</p>
                    <h3 className="mt-1 font-display text-lg font-bold text-white">Campaign Category</h3>
                  </div>
                  <Bot size={18} className="text-emerald-200" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {typeOptions.map(([value, label]) => (
                    <ChoicePill key={value} active={form.broadcast_type === value} onClick={() => updateField("broadcast_type", value)}>
                      {label}
                    </ChoicePill>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/40">Delivery Channels</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-white">Notification Destinations</h3>
                </div>
                <div className="grid gap-2">
                  <ChannelToggle label="In-App Notification" description="Save to the customer notification page instantly." checked={form.channels.inApp} onChange={(value) => updateChannel("inApp", value)} icon={Megaphone} />
                  <ChannelToggle label="Email Notification" description="Send directly to customer email addresses." checked={form.channels.email} onChange={(value) => updateChannel("email", value)} icon={Mail} />
                  <ChannelToggle label="SMS" description="Optional SMS delivery when numbers are available." checked={form.channels.sms} onChange={(value) => updateChannel("sms", value)} icon={MessageSquareText} />
                  <ChannelToggle label="AI Chat Announcement" description="Drop the campaign inside the customer AI conversation thread." checked={form.channels.aiChat} onChange={(value) => updateChannel("aiChat", value)} icon={Bot} />
                </div>
              </section>
            </div>

            <section className="rounded-[24px] border border-emerald-300/15 bg-emerald-300/8 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100/65">Sale Promotion</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-white">Broadcast an Item Sale</h3>
                </div>
                <button type="button" onClick={() => updateField("sale_enabled", !form.sale_enabled)} className={`rounded-2xl border px-4 py-2 text-sm font-bold transition ${form.sale_enabled ? "border-emerald-300/35 bg-emerald-300/15 text-emerald-100" : "border-white/10 bg-white/[0.06] text-white/60"}`}>
                  {form.sale_enabled ? "Sale Enabled" : "Enable Sale"}
                </button>
              </div>
              {form.sale_enabled ? (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <input type="number" min="1" max="100" value={form.sale_discount_percent} onChange={(event) => updateField("sale_discount_percent", event.target.value)} placeholder="Discount %" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-emerald-300/55" />
                    <input type="datetime-local" value={form.sale_starts_at} onChange={(event) => updateField("sale_starts_at", event.target.value)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-emerald-300/55" />
                    <input type="datetime-local" value={form.sale_ends_at} onChange={(event) => updateField("sale_ends_at", event.target.value)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-emerald-300/55" />
                  </div>
                  <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                    {products.map((product) => {
                      const selected = form.sale_product_ids.includes(Number(product.id));
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => updateField("sale_product_ids", selected ? form.sale_product_ids.filter((id) => id !== Number(product.id)) : [...form.sale_product_ids, Number(product.id)])}
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${selected ? "border-emerald-300/35 bg-emerald-300/15" : "border-white/10 bg-white/[0.045] hover:border-emerald-300/25"}`}
                        >
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-emerald-200 bg-emerald-300 text-black" : "border-white/30"}`}>
                            {selected ? <CheckCircle2 size={13} /> : null}
                          </span>
                          <span className="min-w-0">
                            <strong className="block truncate text-sm text-white">{product.name}</strong>
                            <span className="text-xs text-white/45">{product.category || "Apparel"} | PHP {Number(product.price || 0).toLocaleString()}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/40">Audience Selector</p>
                <h3 className="mt-1 font-display text-lg font-bold text-white">Customer Segment</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {audienceOptions.map((option) => (
                  <AudienceCard
                    key={option.value}
                    option={option}
                    active={form.audience === option.value}
                    count={audienceCounts[option.value] ?? 0}
                    onClick={() => updateField("audience", option.value)}
                  />
                ))}
              </div>
              {["by_location", "by_product_interest"].includes(form.audience) ? (
                <label className="mt-4 grid gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">
                    {form.audience === "by_location" ? "Location Target" : "Apparel Interest Target"}
                  </span>
                  <div className="flex min-w-0 items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.06] px-4 py-3 focus-within:border-emerald-300/55">
                    {form.audience === "by_location" ? <MapPin size={18} className="shrink-0 text-emerald-200" /> : <Target size={18} className="shrink-0 text-emerald-200" />}
                    <input
                      value={form.audience_filter}
                      onChange={(event) => updateField("audience_filter", event.target.value)}
                      placeholder={form.audience === "by_location" ? "Example: Manila, Quezon City, Cebu" : "Example: jacket, denim, Nike, dress"}
                      className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                    />
                  </div>
                </label>
              ) : null}
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <label className="grid gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">Image Upload</span>
                <label className="flex min-h-24 cursor-pointer items-center gap-4 rounded-[24px] border border-dashed border-emerald-300/25 bg-emerald-300/5 px-4 py-4 transition hover:border-emerald-300/40">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/25 text-emerald-200">
                    <ImagePlus size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-white">{imageFile ? imageFile.name : form.image_url ? "Current campaign image" : "Upload broadcast image"}</strong>
                    <span className="mt-1 block text-xs text-white/45">PNG, JPG, or WEBP up to 5MB</span>
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => setImageFile(event.target.files?.[0] || null)} />
                </label>
              </label>
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-3">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">Preview</span>
                <div className="mt-2 grid h-[124px] place-items-center overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.05]">
                  {imagePreview ? <img src={imagePreview} className="h-full w-full object-cover" alt="Broadcast preview" /> : <span className="text-sm text-white/35">No image selected</span>}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-[24px] border border-emerald-300/15 bg-emerald-300/8 p-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100/65">AI Generated Broadcast</p>
                <p className="mt-1 text-sm text-white/58">Let AI draft a polished promotional message based on the campaign title, type, audience, and promo code.</p>
                <input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder="Short prompt for AI, e.g. hype affordable jackets for rainy season"
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-emerald-300/55"
                />
              </div>
              <Button type="button" onClick={generateAiMessage} disabled={generating} className="shrink-0">
                {generating ? <Loader2 size={17} className="animate-spin" /> : <Wand2 size={17} />}
                Generate AI Message
              </Button>
            </div>

            {submittingAction === "send" || submitProgress > 0 ? (
              <div className="rounded-[24px] border border-emerald-300/20 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-white">Sending progress</span>
                  <span className="text-sm font-black text-emerald-200">{Math.round(submitProgress)}%</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, submitProgress))}%` }} />
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 md:flex-row md:justify-end">
              <Button type="button" variant="secondary" onClick={() => submit("draft")} disabled={Boolean(submittingAction)}>
                {submittingAction === "draft" ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                Save Draft
              </Button>
              <Button type="button" variant="secondary" onClick={() => submit("schedule")} disabled={Boolean(submittingAction)}>
                {submittingAction === "schedule" ? <Loader2 size={17} className="animate-spin" /> : <CalendarClock size={17} />}
                Schedule Broadcast
              </Button>
              <Button type="button" onClick={() => submit("send")} disabled={Boolean(submittingAction)}>
                {submittingAction === "send" ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                Send Now
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-5">
          <Card className="overflow-hidden border border-emerald-200 bg-white text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Customer Preview</p>
                <h3 className="mt-2 font-display text-xl font-bold text-slate-950">Live Notification Preview</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">See how this broadcast will appear to customers before sending.</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${previewStatusClass}`}>
                <span className="h-2 w-2 rounded-full bg-current" />
                {previewStatus}
              </span>
            </div>

            <motion.div
              key={previewAnimationKey}
              className="mt-5 grid gap-4"
              initial={{ opacity: 0.78, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <div className="rounded-[26px] border-l-4 border-emerald-500 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.16)] ring-1 ring-slate-100">
                <div className="flex items-start gap-3">
                  <img src={RETELA_LOGO_URL} className="h-12 w-12 shrink-0 rounded-2xl border border-emerald-100 bg-white object-cover shadow-sm" alt="RETELA logo" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                            <Bell size={17} />
                          </span>
                          <div className="min-w-0">
                            <strong className="block truncate text-sm font-black text-slate-950">RETELA Broadcast</strong>
                            <span className="block text-xs font-semibold text-slate-500">Just now</span>
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">{previewAudience}</span>
                    </div>

                    {hasPreviewContent ? (
                      <div className="mt-4">
                        <h4 className="break-words text-lg font-black uppercase leading-snug text-slate-950">{previewTitle}</h4>
                        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{previewMessage || "Add your message to complete the customer notification."}</p>
                        {previewPromo ? <p className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">Promo Code: {previewPromo}</p> : null}
                        {imagePreview ? <img src={imagePreview} className="mt-3 h-28 w-full rounded-2xl object-cover shadow-sm" alt="Customer notification preview" /> : null}
                        <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-emerald-700/20">
                          Shop Now
                        </button>
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
                        No broadcast content yet. Start typing to see a live customer preview.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-slate-950 p-3 shadow-[0_22px_55px_rgba(15,23,42,0.24)]">
                <div className="rounded-[24px] bg-[#F8FAFC] p-4">
                  <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-slate-300" />
                  <div className="rounded-[22px] border border-emerald-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <Smartphone size={17} className="text-emerald-700" />
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Customer Notification</span>
                      </div>
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <img src={RETELA_LOGO_URL} className="h-10 w-10 rounded-2xl border border-emerald-100 object-cover" alt="RETELA logo" />
                      <div className="min-w-0">
                        <strong className="block text-sm font-black text-slate-950">RETELA</strong>
                        <span className="block truncate text-xs font-bold text-emerald-700">{previewType}</span>
                      </div>
                    </div>
                    {hasPreviewContent ? (
                      <div className="mt-4">
                        <h4 className="break-words text-base font-black text-slate-950">{previewTitle}</h4>
                        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{previewMessage || "Add message details here."}</p>
                        {previewPromo ? <p className="mt-3 text-sm font-black text-emerald-700">Promo Code: {previewPromo}</p> : null}
                        <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Tap to view</p>
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
                        No broadcast content yet. Start typing to see a live customer preview.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>

            <div className="mt-4 grid gap-2">
              <LightMiniStat label="Audience" value={previewAudience} />
              <LightMiniStat label="Audience Filter" value={form.audience_filter || "None"} />
              <LightMiniStat label="Type" value={previewType} />
              <LightMiniStat label="Promo Code" value={previewPromo || "None"} />
              <LightMiniStat label="Channels" value={Object.entries(form.channels).filter(([, enabled]) => enabled).map(([key]) => titleCase(key)).join(", ") || "None"} />
              <LightMiniStat label="Scheduled" value={form.scheduled_at ? formatDateTime(form.scheduled_at) : "Not scheduled"} />
            </div>
          </Card>

          <Card className="border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">Delivery Status</p>
            <h3 className="mt-2 font-display text-xl font-bold text-white">Campaign Health</h3>
            <div className="mt-4 grid gap-3">
              <StatusLine icon={Clock3} title="Pending" value={deliverySummary.pending} />
              <StatusLine icon={Send} title="Sent" value={deliverySummary.sent} />
              <StatusLine icon={CheckCircle2} title="Delivered" value={deliverySummary.delivered} />
              <StatusLine icon={AlertCircle} title="Failed" value={deliverySummary.failed} danger />
            </div>
          </Card>

          <Card className="border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">Scheduled Queue</p>
            <h3 className="mt-2 font-display text-xl font-bold text-white">Upcoming Broadcasts</h3>
            <div className="mt-4 grid gap-3">
              {scheduledQueue.length ? scheduledQueue.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                  <strong className="block truncate text-sm text-white">{item.title}</strong>
                  <span className="mt-1 block text-xs font-semibold text-emerald-100/60">{formatDateTime(item.scheduled_at)}</span>
                </div>
              )) : (
                <p className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm leading-6 text-white/50">No scheduled campaigns are waiting in the queue.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/70">Broadcast History</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-white">Campaign Log</h2>
          </div>
          <button type="button" onClick={() => loadBroadcasts({ force: true })} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/70 transition hover:border-emerald-300/40 hover:text-emerald-200">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="mt-5 grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-20 rounded-[24px]" />)}
          </div>
        ) : history.length ? (
          <>
            <div className="mt-5 hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[1080px] text-left text-sm text-white/72">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-[0.18em] text-white/35">
                    <th className="pb-3 pr-4">Title</th>
                    <th className="pb-3 pr-4">Audience</th>
                    <th className="pb-3 pr-4">Date Sent</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Recipients</th>
                    <th className="pb-3 pr-4">Opened</th>
                    <th className="pb-3 pr-4">Clicked</th>
                    <th className="pb-3 pr-4">Progress</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id} className="border-b border-white/6 align-top">
                      <td className="py-4 pr-4">
                        <strong className="block text-white">{item.title}</strong>
                        <span className="mt-1 block text-xs text-white/40">{titleCase(item.broadcast_type)}</span>
                      </td>
                      <td className="py-4 pr-4">{titleCase(item.audience)}</td>
                      <td className="py-4 pr-4">{formatDateTime(item.sent_at || item.scheduled_at || item.created_at)}</td>
                      <td className="py-4 pr-4"><StatusBadge status={item.status} liveStatus={progressByBroadcast[item.id]?.status} /></td>
                      <td className="py-4 pr-4">{Number(item.total_recipients || 0).toLocaleString()}</td>
                      <td className="py-4 pr-4">{Number(item.opened_recipients || 0).toLocaleString()} <span className="text-white/35">({Number(item.open_rate || 0).toFixed(1)}%)</span></td>
                      <td className="py-4 pr-4">{Number(item.clicked_recipients || 0).toLocaleString()} <span className="text-white/35">({Number(item.conversion_rate || item.click_rate || 0).toFixed(1)}%)</span></td>
                      <td className="py-4 pr-4"><ProgressBar value={progressFor(item)} /></td>
                      <td className="py-4">
                        <div className="flex flex-wrap gap-2">
                          <TableAction icon={Edit3} label="Edit" onClick={() => startEdit(item)} />
                          <TableAction icon={Copy} label={busyId === `duplicate-${item.id}` ? "Duplicating..." : "Duplicate"} onClick={() => duplicate(item)} disabled={Boolean(busyId)} />
                          <TableAction icon={RefreshCcw} label={busyId === `resend-${item.id}` ? "Resending..." : "Resend"} onClick={() => resend(item)} disabled={Boolean(busyId)} />
                          <TableAction icon={Trash2} label={busyId === `delete-${item.id}` ? "Deleting..." : "Delete"} onClick={() => remove(item)} disabled={Boolean(busyId)} danger />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 grid gap-3 xl:hidden">
              {history.map((item) => (
                <article key={item.id} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-bold text-white">{item.title}</h3>
                      <p className="mt-1 text-sm text-white/48">{titleCase(item.broadcast_type)} | {titleCase(item.audience)}</p>
                    </div>
                    <StatusBadge status={item.status} liveStatus={progressByBroadcast[item.id]?.status} />
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <MiniStat label="Date" value={formatDateTime(item.sent_at || item.scheduled_at || item.created_at)} />
                    <MiniStat label="Recipients" value={Number(item.total_recipients || 0).toLocaleString()} />
                    <MiniStat label="Conversion" value={`${Number(item.conversion_rate || item.click_rate || 0).toFixed(1)}%`} />
                  </div>
                  <div className="mt-4"><ProgressBar value={progressFor(item)} /></div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <TableAction icon={Edit3} label="Edit" onClick={() => startEdit(item)} />
                    <TableAction icon={Copy} label={busyId === `duplicate-${item.id}` ? "Duplicating..." : "Duplicate"} onClick={() => duplicate(item)} disabled={Boolean(busyId)} />
                    <TableAction icon={RefreshCcw} label={busyId === `resend-${item.id}` ? "Resending..." : "Resend"} onClick={() => resend(item)} disabled={Boolean(busyId)} />
                    <TableAction icon={Trash2} label={busyId === `delete-${item.id}` ? "Deleting..." : "Delete"} onClick={() => remove(item)} disabled={Boolean(busyId)} danger />
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-5 grid min-h-56 place-items-center rounded-[24px] border border-dashed border-emerald-300/20 bg-black/20 text-center">
            <div>
              <Megaphone className="mx-auto text-emerald-200" size={28} />
              <h3 className="mt-3 font-display text-xl font-bold text-white">No broadcasts yet</h3>
              <p className="mt-2 text-sm text-white/48">Your sent, scheduled, and draft campaigns will appear here.</p>
            </div>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
      </AnimatePresence>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete broadcast?"
        message="This broadcast will be moved out of the active campaign list."
        detail={deleteTarget?.title}
        confirmLabel="Delete Broadcast"
        busy={busyId === `delete-${deleteTarget?.id}`}
        onClose={() => {
          if (!busyId) setDeleteTarget(null);
        }}
        onConfirm={confirmRemove}
      />
    </motion.div>
  );
}

function HeroChip({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.06] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
          <Icon size={20} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/40">{label}</p>
          <strong className="mt-1 block font-display text-2xl text-white">{Number(value || 0).toLocaleString()}</strong>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }) {
  return (
    <Card className="group border border-emerald-300/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/42">{label}</p>
          <strong className="mt-3 block font-display text-3xl font-bold text-white">{value}</strong>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200 transition group-hover:scale-105">
          <Icon size={22} />
        </span>
      </div>
    </Card>
  );
}

function ChoicePill({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition ${active ? "border-emerald-300/40 bg-emerald-300/14 text-white shadow-[0_0_28px_rgba(16,185,129,0.12)]" : "border-white/10 bg-white/[0.045] text-white/68 hover:border-emerald-300/25 hover:text-white"}`}>
      {children}
    </button>
  );
}

function ChannelToggle({ label, description, checked, onChange, icon: Icon }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-left transition hover:border-emerald-300/25" aria-pressed={checked}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <strong className="block text-sm text-white">{label}</strong>
          <p className="mt-1 text-xs leading-5 text-white/45">{description}</p>
        </div>
      </div>
      <span className={`relative h-7 w-12 shrink-0 rounded-full p-1 transition ${checked ? "bg-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.22)]" : "bg-white/15"}`}>
        <span className={`block h-5 w-5 rounded-full transition ${checked ? "translate-x-5 bg-[#07140d]" : "translate-x-0 bg-white"}`} />
      </span>
    </button>
  );
}

function AudienceCard({ option, active, count, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[24px] border p-4 text-left transition ${active ? "border-emerald-300/38 bg-emerald-300/12 shadow-[0_0_32px_rgba(16,185,129,0.1)]" : "border-white/10 bg-white/[0.045] hover:border-emerald-300/22"}`}>
      <div className="flex items-center justify-between gap-3">
        <strong className="font-display text-lg text-white">{option.label}</strong>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-emerald-100">{Number(count || 0).toLocaleString()}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-white/50">{option.description}</p>
    </button>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{label}</span>
      <strong className="mt-1 block truncate text-sm text-white/82">{value}</strong>
    </div>
  );
}

function LightMiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <strong className="mt-1 block truncate text-sm text-slate-900">{value}</strong>
    </div>
  );
}

function InfoLine({ icon: Icon, title, text }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-emerald-200" />
        <strong className="text-sm text-white">{title}</strong>
      </div>
      <p className="mt-2 text-sm leading-6 text-white/50">{text}</p>
    </div>
  );
}

function StatusLine({ icon: Icon, title, value, danger = false }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border ${danger ? "border-rose-300/20 bg-rose-300/10 text-rose-200" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"}`}>
          <Icon size={18} />
        </span>
        <strong className="text-sm text-white">{title}</strong>
      </div>
      <span className="font-display text-2xl font-bold text-white">{Number(value || 0).toLocaleString()}</span>
    </div>
  );
}

function ProgressBar({ value }) {
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-white/45">
        <span>Progress</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status, liveStatus }) {
  const normalized = liveStatus === "delivered" ? "sent" : liveStatus === "failed" ? "failed" : status;
  const styles = {
    draft: "border-white/10 bg-white/[0.08] text-white/78",
    scheduled: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    sending: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    sent: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
    failed: "border-rose-300/25 bg-rose-300/10 text-rose-200"
  };
  const labels = {
    draft: "Pending",
    scheduled: "Pending",
    sending: "Sent",
    sent: "Delivered",
    failed: "Failed"
  };
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${styles[normalized] || styles.draft}`}>{labels[normalized] || titleCase(normalized)}</span>;
}

function TableAction({ icon: Icon, label, onClick, danger = false, disabled = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${danger ? "border-rose-300/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15" : "border-white/10 bg-white/[0.05] text-white/75 hover:border-emerald-300/35 hover:text-emerald-200"}`}>
      <Icon size={14} />
      {label}
    </button>
  );
}

function Toast({ toast, onClose }) {
  const success = toast.type === "success";
  return (
    <motion.div
      className={`fixed bottom-5 right-5 z-[160] flex max-w-sm items-start gap-3 rounded-[24px] border p-4 text-white shadow-2xl backdrop-blur-2xl ${success ? "border-emerald-300/25 bg-[#08140e]/90" : "border-rose-300/25 bg-rose-950/90"}`}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.96 }}
    >
      <span className={`mt-0.5 ${success ? "text-emerald-200" : "text-rose-200"}`}>{success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">{success ? "Success" : "Action needed"}</strong>
        <p className="mt-1 text-sm text-white/68">{toast.message}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-1 text-white/45 transition hover:bg-white/10 hover:text-white">x</button>
    </motion.div>
  );
}
