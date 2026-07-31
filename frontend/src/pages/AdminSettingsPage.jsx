import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  Moon,
  Package,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Sun,
  Trash2,
  Upload,
  Users,
  WalletCards
} from "lucide-react";
import { api, API_URL, getApiErrorMessage } from "../api/client";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { useAuth } from "../context/AuthContext";
import { emitUserThemeChange, readUserTheme, saveUserTheme } from "../utils/userTheme";

const defaultSettings = {
  general: {
    shopName: "Tela to Pera Thrift Shop",
    shopLogoUrl: "",
    shopDescription: "AI-assisted thrift ecommerce for curated apparel and customer support.",
    contactNumber: "",
    emailAddress: "",
    shopAddress: "",
    currency: "PHP",
    language: "English"
  },
  ai: {
    openaiApiKey: "",
    openaiApiKeySaved: false,
    aiProvider: "auto",
    currentProvider: "Auto",
    lastProviderUsed: "None",
    apiStatus: "Missing API key",
    providerStatus: {
      openai: "Missing API key",
      gemini: "Missing API key"
    },
    aiAssistant: true,
    aiAutoReply: true,
    aiRecommendation: true,
    aiChatTemperature: 0.35
  },
  notifications: {
    newOrderNotifications: true,
    lowStockAlerts: true,
    outOfStockAlerts: true,
    refundAlerts: true,
    emailNotifications: true,
    pushNotifications: true,
    soundNotifications: true
  },
  payment: {
    gcashNumber: "",
    gcashQrUrl: "",
    codEnabled: true,
    onlinePaymentEnabled: true,
    paymentVerificationAutomation: true,
    shippingFeeType: "fixed",
    shippingFee: 0,
    coupons: []
  },
  security: {
    twoFactorAuthentication: false,
    sessionTimeout: 60,
    loginActivity: true,
    adminAccessControl: true
  },
  inventory: {
    lowStockThreshold: 3,
    autoRestockAlert: true,
    barcodeEnabled: true,
    skuGeneratorEnabled: true
  },
  reports: {
    autoGenerateReports: false,
    dailyReports: true,
    weeklyReports: true,
    monthlyReports: true,
    exportPdf: true,
    exportExcel: true
  },
  appearance: {
    darkMode: false,
    themeColor: "#22C55E",
    dashboardLayout: "Comfortable",
    sidebarCollapse: false
  },
  customers: {
    customerRegistrationApproval: false,
    autoWelcomeMessage: true,
    loyaltyRewards: false,
    customerBroadcastNotifications: true
  },
  about: {
    mission: "To provide affordable, quality, and sustainable thrift fashion products while improving customer experience using modern technology.",
    vision: "To become a trusted AI-powered thrift ecommerce platform in the Philippines.",
    fullAddress: "Tela to Pera Thrift Shop, Philippines",
    landmark: "Near the local community market",
    facebookPage: "https://facebook.com/telatopera",
    instagramLink: "https://instagram.com/telatopera",
    messengerLink: "https://m.me/telatopera",
    businessDays: "Monday to Sunday",
    openingTime: "9:00 AM",
    closingTime: "7:00 PM",
    paymentMethods: "GCash, Cash on Delivery, Online Payments",
    deliveryAreas: "Selected nearby areas and customer pickup points",
    estimatedDeliveryTime: "1 to 3 business days after order confirmation",
    returnConditions: "Return allowed within 7 days. Apparel must not be heavily damaged.",
    refundProcess: "Refund approval depends on admin verification and proof review.",
    supportChannels: "Live chat, AI assistant support, and admin support",
    ownerProfile: "Tela to Pera Thrift Shop Admin",
    developers: "RETELA Development Team",
    thesisMembers: "RETELA Thesis Members"
  }
};

const sectionDescriptions = {
  general: "Business identity, public contact details, currency, language, and shop branding.",
  ai: "Assistant behavior, secure API key storage, recommendations, and response creativity.",
  notifications: "Operational alerts for orders, inventory, refunds, email, push, and sound channels.",
  payment: "GCash details, QR code, cash-on-delivery, online payments, and verification automation.",
  security: "Password updates, access rules, two-factor control, session timeout, and login activity.",
  inventory: "Stock thresholds, restock alerts, barcode support, and SKU generation.",
  reports: "Automated reporting schedules and export availability for PDF and Excel.",
  appearance: "Dashboard theme, layout density, dark mode, and sidebar behavior.",
  customers: "Customer onboarding, welcome messages, loyalty rewards, and broadcasts.",
  about: "Customer-facing shop story, location, support, policies, team, and business details.",
  dataManagement: "Access archived and deleted records without changing how recovery and permanent deletion work.",
  backup: "Database health, backups, restores, and downloadable backend logs."
};

const sectionTitles = {
  general: "General Settings",
  ai: "AI Settings",
  notifications: "Notification Settings",
  payment: "Payment Settings",
  security: "Security Settings",
  inventory: "Inventory Settings",
  reports: "Report Settings",
  appearance: "Appearance Settings",
  customers: "Customer Settings",
  about: "About Page Settings",
  dataManagement: "Data Management",
  backup: "Backup & Database"
};

const sectionIcons = {
  general: Store,
  ai: Bot,
  notifications: Bell,
  payment: WalletCards,
  security: ShieldCheck,
  inventory: Package,
  reports: BarChart3,
  appearance: Palette,
  customers: Users,
  about: Store,
  dataManagement: Database,
  backup: Database
};

function withDefaults(input = {}) {
  const merged = Object.entries(defaultSettings).reduce((next, [section, values]) => {
    next[section] = { ...values, ...(input?.[section] || {}) };
    return next;
  }, {});
  return { ...merged, databaseStatus: input.databaseStatus || null };
}

function assetUrl(url) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_URL.replace(/\/api$/, "")}${url}`;
}

function validateSettings(settings, scope = "all") {
  const errors = {};
  const includes = (section) => scope === "all" || scope === section;

  if (includes("general")) {
    if (!settings.general.shopName.trim()) errors["general.shopName"] = "Shop name is required.";
    if (settings.general.emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.general.emailAddress)) {
      errors["general.emailAddress"] = "Use a valid email address.";
    }
    if (settings.general.contactNumber && !/^[0-9+\-\s()]{7,30}$/.test(settings.general.contactNumber)) {
      errors["general.contactNumber"] = "Use a valid contact number.";
    }
  }

  if (includes("ai")) {
    if (settings.ai.openaiApiKey && settings.ai.openaiApiKey.trim().length < 12) {
      errors["ai.openaiApiKey"] = "API key looks too short.";
    }
    if (!["openai", "gemini", "auto"].includes(settings.ai.aiProvider)) {
      errors["ai.aiProvider"] = "Choose OpenAI, Gemini, or Auto.";
    }
    const temperature = Number(settings.ai.aiChatTemperature);
    if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
      errors["ai.aiChatTemperature"] = "Temperature must be between 0 and 2.";
    }
  }

  if (includes("payment")) {
    if (settings.payment.gcashNumber && !/^[0-9+\-\s()]{7,30}$/.test(settings.payment.gcashNumber)) {
      errors["payment.gcashNumber"] = "Use a valid GCash number.";
    }
    if (!settings.payment.codEnabled && !settings.payment.onlinePaymentEnabled) {
      errors["payment.methods"] = "Enable at least one payment method.";
    }
  }

  if (includes("security")) {
    const timeout = Number(settings.security.sessionTimeout);
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 1440) {
      errors["security.sessionTimeout"] = "Session timeout must be 5 to 1440 minutes.";
    }
  }

  if (includes("inventory")) {
    const threshold = Number(settings.inventory.lowStockThreshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 999) {
      errors["inventory.lowStockThreshold"] = "Threshold must be a whole number from 0 to 999.";
    }
  }

  if (includes("appearance") && !/^#[0-9A-Fa-f]{6}$/.test(settings.appearance.themeColor)) {
    errors["appearance.themeColor"] = "Use a valid hex color.";
  }

  return errors;
}

export default function AdminSettingsPage({ onChange }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(withDefaults());
  const [files, setFiles] = useState({ shopLogo: null, gcashQr: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [toast, setToast] = useState(null);
  const [userTheme, setUserTheme] = useState(() => readUserTheme(user));
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const restoreInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const shopLogoPreview = useMemo(() => files.shopLogo ? URL.createObjectURL(files.shopLogo) : assetUrl(settings.general.shopLogoUrl), [files.shopLogo, settings.general.shopLogoUrl]);
  const gcashQrPreview = useMemo(() => files.gcashQr ? URL.createObjectURL(files.gcashQr) : assetUrl(settings.payment.gcashQrUrl), [files.gcashQr, settings.payment.gcashQrUrl]);

  useEffect(() => {
    api.get("/settings")
      .then(({ data }) => {
        const hydrated = withDefaults(data);
        setSettings(hydrated);
        localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
        window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
        window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      })
      .catch((error) => pushToast("error", getApiErrorMessage(error, "Could not load settings.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setUserTheme(readUserTheme(user));
  }, [user?.id, user?.role]);

  useEffect(() => {
    document.documentElement.style.setProperty("--retela-theme-color", settings.appearance.themeColor);
  }, [settings.appearance.themeColor]);

  useEffect(() => () => {
    if (files.shopLogo) URL.revokeObjectURL(shopLogoPreview);
    if (files.gcashQr) URL.revokeObjectURL(gcashQrPreview);
  }, [files.shopLogo, files.gcashQr, shopLogoPreview, gcashQrPreview]);

  function pushToast(type, message) {
    setToast({ type, message });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }

  function updateSetting(section, key, value) {
    setSettings((current) => {
      const next = { ...current, [section]: { ...current[section], [key]: value } };
      if (section === "appearance" && key === "sidebarCollapse") {
        if (key === "sidebarCollapse") localStorage.setItem("retela_sidebar_collapsed", String(value));
        window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: next.appearance.sidebarCollapse } }));
      }
      return next;
    });
    setErrors((current) => ({ ...current, [`${section}.${key}`]: "" }));
  }

  function updateFile(key, file) {
    setFiles((current) => ({ ...current, [key]: file }));
  }

  function updateCoupon(index, key, value) {
    setSettings((current) => {
      const coupons = [...(current.payment.coupons || [])];
      coupons[index] = { ...coupons[index], [key]: value };
      return { ...current, payment: { ...current.payment, coupons } };
    });
  }

  function addCoupon() {
    setSettings((current) => ({
      ...current,
      payment: {
        ...current.payment,
        coupons: [...(current.payment.coupons || []), { code: "", discountPercent: 0, freeShipping: false, expiresAt: "", active: true }]
      }
    }));
  }

  function removeCoupon(index) {
    setSettings((current) => ({
      ...current,
      payment: {
        ...current.payment,
        coupons: (current.payment.coupons || []).filter((_, couponIndex) => couponIndex !== index)
      }
    }));
  }

  function updateUserTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    setUserTheme(nextTheme);
    saveUserTheme(user, nextTheme);
    emitUserThemeChange(user, nextTheme);
  }

  function buildPayload(scope) {
    const payload = JSON.parse(JSON.stringify(settings));
    delete payload.databaseStatus;
    if (!payload.ai.openaiApiKey.trim()) payload.ai.openaiApiKey = "";
    if (Array.isArray(payload.payment?.coupons)) {
      payload.payment.coupons = payload.payment.coupons.filter((coupon) => String(coupon.code || "").trim());
    }
    const formData = new FormData();
    formData.append("settings", JSON.stringify(payload));
    if ((scope === "all" || scope === "general") && files.shopLogo) formData.append("shopLogo", files.shopLogo);
    if ((scope === "all" || scope === "payment") && files.gcashQr) formData.append("gcashQr", files.gcashQr);
    return formData;
  }

  async function saveSettings(scope = "all") {
    const nextErrors = validateSettings(settings, scope);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      pushToast("error", "Please fix the highlighted settings.");
      return;
    }

    setSaving(scope);
    try {
      const { data } = await api.put("/settings", buildPayload(scope), { headers: { "Content-Type": "multipart/form-data" } });
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      setFiles((current) => ({
        shopLogo: scope === "all" || scope === "general" ? null : current.shopLogo,
        gcashQr: scope === "all" || scope === "payment" ? null : current.gcashQr
      }));
      localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
      window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      pushToast("success", scope === "all" ? "All settings saved." : `${sectionTitles[scope] || titleCase(scope)} saved.`);
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not save settings."));
    } finally {
      setSaving("");
    }
  }

  async function resetDefaults() {
    setSaving("reset");
    try {
      const { data } = await api.post("/settings/reset");
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      setFiles({ shopLogo: null, gcashQr: null });
      setErrors({});
      localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
      window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      pushToast("success", "Settings reset to defaults.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not reset settings."));
    } finally {
      setSaving("");
    }
  }

  async function downloadBackup() {
    setSaving("backup");
    try {
      const { data } = await api.get("/settings/backup", { responseType: "blob" });
      downloadBlob(data, `retela-backup-${new Date().toISOString().slice(0, 10)}.json`);
      pushToast("success", "Database backup downloaded.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not download backup."));
    } finally {
      setSaving("");
    }
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving("restore");
    try {
      const backup = JSON.parse(await file.text());
      const { data } = await api.post("/settings/restore", { backup });
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
      window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      pushToast("success", "Settings restored from backup.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not restore this backup file."));
    } finally {
      event.target.value = "";
      setSaving("");
    }
  }

  async function downloadLogs() {
    setSaving("logs");
    try {
      const { data } = await api.get("/settings/logs", { responseType: "blob" });
      downloadBlob(data, `retela-system-logs-${new Date().toISOString().slice(0, 10)}.txt`);
      pushToast("success", "System logs downloaded.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not download logs."));
    } finally {
      setSaving("");
    }
  }

  async function clearDemoData() {
    setSaving("clearDemoData");
    try {
      const { data } = await api.post("/settings/clear-demo-data");
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "demo-data-cleared" } }));
      setClearConfirmOpen(false);
      pushToast("success", data.message || "Demo data cleared successfully. System is ready for client deployment.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not clear demo data."));
    } finally {
      setSaving("");
    }
  }

  if (loading) {
    return (
      <div className="grid gap-5 xl:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="premium-card skeleton min-h-72 rounded-[28px]" />)}
      </div>
    );
  }

  return (
    <div className="settings-page grid gap-5">
      <section className="relative overflow-hidden rounded-[32px] border border-neonbrand/20 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(56,255,136,0.18),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(34,197,94,0.16),transparent_30%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-neonbrand/75">Admin Control Center</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">Settings</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">Configure RETELA system behavior, AI automation, payments, inventory alerts, reports, security, and database operations.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionButton type="secondary" icon={RotateCcw} loading={saving === "reset"} onClick={resetDefaults}>Reset to Default</ActionButton>
            <ActionButton icon={Save} loading={saving === "all"} onClick={() => saveSettings("all")}>Save All Changes</ActionButton>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <SettingsCard section="general" saving={saving} onSave={saveSettings}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Shop Name" value={settings.general.shopName} error={errors["general.shopName"]} onChange={(value) => updateSetting("general", "shopName", value)} />
            <FileInput label="Shop Logo Upload" file={files.shopLogo} preview={shopLogoPreview} onChange={(file) => updateFile("shopLogo", file)} />
            <TextArea label="Shop Description" value={settings.general.shopDescription} onChange={(value) => updateSetting("general", "shopDescription", value)} className="md:col-span-2" />
            <TextInput label="Contact Number" value={settings.general.contactNumber} error={errors["general.contactNumber"]} onChange={(value) => updateSetting("general", "contactNumber", value)} />
            <TextInput label="Email Address" type="email" value={settings.general.emailAddress} error={errors["general.emailAddress"]} onChange={(value) => updateSetting("general", "emailAddress", value)} />
            <TextInput label="Shop Address" value={settings.general.shopAddress} onChange={(value) => updateSetting("general", "shopAddress", value)} className="md:col-span-2" />
            <SelectInput label="Currency" value={settings.general.currency} options={["PHP"]} onChange={(value) => updateSetting("general", "currency", value)} />
            <SelectInput label="Language" value={settings.general.language} options={["English", "Filipino"]} onChange={(value) => updateSetting("general", "language", value)} />
          </div>
        </SettingsCard>

        <SettingsCard section="ai" saving={saving} onSave={saveSettings}>
          <div className="grid gap-4">
            <AIProviderSelector
              value={settings.ai.aiProvider}
              currentProvider={settings.ai.currentProvider}
              lastProviderUsed={settings.ai.lastProviderUsed}
              apiStatus={settings.ai.apiStatus}
              providerStatus={settings.ai.providerStatus}
              onChange={(value) => updateSetting("ai", "aiProvider", value)}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <ToggleSwitch label="AI Assistant" checked={settings.ai.aiAssistant} onChange={(value) => updateSetting("ai", "aiAssistant", value)} />
              <ToggleSwitch label="AI Auto Reply" checked={settings.ai.aiAutoReply} onChange={(value) => updateSetting("ai", "aiAutoReply", value)} />
              <ToggleSwitch label="AI Recommendation" checked={settings.ai.aiRecommendation} onChange={(value) => updateSetting("ai", "aiRecommendation", value)} />
            </div>
            <RangeInput label="AI Chat Temperature Slider" value={settings.ai.aiChatTemperature} min={0} max={2} step={0.05} error={errors["ai.aiChatTemperature"]} onChange={(value) => updateSetting("ai", "aiChatTemperature", Number(value))} />
            <InlineNotice icon={LockKeyhole}>API keys are loaded only from the backend environment and are never sent to the browser.</InlineNotice>
          </div>
        </SettingsCard>

        <SettingsCard section="notifications" saving={saving} onSave={saveSettings}>
          <ToggleGrid>
            <ToggleSwitch label="New Order Notifications" checked={settings.notifications.newOrderNotifications} onChange={(value) => updateSetting("notifications", "newOrderNotifications", value)} />
            <ToggleSwitch label="Low Stock Alerts" checked={settings.notifications.lowStockAlerts} onChange={(value) => updateSetting("notifications", "lowStockAlerts", value)} />
            <ToggleSwitch label="Out of Stock Alerts" checked={settings.notifications.outOfStockAlerts} onChange={(value) => updateSetting("notifications", "outOfStockAlerts", value)} />
            <ToggleSwitch label="Refund Alerts" checked={settings.notifications.refundAlerts} onChange={(value) => updateSetting("notifications", "refundAlerts", value)} />
            <ToggleSwitch label="Email Notifications" checked={settings.notifications.emailNotifications} onChange={(value) => updateSetting("notifications", "emailNotifications", value)} />
            <ToggleSwitch label="Push Notifications" checked={settings.notifications.pushNotifications} onChange={(value) => updateSetting("notifications", "pushNotifications", value)} />
            <ToggleSwitch label="Sound Notifications" checked={settings.notifications.soundNotifications} onChange={(value) => updateSetting("notifications", "soundNotifications", value)} />
          </ToggleGrid>
        </SettingsCard>

        <SettingsCard section="payment" saving={saving} onSave={saveSettings}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="GCash Number" value={settings.payment.gcashNumber} error={errors["payment.gcashNumber"]} onChange={(value) => updateSetting("payment", "gcashNumber", value)} />
            <FileInput label="GCash QR Upload" file={files.gcashQr} preview={gcashQrPreview} onChange={(file) => updateFile("gcashQr", file)} />
            <SelectInput label="Shipping Fee Type" value={settings.payment.shippingFeeType || "fixed"} options={["fixed", "free"]} onChange={(value) => updateSetting("payment", "shippingFeeType", value)} />
            <NumberInput label="Fixed Shipping Fee" value={settings.payment.shippingFee ?? 0} onChange={(value) => updateSetting("payment", "shippingFee", value)} />
            <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
              <ToggleSwitch label="COD Toggle" checked={settings.payment.codEnabled} onChange={(value) => updateSetting("payment", "codEnabled", value)} />
              <ToggleSwitch label="Online Payment Toggle" checked={settings.payment.onlinePaymentEnabled} onChange={(value) => updateSetting("payment", "onlinePaymentEnabled", value)} />
              <ToggleSwitch label="Payment Verification Automation" checked={settings.payment.paymentVerificationAutomation} onChange={(value) => updateSetting("payment", "paymentVerificationAutomation", value)} />
            </div>
            <CouponManager coupons={settings.payment.coupons || []} onAdd={addCoupon} onRemove={removeCoupon} onChange={updateCoupon} />
            {errors["payment.methods"] ? <ErrorText className="md:col-span-2">{errors["payment.methods"]}</ErrorText> : null}
          </div>
        </SettingsCard>

        <SettingsCard section="security" saving={saving} onSave={saveSettings} className="xl:col-span-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleSwitch label="Two Factor Authentication Toggle" checked={settings.security.twoFactorAuthentication} onChange={(value) => updateSetting("security", "twoFactorAuthentication", value)} />
              <ToggleSwitch label="Login Activity" checked={settings.security.loginActivity} onChange={(value) => updateSetting("security", "loginActivity", value)} />
              <ToggleSwitch label="Admin Access Control" checked={settings.security.adminAccessControl} onChange={(value) => updateSetting("security", "adminAccessControl", value)} />
              <NumberInput label="Session Timeout" suffix="minutes" value={settings.security.sessionTimeout} error={errors["security.sessionTimeout"]} onChange={(value) => updateSetting("security", "sessionTimeout", Number(value))} />
              <InlineNotice icon={Clock3} className="md:col-span-2">Active sessions use this timeout value for admin policy tracking.</InlineNotice>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <ChangePasswordForm />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard section="inventory" saving={saving} onSave={saveSettings}>
          <div className="grid gap-4">
            <NumberInput label="Low Stock Threshold" value={settings.inventory.lowStockThreshold} error={errors["inventory.lowStockThreshold"]} onChange={(value) => updateSetting("inventory", "lowStockThreshold", Number(value))} />
            <ToggleGrid>
              <ToggleSwitch label="Auto Restock Alert" checked={settings.inventory.autoRestockAlert} onChange={(value) => updateSetting("inventory", "autoRestockAlert", value)} />
              <ToggleSwitch label="Barcode Toggle" checked={settings.inventory.barcodeEnabled} onChange={(value) => updateSetting("inventory", "barcodeEnabled", value)} />
              <ToggleSwitch label="SKU Generator Toggle" checked={settings.inventory.skuGeneratorEnabled} onChange={(value) => updateSetting("inventory", "skuGeneratorEnabled", value)} />
            </ToggleGrid>
          </div>
        </SettingsCard>

        <SettingsCard section="reports" saving={saving} onSave={saveSettings}>
          <ToggleGrid>
            <ToggleSwitch label="Auto Generate Reports" checked={settings.reports.autoGenerateReports} onChange={(value) => updateSetting("reports", "autoGenerateReports", value)} />
            <ToggleSwitch label="Daily Reports" checked={settings.reports.dailyReports} onChange={(value) => updateSetting("reports", "dailyReports", value)} />
            <ToggleSwitch label="Weekly Reports" checked={settings.reports.weeklyReports} onChange={(value) => updateSetting("reports", "weeklyReports", value)} />
            <ToggleSwitch label="Monthly Reports" checked={settings.reports.monthlyReports} onChange={(value) => updateSetting("reports", "monthlyReports", value)} />
            <ToggleSwitch label="Export PDF" checked={settings.reports.exportPdf} onChange={(value) => updateSetting("reports", "exportPdf", value)} />
            <ToggleSwitch label="Export Excel" checked={settings.reports.exportExcel} onChange={(value) => updateSetting("reports", "exportExcel", value)} />
          </ToggleGrid>
        </SettingsCard>

        <SettingsCard section="appearance" saving={saving} onSave={saveSettings}>
          <div className="grid gap-4 md:grid-cols-2">
            <ThemeModeSwitch theme={userTheme} onChange={updateUserTheme} />
            <ToggleSwitch label="Sidebar Collapse Toggle" checked={settings.appearance.sidebarCollapse} onChange={(value) => updateSetting("appearance", "sidebarCollapse", value)} />
            <ColorInput label="Theme Color" value={settings.appearance.themeColor} error={errors["appearance.themeColor"]} onChange={(value) => updateSetting("appearance", "themeColor", value)} />
            <SelectInput label="Dashboard Layout" value={settings.appearance.dashboardLayout} options={["Comfortable", "Compact", "Analytics Focus"]} onChange={(value) => updateSetting("appearance", "dashboardLayout", value)} />
          </div>
        </SettingsCard>

        <SettingsCard section="customers" saving={saving} onSave={saveSettings}>
          <ToggleGrid>
            <ToggleSwitch label="Auto Welcome Message" checked={settings.customers.autoWelcomeMessage} onChange={(value) => updateSetting("customers", "autoWelcomeMessage", value)} />
            <ToggleSwitch label="Loyalty Rewards Toggle" checked={settings.customers.loyaltyRewards} onChange={(value) => updateSetting("customers", "loyaltyRewards", value)} />
            <ToggleSwitch label="Customer Broadcast Notifications" checked={settings.customers.customerBroadcastNotifications} onChange={(value) => updateSetting("customers", "customerBroadcastNotifications", value)} />
          </ToggleGrid>
        </SettingsCard>

        <SettingsCard section="about" saving={saving} onSave={saveSettings} className="xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <TextArea label="Mission" value={settings.about.mission} onChange={(value) => updateSetting("about", "mission", value)} />
            <TextArea label="Vision" value={settings.about.vision} onChange={(value) => updateSetting("about", "vision", value)} />
            <TextInput label="Full Address" value={settings.about.fullAddress} onChange={(value) => updateSetting("about", "fullAddress", value)} />
            <TextInput label="Store Landmark" value={settings.about.landmark} onChange={(value) => updateSetting("about", "landmark", value)} />
            <TextInput label="Facebook Page" value={settings.about.facebookPage} onChange={(value) => updateSetting("about", "facebookPage", value)} />
            <TextInput label="Instagram Link" value={settings.about.instagramLink} onChange={(value) => updateSetting("about", "instagramLink", value)} />
            <TextInput label="Messenger Link" value={settings.about.messengerLink} onChange={(value) => updateSetting("about", "messengerLink", value)} />
            <TextInput label="Business Days" value={settings.about.businessDays} onChange={(value) => updateSetting("about", "businessDays", value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Opening Time" value={settings.about.openingTime} onChange={(value) => updateSetting("about", "openingTime", value)} />
              <TextInput label="Closing Time" value={settings.about.closingTime} onChange={(value) => updateSetting("about", "closingTime", value)} />
            </div>
            <TextInput label="Payment Methods" value={settings.about.paymentMethods} onChange={(value) => updateSetting("about", "paymentMethods", value)} />
            <TextInput label="Delivery Areas" value={settings.about.deliveryAreas} onChange={(value) => updateSetting("about", "deliveryAreas", value)} />
            <TextInput label="Estimated Delivery Time" value={settings.about.estimatedDeliveryTime} onChange={(value) => updateSetting("about", "estimatedDeliveryTime", value)} />
            <TextInput label="Support Channels" value={settings.about.supportChannels} onChange={(value) => updateSetting("about", "supportChannels", value)} />
            <TextArea label="Return Conditions" value={settings.about.returnConditions} onChange={(value) => updateSetting("about", "returnConditions", value)} />
            <TextArea label="Refund Process" value={settings.about.refundProcess} onChange={(value) => updateSetting("about", "refundProcess", value)} />
            <TextInput label="Owner/Admin Profile" value={settings.about.ownerProfile} onChange={(value) => updateSetting("about", "ownerProfile", value)} />
            <TextInput label="Developers" value={settings.about.developers} onChange={(value) => updateSetting("about", "developers", value)} />
            <TextInput label="Thesis Members" value={settings.about.thesisMembers} onChange={(value) => updateSetting("about", "thesisMembers", value)} className="md:col-span-2" />
          </div>
        </SettingsCard>

        <SettingsCard section="dataManagement" saving={saving} onSave={null} className="xl:col-span-2">
          <div className="grid gap-3 lg:grid-cols-3">
            <DataManagementButton
              icon={Archive}
              title="Archive"
              description="View archived conversations and restore or move them to the Trash Bin."
              onClick={() => onChange?.("Archive")}
            />
            <DataManagementButton
              icon={Trash2}
              title="Trash Bin"
              description="Review deleted apparel, conversations, and broadcasts."
              onClick={() => onChange?.("Trash Bin")}
            />
            <DataManagementButton
              icon={Trash2}
              title="Clear Demo Data"
              description="Remove sample products, inventory, sales, orders, reports, returns, archive, and trash data before deployment."
              onClick={() => setClearConfirmOpen(true)}
            />
          </div>
        </SettingsCard>

        <SettingsCard section="backup" saving={saving} onSave={null} className="xl:col-span-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1fr)]">
            <DatabaseStatus status={settings.databaseStatus} />
            <div className="grid gap-3 sm:grid-cols-3">
              <ActionButton icon={Download} loading={saving === "backup"} onClick={downloadBackup}>Backup Database</ActionButton>
              <ActionButton type="secondary" icon={RefreshCw} loading={saving === "restore"} onClick={() => restoreInputRef.current?.click()}>Restore Database</ActionButton>
              <ActionButton type="secondary" icon={FileText} loading={saving === "logs"} onClick={downloadLogs}>Download System Logs</ActionButton>
              <input ref={restoreInputRef} type="file" accept="application/json,.json" className="hidden" onChange={restoreBackup} />
            </div>
          </div>
        </SettingsCard>
      </div>

      <AnimatePresence>
        {toast ? <Toast key={toast.message} type={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null}
        {clearConfirmOpen ? (
          <ClearDemoDataModal
            saving={saving === "clearDemoData"}
            onConfirm={clearDemoData}
            onClose={() => setClearConfirmOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SettingsCard({ section, saving, onSave, children, className = "" }) {
  const Icon = sectionIcons[section];
  return (
    <motion.section
      className={`premium-card min-w-0 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.34)] sm:p-5 ${className}`}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: "easeOut" }}
    >
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/25 bg-neonbrand/10 text-neonbrand shadow-[0_0_32px_rgba(56,255,136,0.14)]">
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-white">{sectionTitles[section] || titleCase(section)}</h2>
            <p className="mt-1 text-sm leading-6 text-white/52">{sectionDescriptions[section]}</p>
          </div>
        </div>
        {onSave ? (
          <ActionButton size="sm" icon={Save} loading={saving === section} onClick={() => onSave(section)}>
            Save
          </ActionButton>
        ) : null}
      </div>
      {children}
    </motion.section>
  );
}

function DataManagementButton({ icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-32 items-start gap-4 rounded-[24px] border border-neonbrand/20 bg-neonbrand/10 p-4 text-left transition hover:-translate-y-0.5 hover:border-neonbrand/45 hover:bg-neonbrand/15 hover:shadow-[0_18px_42px_rgba(34,197,94,0.12)] focus:outline-none focus:ring-4 focus:ring-neonbrand/15 sm:p-5"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/30 bg-black/20 text-neonbrand shadow-[0_0_28px_rgba(56,255,136,0.12)] transition group-hover:bg-neonbrand/15">
        <Icon size={22} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-xl font-bold text-white">{title}</span>
        <span className="mt-2 block text-sm leading-6 text-white/58">{description}</span>
      </span>
    </button>
  );
}

function ClearDemoDataModal({ saving, onConfirm, onClose }) {
  return (
    <motion.div
      className="fixed inset-0 z-[170] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={saving ? undefined : onClose}
    >
      <motion.div
        className="w-full max-w-lg rounded-[28px] border border-neonbrand/25 bg-slate-950 p-5 text-white shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_55px_rgba(56,255,136,0.14)] sm:p-6"
        initial={{ opacity: 0, scale: 0.94, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 18 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/25 bg-neonbrand/10 text-neonbrand">
            <Trash2 size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Deployment cleanup</p>
            <h3 className="mt-2 font-display text-2xl font-bold">Clear Demo Data?</h3>
            <p className="mt-2 text-sm leading-6 text-white/58">
              This removes only business demo data: products, inventory stock, orders, sales/report data, returns, archive/trash items, and related product uploads. Admins, customers, credentials, roles, permissions, and shop settings stay intact.
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.055] p-4 text-sm text-white/62">
          After clearing, product, inventory, sales, orders, reports, archive, trash, and dashboard totals will start from empty data.
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:border-neonbrand/45 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={onConfirm} className="gradient-btn inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
            Clear Demo Data
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ToggleGrid({ children }) {
  return <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{children}</div>;
}

function FieldShell({ label, error, children, className = "" }) {
  return (
    <label className={`grid min-w-0 gap-2 ${className}`}>
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">{label}</span>
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </label>
  );
}

function controlClasses(error) {
  return `min-h-12 w-full rounded-2xl border px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:ring-4 ${
    error
      ? "border-rose-400/55 bg-rose-500/10 focus:ring-rose-400/10"
      : "border-white/10 bg-white/[0.06] focus:border-neonbrand/60 focus:ring-neonbrand/10"
  }`;
}

function TextInput({ label, value, onChange, type = "text", error, className = "" }) {
  return (
    <FieldShell label={label} error={error} className={className}>
      <input type={type} className={controlClasses(error)} value={value} onChange={(event) => onChange(event.target.value)} />
    </FieldShell>
  );
}

function AIProviderSelector({ value = "auto", onChange, currentProvider, lastProviderUsed, apiStatus, providerStatus = {} }) {
  const options = [
    { value: "openai", label: "OpenAI" },
    { value: "gemini", label: "Gemini" },
    { value: "auto", label: "Auto" }
  ];
  const poweredBy = lastProviderUsed && lastProviderUsed !== "None" ? lastProviderUsed : currentProvider;
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">AI Provider</p>
          <h3 className="mt-1 text-lg font-bold text-white">Response Provider Settings</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold transition ${
                  active
                    ? "border-neonbrand/45 bg-neonbrand/15 text-neonbrand"
                    : "border-white/10 bg-white/[0.05] text-white/70 hover:border-neonbrand/35 hover:text-neonbrand"
                }`}
                aria-pressed={active}
              >
                <span className={`grid h-4 w-4 place-items-center rounded-full border ${active ? "border-neonbrand" : "border-white/35"}`}>
                  {active ? <span className="h-2 w-2 rounded-full bg-neonbrand" /> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <StatusPill label="Current Provider" value={currentProvider || "Auto"} />
        <StatusPill label="Last Provider Used" value={lastProviderUsed || "None"} />
        <StatusPill label="API Status" value={apiStatus || "Not checked"} />
      </div>
      <div className="rounded-2xl border border-neonbrand/20 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand">
        Powered by {poweredBy || "Auto"}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatusPill label="OpenAI" value={providerStatus.openai || "Missing API key"} />
        <StatusPill label="Gemini" value={providerStatus.gemini || "Missing API key"} />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, suffix, error }) {
  return (
    <FieldShell label={label} error={error}>
      <div className={`flex min-h-12 items-center gap-2 rounded-2xl border px-4 py-3 ${error ? "border-rose-400/55 bg-rose-500/10" : "border-white/10 bg-white/[0.06]"}`}>
        <input type="number" min="0" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span className="shrink-0 text-xs font-semibold text-white/45">{suffix}</span> : null}
      </div>
    </FieldShell>
  );
}

function CouponManager({ coupons, onAdd, onRemove, onChange }) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.045] p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Coupon Rules</p>
          <h3 className="mt-1 text-lg font-bold text-white">Customer Coupons</h3>
        </div>
        <ActionButton size="sm" icon={Sparkles} onClick={onAdd}>Add Coupon</ActionButton>
      </div>
      <div className="grid gap-3">
        {coupons.length ? coupons.map((coupon, index) => (
          <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 lg:grid-cols-[1fr_140px_180px_auto_auto_auto]">
            <input className={controlClasses()} placeholder="Code" value={coupon.code || ""} onChange={(event) => onChange(index, "code", event.target.value.toUpperCase())} />
            <input className={controlClasses()} type="number" min="0" max="100" placeholder="Discount %" value={coupon.discountPercent ?? 0} onChange={(event) => onChange(index, "discountPercent", event.target.value)} />
            <input className={controlClasses()} type="date" value={coupon.expiresAt || ""} onChange={(event) => onChange(index, "expiresAt", event.target.value)} />
            <button type="button" onClick={() => onChange(index, "freeShipping", !coupon.freeShipping)} className={`rounded-2xl border px-3 py-2 text-xs font-bold transition ${coupon.freeShipping ? "border-neonbrand/35 bg-neonbrand/15 text-neonbrand" : "border-white/10 bg-white/[0.06] text-white/60"}`}>Free Shipping</button>
            <button type="button" onClick={() => onChange(index, "active", !coupon.active)} className={`rounded-2xl border px-3 py-2 text-xs font-bold transition ${coupon.active ? "border-neonbrand/35 bg-neonbrand/15 text-neonbrand" : "border-white/10 bg-white/[0.06] text-white/60"}`}>{coupon.active ? "Active" : "Inactive"}</button>
            <button type="button" onClick={() => onRemove(index)} className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-300/20">Remove</button>
          </div>
        )) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/50">No coupon codes configured yet.</p>
        )}
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange, className = "" }) {
  return (
    <FieldShell label={label} className={className}>
      <textarea className={`${controlClasses()} min-h-28 resize-y`} value={value} onChange={(event) => onChange(event.target.value)} />
    </FieldShell>
  );
}

function SelectInput({ label, value, options, onChange }) {
  return (
    <FieldShell label={label}>
      <select className={controlClasses()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </FieldShell>
  );
}

function ColorInput({ label, value, onChange, error }) {
  return (
    <FieldShell label={label} error={error}>
      <div className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2 ${error ? "border-rose-400/55 bg-rose-500/10" : "border-white/10 bg-white/[0.06]"}`}>
        <input type="color" className="h-9 w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1" value={value} onChange={(event) => onChange(event.target.value)} />
        <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </FieldShell>
  );
}

function ThemeModeSwitch({ theme, onChange }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => onChange(dark ? "light" : "dark")}
      className="group flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-left transition hover:border-neonbrand/35 hover:bg-neonbrand/5"
      aria-pressed={dark}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition ${dark ? "border-neonbrand/30 bg-neonbrand/10 text-neonbrand" : "border-amber-200/30 bg-amber-200/10 text-amber-100"}`}>
          {dark ? <Moon size={19} /> : <Sun size={19} />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white/80">Dark Mode</span>
          <span className="mt-0.5 block text-xs font-bold text-white/42">{dark ? "Dark Mode" : "Light Mode"}</span>
        </span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full p-1 transition ${dark ? "bg-neonbrand shadow-[0_0_24px_rgba(56,255,136,0.22)]" : "bg-white/18"}`}>
        <span className={`block h-5 w-5 rounded-full transition ${dark ? "translate-x-5 bg-black" : "translate-x-0 bg-white"}`} />
      </span>
    </button>
  );
}

function RangeInput({ label, value, min, max, step, onChange, error }) {
  return (
    <FieldShell label={label} error={error}>
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-white/70">Focused</span>
          <strong className="rounded-full bg-neonbrand/10 px-3 py-1 text-sm text-neonbrand">{Number(value).toFixed(2)}</strong>
          <span className="text-sm font-semibold text-white/70">Creative</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} className="h-2 w-full accent-[#22C55E]" />
      </div>
    </FieldShell>
  );
}

function FileInput({ label, file, preview, onChange }) {
  return (
    <FieldShell label={label}>
      <div className="flex min-h-20 items-center gap-3 rounded-2xl border border-dashed border-neonbrand/25 bg-neonbrand/5 p-3">
        {preview ? (
          <img src={preview} className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 object-cover" alt="" />
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/20 text-white/45">
            <Upload size={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-white">{file ? file.name : "Upload image"}</span>
          <span className="mt-1 block text-xs text-white/45">PNG, JPG, or WEBP up to 5MB</span>
        </div>
        <span className="relative shrink-0">
          <input type="file" accept="image/*" className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => onChange(event.target.files?.[0] || null)} />
          <span className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm font-bold text-white transition hover:border-neonbrand/40 hover:text-neonbrand">Browse</span>
        </span>
      </div>
    </FieldShell>
  );
}

function ToggleSwitch({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="group flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-left transition hover:border-neonbrand/35 hover:bg-neonbrand/5" aria-pressed={checked}>
      <span className="min-w-0 text-sm font-semibold text-white/80">{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full p-1 transition ${checked ? "bg-neonbrand shadow-[0_0_24px_rgba(56,255,136,0.22)]" : "bg-white/18"}`}>
        <span className={`block h-5 w-5 rounded-full transition ${checked ? "translate-x-5 bg-black" : "translate-x-0 bg-white"}`} />
      </span>
    </button>
  );
}

function InlineNotice({ icon: Icon, children, className = "" }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-neonbrand/15 bg-neonbrand/10 p-3 text-sm text-white/60 ${className}`}>
      <Icon size={18} className="shrink-0 text-neonbrand" />
      <span>{children}</span>
    </div>
  );
}

function DatabaseStatus({ status }) {
  const connected = Boolean(status?.connected);
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Database Status Indicator</p>
          <h3 className="mt-2 font-display text-2xl font-bold text-white">{connected ? "Connected" : "Unavailable"}</h3>
        </div>
        <span className={`grid h-12 w-12 place-items-center rounded-2xl border ${connected ? "border-neonbrand/30 bg-neonbrand/10 text-neonbrand" : "border-rose-300/25 bg-rose-400/10 text-rose-200"}`}>
          {connected ? <CheckCircle2 size={23} /> : <AlertCircle size={23} />}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-white/58 sm:grid-cols-3">
        <StatusPill label="Database" value={status?.databaseName || "retela_db"} />
        <StatusPill label="Tables" value={status?.tableCount ?? "0"} />
        <StatusPill label="Checked" value={status?.checkedAt ? new Date(status.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now"} />
      </div>
    </div>
  );
}

function StatusPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
      <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-white/35">{label}</span>
      <strong className="mt-1 block truncate text-white/80">{value}</strong>
    </div>
  );
}

function ActionButton({ children, icon: Icon, onClick, loading, type = "primary", size = "md" }) {
  const sizeClass = size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm";
  const styleClass = type === "primary"
    ? "gradient-btn"
    : "border border-white/10 bg-white/[0.06] text-white hover:border-neonbrand/45 hover:text-neonbrand";
  return (
    <button type="button" disabled={loading} onClick={onClick} className={`${styleClass} inline-flex min-w-0 items-center justify-center gap-2 rounded-2xl font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass}`}>
      {loading ? <Loader2 size={17} className="animate-spin" /> : Icon ? <Icon size={17} /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

function Toast({ type, message, onClose }) {
  const success = type === "success";
  return (
    <motion.div
      className={`fixed bottom-5 right-5 z-[160] flex max-w-sm items-start gap-3 rounded-[24px] border p-4 text-white shadow-2xl backdrop-blur-2xl ${success ? "border-neonbrand/25 bg-black/85" : "border-rose-300/25 bg-rose-950/85"}`}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.96 }}
    >
      <span className={`mt-0.5 ${success ? "text-neonbrand" : "text-rose-200"}`}>{success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">{success ? "Success" : "Action needed"}</strong>
        <p className="mt-1 text-sm text-white/65">{message}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white" aria-label="Close notification">x</button>
    </motion.div>
  );
}

function ErrorText({ children, className = "" }) {
  return <p className={`text-xs font-semibold text-rose-200 ${className}`}>{children}</p>;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function titleCase(value) {
  return String(value || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}
