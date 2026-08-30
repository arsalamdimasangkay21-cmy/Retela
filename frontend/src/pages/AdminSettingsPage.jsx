import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Download,
  FileText,
  Loader2,
  LockKeyhole,
  MapPin,
  Moon,
  Package,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Sun,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { api, API_URL, cachedGet, clearGetCache, getApiErrorMessage } from "../api/client";
import { osmTileUrl } from "../config/maps";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import LogoImage from "../components/LogoImage";
import { useAuth } from "../context/AuthContext";
import useBlockingLoader from "../hooks/useBlockingLoader";
import { emitUserThemeChange, readUserTheme, saveUserTheme } from "../utils/userTheme";

const defaultSettings = {
  general: {
    shopName: "Tela to Pera Thrift Shop",
    shopLogoUrl: "",
    shopLogoUpdatedAt: null,
    shopDescription: "AI-assisted thrift ecommerce for curated apparel and customer support.",
    contactNumber: "",
    emailAddress: "",
    shopAddress: "",
    shopMunicipality: "",
    shopProvince: "",
    shopRegion: "",
    shopPlaceId: "",
    shopLatitude: null,
    shopLongitude: null,
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
    soundNotifications: true,
    meetup24HourReminder: true,
    meetup1HourReminder: true
  },
  payment: {
    gcashNumber: "",
    gcashQrUrl: "",
    codEnabled: true,
    onlinePaymentEnabled: true,
    paymentVerificationAutomation: true,
    shippingFeeType: "fixed",
    shippingFee: 0,
    freeDeliveryMunicipalities: ["Midsayap", "Libungan", "Pigcawayan"],
    freeDeliveryRadiusKm: 15,
    outsideAreaShippingFee: 89,
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
    deliverySafetyPolicy: "For everyone's safety, customers and delivery personnel should meet only at the confirmed delivery or meeting location shown in the order. Verify the order and customer/delivery identity before handing over or accepting an item. Avoid changing the meetup location through unofficial messages. Keep communication inside RETELA whenever possible. Do not share OTPs, passwords, or sensitive account information. If the location feels unsafe, contact the other party through RETELA and arrange a safer public meeting point before completing the order.",
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
  dataManagement: "Review preserved customer suspensions, archived conversations, and deleted operational records.",
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
    const latitude = settings.general.shopLatitude;
    const longitude = settings.general.shopLongitude;
    const hasLatitude = latitude !== "" && latitude !== null && latitude !== undefined;
    const hasLongitude = longitude !== "" && longitude !== null && longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      errors["general.shopLocation"] = "Set both latitude and longitude for the exact shop location.";
    }
    if (hasLatitude && (Number(latitude) < -90 || Number(latitude) > 90 || Number.isNaN(Number(latitude)))) {
      errors["general.shopLocation"] = "Shop latitude must be between -90 and 90.";
    }
    if (hasLongitude && (Number(longitude) < -180 || Number(longitude) > 180 || Number.isNaN(Number(longitude)))) {
      errors["general.shopLocation"] = "Shop longitude must be between -180 and 180.";
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
    const freeRadius = Number(settings.payment.freeDeliveryRadiusKm);
    if (!Number.isFinite(freeRadius) || freeRadius < 0 || freeRadius > 1000) {
      errors["payment.freeDeliveryRadiusKm"] = "Free delivery radius must be between 0 and 1,000 km.";
    }
    const outsideFee = Number(settings.payment.outsideAreaShippingFee);
    if (!Number.isFinite(outsideFee) || outsideFee < 0 || outsideFee > 99999) {
      errors["payment.outsideAreaShippingFee"] = "Outside shipping fee must be between PHP 0 and PHP 99,999.";
    }
    const municipalities = Array.isArray(settings.payment.freeDeliveryMunicipalities)
      ? settings.payment.freeDeliveryMunicipalities
      : [];
    if (municipalities.length > 100) {
      errors["payment.freeDeliveryMunicipalities"] = "Add no more than 100 municipalities.";
    } else if (municipalities.some((municipality) => !String(municipality || "").trim() || String(municipality).trim().length > 120)) {
      errors["payment.freeDeliveryMunicipalities"] = "Municipality names must be 1 to 120 characters.";
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
  const [municipalityDraft, setMunicipalityDraft] = useState("");
  const [deliveryAreaFilter, setDeliveryAreaFilter] = useState("all");
  const [deliveryCustomerSearch, setDeliveryCustomerSearch] = useState("");
  const [deliveryCustomers, setDeliveryCustomers] = useState([]);
  const [deliverySummary, setDeliverySummary] = useState({ nearby: 0, outside: 0 });
  const [deliveryCustomersLoading, setDeliveryCustomersLoading] = useState(true);
  const [deliveryCustomersError, setDeliveryCustomersError] = useState("");
  const [deliveryAreasOpen, setDeliveryAreasOpen] = useState(false);
  const [deliveryCustomerSaving, setDeliveryCustomerSaving] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [shopLocationModalOpen, setShopLocationModalOpen] = useState(false);
  const [shopLocationDraft, setShopLocationDraft] = useState(null);
  const [shopLocationModalSnapshot, setShopLocationModalSnapshot] = useState(null);
  const [shopLocationModalEditingSection, setShopLocationModalEditingSection] = useState(null);
  const [removeQrConfirmOpen, setRemoveQrConfirmOpen] = useState(false);
  const [gcashQrVersion, setGcashQrVersion] = useState(0);
  const [userTheme, setUserTheme] = useState(() => readUserTheme(user));
  const showBlockingLoader = useBlockingLoader(loading);
  const restoreInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const shopLogoPreview = useMemo(() => {
    if (files.shopLogo) return URL.createObjectURL(files.shopLogo);
    const savedUrl = assetUrl(settings.general.shopLogoUrl);
    if (!savedUrl) return "";
    const version = settings.general.shopLogoUpdatedAt || Date.now();
    return `${savedUrl}${savedUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
  }, [files.shopLogo, settings.general.shopLogoUrl, settings.general.shopLogoUpdatedAt]);
  const gcashQrPreview = useMemo(() => {
    if (files.gcashQr) return URL.createObjectURL(files.gcashQr);
    const savedUrl = assetUrl(settings.payment.gcashQrUrl);
    if (!savedUrl || !gcashQrVersion) return savedUrl;
    return `${savedUrl}${savedUrl.includes("?") ? "&" : "?"}v=${gcashQrVersion}`;
  }, [files.gcashQr, gcashQrVersion, settings.payment.gcashQrUrl]);
  const filteredDeliveryCustomers = useMemo(() => {
    const search = deliveryCustomerSearch.trim().toLowerCase();
    return deliveryCustomers.filter((customer) => {
      if (deliveryAreaFilter !== "all" && String(customer.zone || "").toLowerCase() !== deliveryAreaFilter) return false;
      if (!search) return true;
      return [customer.name, customer.municipality, customer.address]
        .some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [deliveryAreaFilter, deliveryCustomerSearch, deliveryCustomers]);

  useEffect(() => {
    let cancelled = false;
    cachedGet("/settings", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        const hydrated = withDefaults(data);
        setSettings(hydrated);
        localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
        window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
        window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      })
      .catch((error) => {
        if (!cancelled) pushToast("error", getApiErrorMessage(error, "Could not load settings."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    cachedGet("/settings/delivery-customers?summaryOnly=true", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        setDeliverySummary({
          nearby: Number(data?.summary?.nearby || 0),
          outside: Number(data?.summary?.outside || 0)
        });
        setDeliveryCustomersError("");
      })
      .catch((error) => {
        if (!cancelled) setDeliveryCustomersError(getApiErrorMessage(error, "Could not load delivery-area customers."));
      })
      .finally(() => {
        if (!cancelled) setDeliveryCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function beginEditing(section) {
    if (editingSection && editingSection !== section) return;
    setEditingSection(section);
    setEditSnapshot({
      settings: cloneSettings(settings),
      files: { ...files },
      userTheme
    });
    setErrors({});
  }

  function cancelEditing() {
    if (!editSnapshot) {
      setEditingSection(null);
      return;
    }
    setSettings(editSnapshot.settings);
    setFiles(editSnapshot.files);
    if (editSnapshot.userTheme && editSnapshot.userTheme !== userTheme) {
      setUserTheme(editSnapshot.userTheme);
      saveUserTheme(user, editSnapshot.userTheme);
      emitUserThemeChange(user, editSnapshot.userTheme);
    }
    setErrors({});
    setEditingSection(null);
    setEditSnapshot(null);
  }

  function isEditingDirty() {
    if (!editingSection || !editSnapshot) return false;
    const filesChanged = files.shopLogo !== editSnapshot.files.shopLogo || files.gcashQr !== editSnapshot.files.gcashQr;
    return filesChanged || JSON.stringify(settings) !== JSON.stringify(editSnapshot.settings);
  }

  function cardControls(section, editable = true) {
    return {
      saving,
      editing: editingSection === section,
      disabled: Boolean(editingSection && editingSection !== section),
      dirty: editingSection === section && isEditingDirty(),
      onEdit: editable ? () => beginEditing(section) : undefined,
      onCancel: editingSection === section ? cancelEditing : undefined
    };
  }

  async function refreshDeliveryCustomers({ showLoading = false, includeCustomers = deliveryAreasOpen } = {}) {
    if (showLoading) setDeliveryCustomersLoading(true);
    try {
      const url = includeCustomers ? "/settings/delivery-customers" : "/settings/delivery-customers?summaryOnly=true";
      clearGetCache(url);
      const { data } = await api.get(url);
      if (includeCustomers) setDeliveryCustomers(Array.isArray(data?.customers) ? data.customers : []);
      setDeliverySummary({
        nearby: Number(data?.summary?.nearby || 0),
        outside: Number(data?.summary?.outside || 0)
      });
      setDeliveryCustomersError("");
    } catch (error) {
      setDeliveryCustomersError(getApiErrorMessage(error, "Could not load delivery-area customers."));
    } finally {
      if (showLoading) setDeliveryCustomersLoading(false);
    }
  }

  function openDeliveryAreas() {
    setDeliveryAreasOpen(true);
    setDeliveryAreaFilter("all");
    setDeliveryCustomerSearch("");
    void refreshDeliveryCustomers({ showLoading: true, includeCustomers: true });
  }

  async function updateDeliveryAreaOverride(customerId, override) {
    setDeliveryCustomerSaving(customerId);
    try {
      const { data } = await api.put(`/settings/delivery-customers/${customerId}`, { override });
      if (data?.customer) {
        setDeliveryCustomers((current) => current.map((customer) => (
          Number(customer.id) === Number(customerId) ? data.customer : customer
        )));
      }
      setDeliverySummary({
        nearby: Number(data?.summary?.nearby || 0),
        outside: Number(data?.summary?.outside || 0)
      });
      clearGetCache("/settings/delivery-customers");
      clearGetCache("/settings/delivery-customers?summaryOnly=true");
      pushToast("success", override ? "Customer delivery area updated." : "Automatic classification restored.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not update the customer's delivery area."));
    } finally {
      setDeliveryCustomerSaving(null);
    }
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

  function updateShopLocationText(key, value) {
    setSettings((current) => ({
      ...current,
      general: {
        ...current.general,
        [key]: value,
        shopPlaceId: "",
        shopLatitude: null,
        shopLongitude: null
      }
    }));
    setErrors((current) => ({ ...current, "general.shopLocation": "" }));
  }

  function updateFile(key, file) {
    if (file) {
      const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
      const label = key === "shopLogo" ? "Shop logo" : "GCash QR";
      if (!allowedTypes.has(file.type)) {
        pushToast("error", `${label} must be a PNG, JPG, JPEG, or WEBP image.`);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        pushToast("error", `${label} must be 5MB or smaller.`);
        return;
      }
    }
    setFiles((current) => ({ ...current, [key]: file }));
  }

  function addFreeDeliveryMunicipality(event) {
    event?.preventDefault();
    const municipality = municipalityDraft.trim().replace(/\s+/g, " ");
    if (!municipality) return;
    if (municipality.length > 120) {
      setErrors((current) => ({ ...current, "payment.freeDeliveryMunicipalities": "Municipality names must be 1 to 120 characters." }));
      return;
    }
    const currentMunicipalities = Array.isArray(settings.payment.freeDeliveryMunicipalities)
      ? settings.payment.freeDeliveryMunicipalities
      : [];
    if (currentMunicipalities.length >= 100) {
      setErrors((current) => ({ ...current, "payment.freeDeliveryMunicipalities": "Add no more than 100 municipalities." }));
      return;
    }
    if (currentMunicipalities.some((entry) => String(entry).trim().toLowerCase() === municipality.toLowerCase())) {
      setErrors((current) => ({ ...current, "payment.freeDeliveryMunicipalities": `${municipality} is already included.` }));
      return;
    }
    updateSetting("payment", "freeDeliveryMunicipalities", [...currentMunicipalities, municipality]);
    setMunicipalityDraft("");
  }

  function removeFreeDeliveryMunicipality(index) {
    const currentMunicipalities = Array.isArray(settings.payment.freeDeliveryMunicipalities)
      ? settings.payment.freeDeliveryMunicipalities
      : [];
    updateSetting("payment", "freeDeliveryMunicipalities", currentMunicipalities.filter((_, itemIndex) => itemIndex !== index));
  }

  function openShopLocationModal() {
    const location = {
      shopAddress: settings.general.shopAddress || "",
      shopMunicipality: settings.general.shopMunicipality || "",
      shopProvince: settings.general.shopProvince || "",
      shopRegion: settings.general.shopRegion || "",
      shopPlaceId: settings.general.shopPlaceId || "",
      shopLatitude: settings.general.shopLatitude ?? null,
      shopLongitude: settings.general.shopLongitude ?? null
    };
    setShopLocationDraft(location);
    setShopLocationModalSnapshot(location);
    setShopLocationModalEditingSection(editingSection);
    setShopLocationModalOpen(true);
  }

  function cancelShopLocationModal() {
    if (shopLocationModalSnapshot) setShopLocationDraft(shopLocationModalSnapshot);
    setShopLocationModalOpen(false);
    setShopLocationModalSnapshot(null);
    setShopLocationModalEditingSection(null);
  }

  async function saveShopLocationModal() {
    if (!shopLocationDraft) return;
    const nextSettings = {
      ...settings,
      general: {
        ...settings.general,
        ...shopLocationDraft
      }
    };
    if (shopLocationModalEditingSection) {
      setSettings(nextSettings);
      setShopLocationModalOpen(false);
      setShopLocationModalSnapshot(null);
      setShopLocationModalEditingSection(null);
      return;
    }
    const saved = await saveSettings("general", nextSettings);
    if (saved) {
      setShopLocationModalOpen(false);
      setShopLocationModalSnapshot(null);
      setShopLocationModalEditingSection(null);
    }
  }

  async function removeGcashQr() {
    setSaving("gcashQrRemove");
    try {
      const { data } = await api.delete("/settings/gcash-qr");
      clearGetCache("/settings");
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      setFiles((current) => ({ ...current, gcashQr: null }));
      setGcashQrVersion(0);
      setRemoveQrConfirmOpen(false);
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      pushToast("success", "GCash QR removed.");
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not remove the GCash QR."));
    } finally {
      setSaving("");
    }
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

  function buildPayload(scope, sourceSettings = settings) {
    const payload = JSON.parse(JSON.stringify(sourceSettings));
    delete payload.databaseStatus;
    if (!payload.ai.openaiApiKey.trim()) payload.ai.openaiApiKey = "";
    payload.payment.freeDeliveryMunicipalities = Array.from(new Map(
      (Array.isArray(payload.payment.freeDeliveryMunicipalities) ? payload.payment.freeDeliveryMunicipalities : [])
        .map((value) => String(value || "").trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .map((value) => [value.toLowerCase(), value])
    ).values());
    payload.payment.freeDeliveryRadiusKm = Number(payload.payment.freeDeliveryRadiusKm || 0);
    payload.payment.outsideAreaShippingFee = Number(payload.payment.outsideAreaShippingFee || 0);
    payload.payment.shippingFeeType = "fixed";
    payload.payment.shippingFeeEnabled = true;
    payload.payment.shippingFee = payload.payment.outsideAreaShippingFee;
    if (Array.isArray(payload.payment?.coupons)) {
      payload.payment.coupons = payload.payment.coupons.filter((coupon) => String(coupon.code || "").trim());
    }
    const formData = new FormData();
    formData.append("settings", JSON.stringify(payload));
    if ((scope === "all" || scope === "general") && files.shopLogo) formData.append("shopLogo", files.shopLogo);
    if ((scope === "all" || scope === "payment") && files.gcashQr) formData.append("gcashQr", files.gcashQr);
    return formData;
  }

  async function saveSettings(scope = "all", settingsOverride = null) {
    const sourceSettings = settingsOverride || settings;
    const nextErrors = validateSettings(sourceSettings, scope);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      pushToast("error", "Please fix the highlighted settings.");
      return false;
    }

    const replacingGcashQr = Boolean(files.gcashQr) && (scope === "all" || scope === "payment");
    setSaving(scope);
    try {
      const { data } = await api.put("/settings", buildPayload(scope, sourceSettings), { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/settings");
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      setFiles((current) => ({
        shopLogo: scope === "all" || scope === "general" ? null : current.shopLogo,
        gcashQr: scope === "all" || scope === "payment" ? null : current.gcashQr
      }));
      if (replacingGcashQr) setGcashQrVersion(Date.now());
      localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
      window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      if (scope === "all" || scope === "general" || scope === "payment") void refreshDeliveryCustomers();
      setEditingSection(null);
      setEditSnapshot(null);
      pushToast("success", scope === "all" ? "All settings saved." : `${sectionTitles[scope] || titleCase(scope)} saved.`);
      return true;
    } catch (error) {
      pushToast("error", getApiErrorMessage(error, "Could not save settings."));
      return false;
    } finally {
      setSaving("");
    }
  }

  async function resetDefaults() {
    setSaving("reset");
    try {
      const { data } = await api.post("/settings/reset");
      clearGetCache("/settings");
      const hydrated = withDefaults(data.settings);
      setSettings(hydrated);
      setFiles({ shopLogo: null, gcashQr: null });
      setErrors({});
      setEditingSection(null);
      setEditSnapshot(null);
      setShopLocationModalOpen(false);
      setShopLocationModalSnapshot(null);
      setShopLocationModalEditingSection(null);
      localStorage.setItem("retela_sidebar_collapsed", String(hydrated.appearance.sidebarCollapse));
      window.dispatchEvent(new CustomEvent("retela:appearance-settings", { detail: { sidebarCollapse: hydrated.appearance.sidebarCollapse } }));
      window.dispatchEvent(new CustomEvent("retela:branding-settings", { detail: hydrated }));
      void refreshDeliveryCustomers();
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
      clearGetCache("/settings");
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

  if (showBlockingLoader) {
    return (
      <div className="settings-loading-grid">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="premium-card settings-card-skeleton skeleton rounded-[24px]" />)}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="settings-page grid gap-5">
        <section className="settings-hero relative overflow-hidden rounded-[24px] p-5 sm:p-6">
          <p className="settings-hero__eyebrow">Admin Control Center</p>
          <h1 className="settings-hero__title mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
          <p className="settings-hero__subtitle mt-2 text-sm font-semibold">Still loading settings...</p>
        </section>
        <div className="settings-loading-grid">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="premium-card settings-card-skeleton skeleton rounded-[24px]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page grid gap-5">
      <section className="settings-hero relative overflow-hidden rounded-[24px] p-5 sm:p-6">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="settings-hero__eyebrow">Admin Control Center</p>
            <h1 className="settings-hero__title mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
            <p className="settings-hero__subtitle mt-2 max-w-3xl text-sm leading-6">Configure RETELA system behavior, AI automation, payments, inventory alerts, reports, security, and database operations.</p>
          </div>
          <div className="settings-hero__actions flex flex-col gap-2 sm:flex-row">
            <ActionButton type="secondary" icon={RotateCcw} loading={saving === "reset"} onClick={resetDefaults}>Reset Defaults</ActionButton>
          </div>
        </div>
      </section>

      <div className="settings-layout">
        <div className="settings-column settings-column--left">
            <SettingsCard section="general" {...cardControls("general")} onSave={saveSettings} view={<GeneralSettingsView value={settings.general} logo={shopLogoPreview} onLocationEdit={openShopLocationModal} />}>
              <div className="grid gap-4 md:grid-cols-2">
                <TextInput label="Shop Name" value={settings.general.shopName} error={errors["general.shopName"]} onChange={(value) => updateSetting("general", "shopName", value)} />
                <FileInput label="Shop Logo Upload" file={files.shopLogo} preview={shopLogoPreview} onChange={(file) => updateFile("shopLogo", file)} />
                <TextArea label="Shop Description" value={settings.general.shopDescription} onChange={(value) => updateSetting("general", "shopDescription", value)} className="md:col-span-2" />
                <TextInput label="Contact Number" value={settings.general.contactNumber} error={errors["general.contactNumber"]} onChange={(value) => updateSetting("general", "contactNumber", value)} />
                <TextInput label="Email Address" type="email" value={settings.general.emailAddress} error={errors["general.emailAddress"]} onChange={(value) => updateSetting("general", "emailAddress", value)} />
                <TextInput label="Shop Address" value={settings.general.shopAddress} onChange={(value) => updateShopLocationText("shopAddress", value)} className="md:col-span-2" />
                <TextInput label="Shop Municipality" value={settings.general.shopMunicipality} onChange={(value) => updateShopLocationText("shopMunicipality", value)} placeholder="Example: Midsayap" />
                <div className="settings-location-edit-row md:col-span-2">
                  <div>
                    <span className="settings-value__label">Exact Shop Location</span>
                    <strong className="settings-value__text">{finiteCoordinate(settings.general.shopLatitude) !== null && finiteCoordinate(settings.general.shopLongitude) !== null ? "Exact pin saved" : "No exact pin saved"}</strong>
                  </div>
                  <button type="button" className="settings-inline-button" onClick={openShopLocationModal}><MapPin size={14} /> Edit Location</button>
                </div>
                <SelectInput label="Currency" value={settings.general.currency} options={["PHP"]} onChange={(value) => updateSetting("general", "currency", value)} />
                <SelectInput label="Language" value={settings.general.language} options={["English", "Filipino"]} onChange={(value) => updateSetting("general", "language", value)} />
              </div>
            </SettingsCard>

            <SettingsCard section="notifications" {...cardControls("notifications")} onSave={saveSettings} view={<NotificationsSettingsView value={settings.notifications} />}>
              <ToggleGrid>
                <ToggleSwitch label="New Order Notifications" checked={settings.notifications.newOrderNotifications} onChange={(value) => updateSetting("notifications", "newOrderNotifications", value)} />
                <ToggleSwitch label="Low Stock Alerts" checked={settings.notifications.lowStockAlerts} onChange={(value) => updateSetting("notifications", "lowStockAlerts", value)} />
                <ToggleSwitch label="Out of Stock Alerts" checked={settings.notifications.outOfStockAlerts} onChange={(value) => updateSetting("notifications", "outOfStockAlerts", value)} />
                <ToggleSwitch label="Refund Alerts" checked={settings.notifications.refundAlerts} onChange={(value) => updateSetting("notifications", "refundAlerts", value)} />
                <ToggleSwitch label="Email Notifications" checked={settings.notifications.emailNotifications} onChange={(value) => updateSetting("notifications", "emailNotifications", value)} />
                <ToggleSwitch label="Push Notifications" checked={settings.notifications.pushNotifications} onChange={(value) => updateSetting("notifications", "pushNotifications", value)} />
                <ToggleSwitch label="Sound Notifications" checked={settings.notifications.soundNotifications} onChange={(value) => updateSetting("notifications", "soundNotifications", value)} />
                <div className="settings-toggle-group md:col-span-2">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-neonbrand/80">Meetup Reminders</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <ToggleSwitch label="24 hours before" checked={settings.notifications.meetup24HourReminder !== false} onChange={(value) => updateSetting("notifications", "meetup24HourReminder", value)} />
                    <ToggleSwitch label="1 hour before" checked={settings.notifications.meetup1HourReminder !== false} onChange={(value) => updateSetting("notifications", "meetup1HourReminder", value)} />
                  </div>
                </div>
              </ToggleGrid>
            </SettingsCard>

            <SettingsCard section="inventory" {...cardControls("inventory")} onSave={saveSettings} view={<InventorySettingsView value={settings.inventory} />}>
              <div className="grid gap-4">
                <NumberInput label="Low Stock Threshold" value={settings.inventory.lowStockThreshold} error={errors["inventory.lowStockThreshold"]} onChange={(value) => updateSetting("inventory", "lowStockThreshold", Number(value))} />
                <ToggleGrid>
                  <ToggleSwitch label="Auto Restock Alert" checked={settings.inventory.autoRestockAlert} onChange={(value) => updateSetting("inventory", "autoRestockAlert", value)} />
                  <ToggleSwitch label="Barcode Toggle" checked={settings.inventory.barcodeEnabled} onChange={(value) => updateSetting("inventory", "barcodeEnabled", value)} />
                  <ToggleSwitch label="SKU Generator Toggle" checked={settings.inventory.skuGeneratorEnabled} onChange={(value) => updateSetting("inventory", "skuGeneratorEnabled", value)} />
                </ToggleGrid>
              </div>
            </SettingsCard>

            <SettingsCard section="appearance" {...cardControls("appearance")} onSave={saveSettings} view={<AppearanceSettingsView value={settings.appearance} theme={userTheme} />}>
              <div className="grid gap-4 md:grid-cols-2">
                <ThemeModeSwitch theme={userTheme} onChange={updateUserTheme} />
                <ToggleSwitch label="Sidebar Collapse Toggle" checked={settings.appearance.sidebarCollapse} onChange={(value) => updateSetting("appearance", "sidebarCollapse", value)} />
                <ColorInput label="Theme Color" value={settings.appearance.themeColor} error={errors["appearance.themeColor"]} onChange={(value) => updateSetting("appearance", "themeColor", value)} />
                <SelectInput label="Dashboard Layout" value={settings.appearance.dashboardLayout} options={["Comfortable", "Compact", "Analytics Focus"]} onChange={(value) => updateSetting("appearance", "dashboardLayout", value)} />
              </div>
            </SettingsCard>
        </div>

        <div className="settings-column settings-column--right">
            <SettingsCard section="ai" {...cardControls("ai")} onSave={saveSettings} view={<AISettingsView value={settings.ai} />}>
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

            <SettingsCard section="security" {...cardControls("security")} onSave={saveSettings} view={<SecuritySettingsView value={settings.security} onEdit={() => beginEditing("security")} />}>
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

            <SettingsCard section="reports" {...cardControls("reports")} onSave={saveSettings} view={<ReportsSettingsView value={settings.reports} />}>
              <ToggleGrid>
                <ToggleSwitch label="Auto Generate Reports" checked={settings.reports.autoGenerateReports} onChange={(value) => updateSetting("reports", "autoGenerateReports", value)} />
                <ToggleSwitch label="Daily Reports" checked={settings.reports.dailyReports} onChange={(value) => updateSetting("reports", "dailyReports", value)} />
                <ToggleSwitch label="Weekly Reports" checked={settings.reports.weeklyReports} onChange={(value) => updateSetting("reports", "weeklyReports", value)} />
                <ToggleSwitch label="Monthly Reports" checked={settings.reports.monthlyReports} onChange={(value) => updateSetting("reports", "monthlyReports", value)} />
                <ToggleSwitch label="Export PDF" checked={settings.reports.exportPdf} onChange={(value) => updateSetting("reports", "exportPdf", value)} />
                <ToggleSwitch label="Export Excel" checked={settings.reports.exportExcel} onChange={(value) => updateSetting("reports", "exportExcel", value)} />
              </ToggleGrid>
            </SettingsCard>

            <SettingsCard section="customers" {...cardControls("customers")} onSave={saveSettings} view={<CustomerSettingsView value={settings.customers} />}>
              <ToggleGrid>
                <ToggleSwitch label="Auto Welcome Message" checked={settings.customers.autoWelcomeMessage} onChange={(value) => updateSetting("customers", "autoWelcomeMessage", value)} />
                <ToggleSwitch label="Loyalty Rewards Toggle" checked={settings.customers.loyaltyRewards} onChange={(value) => updateSetting("customers", "loyaltyRewards", value)} />
                <ToggleSwitch label="Customer Broadcast Notifications" checked={settings.customers.customerBroadcastNotifications} onChange={(value) => updateSetting("customers", "customerBroadcastNotifications", value)} />
              </ToggleGrid>
            </SettingsCard>
        </div>

        <div className="settings-layout__full">
          <SettingsCard section="payment" {...cardControls("payment")} onSave={saveSettings} className="settings-card--wide" view={<PaymentSettingsView value={settings} qrPreview={gcashQrPreview} summary={deliverySummary} loading={deliveryCustomersLoading} error={deliveryCustomersError} onManage={openDeliveryAreas} onRetry={() => refreshDeliveryCustomers({ showLoading: true, includeCustomers: false })} />}>
          <div className="grid gap-6">
            <section className="grid gap-4">
              <SettingsSectionHeading eyebrow="GCash" title="GCash Payment Details" />
              <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
                <TextInput label="GCash Number" value={settings.payment.gcashNumber} error={errors["payment.gcashNumber"]} onChange={(value) => updateSetting("payment", "gcashNumber", value)} />
                <GcashQrInput
                  file={files.gcashQr}
                  preview={gcashQrPreview}
                  hasPersistedQr={Boolean(settings.payment.gcashQrUrl)}
                  onChange={(file) => updateFile("gcashQr", file)}
                  onRemove={() => setRemoveQrConfirmOpen(true)}
                />
              </div>
            </section>

            <section className="grid gap-4 border-t border-white/10 pt-6">
              <SettingsSectionHeading eyebrow="Delivery & Shipping" title="Location-based Delivery" />
              <ShopLocationSummary value={settings.general} onEdit={openShopLocationModal} />
              <MunicipalityEditor
                values={settings.payment.freeDeliveryMunicipalities || []}
                draft={municipalityDraft}
                error={errors["payment.freeDeliveryMunicipalities"]}
                onDraftChange={(value) => {
                  setMunicipalityDraft(value);
                  setErrors((current) => ({ ...current, "payment.freeDeliveryMunicipalities": "" }));
                }}
                onAdd={addFreeDeliveryMunicipality}
                onRemove={removeFreeDeliveryMunicipality}
              />
              <div className="grid gap-4 md:grid-cols-3">
                <ReadOnlySetting label="Nearby Shipping Fee" value="PHP 0.00" detail="Free delivery area" />
                <NumberInput
                  label="Free Delivery Radius"
                  suffix="km"
                  value={settings.payment.freeDeliveryRadiusKm ?? 15}
                  error={errors["payment.freeDeliveryRadiusKm"]}
                  onChange={(value) => updateSetting("payment", "freeDeliveryRadiusKm", Number(value))}
                />
                <NumberInput
                  label="Outside Area Shipping Fee"
                  prefix="PHP"
                  value={settings.payment.outsideAreaShippingFee ?? 89}
                  error={errors["payment.outsideAreaShippingFee"]}
                  onChange={(value) => updateSetting("payment", "outsideAreaShippingFee", Number(value))}
                />
              </div>
            </section>

            <section className="grid gap-4 border-t border-white/10 pt-6">
              <SettingsSectionHeading eyebrow="Payment Options" title="Available Checkout Methods" />
              <div className="settings-toggle-grid md:grid-cols-3">
                <ToggleSwitch label="COD" description="Cash on Delivery" checked={settings.payment.codEnabled} onChange={(value) => updateSetting("payment", "codEnabled", value)} />
                <ToggleSwitch label="Online Payment" description="PayMongo / GCash" checked={settings.payment.onlinePaymentEnabled} onChange={(value) => updateSetting("payment", "onlinePaymentEnabled", value)} />
                <ToggleSwitch label="Payment Verification" description="Automatic verification" checked={settings.payment.paymentVerificationAutomation} onChange={(value) => updateSetting("payment", "paymentVerificationAutomation", value)} />
              </div>
              {errors["payment.methods"] ? <ErrorText>{errors["payment.methods"]}</ErrorText> : null}
            </section>

            <DeliveryAreaSummary
              summary={deliverySummary}
              loading={deliveryCustomersLoading}
              error={deliveryCustomersError}
              onManage={openDeliveryAreas}
              onRetry={() => refreshDeliveryCustomers({ showLoading: true, includeCustomers: false })}
            />

            <section className="border-t border-white/10 pt-6">
              <CouponManager coupons={settings.payment.coupons || []} onAdd={addCoupon} onRemove={removeCoupon} onChange={updateCoupon} />
            </section>
          </div>
        </SettingsCard>

        <SettingsCard section="about" {...cardControls("about")} onSave={saveSettings} className="settings-card--wide" view={<AboutSettingsView value={settings.about} />}>
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
            <TextArea label="Delivery & Meetup Safety" value={settings.about.deliverySafetyPolicy} onChange={(value) => updateSetting("about", "deliverySafetyPolicy", value)} />
            <TextArea label="Refund Process" value={settings.about.refundProcess} onChange={(value) => updateSetting("about", "refundProcess", value)} />
            <TextInput label="Owner/Admin Profile" value={settings.about.ownerProfile} onChange={(value) => updateSetting("about", "ownerProfile", value)} />
            <TextInput label="Developers" value={settings.about.developers} onChange={(value) => updateSetting("about", "developers", value)} />
            <TextInput label="Thesis Members" value={settings.about.thesisMembers} onChange={(value) => updateSetting("about", "thesisMembers", value)} className="md:col-span-2" />
          </div>
        </SettingsCard>

        <SettingsCard section="dataManagement" saving={saving} onSave={null} className="settings-card--wide">
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
              icon={Users}
              title="Suspended Customers"
              description="View and manage customer accounts that have been suspended from accessing RETELA."
              onClick={() => onChange?.("Suspended Customers")}
            />
          </div>
        </SettingsCard>

        <SettingsCard section="backup" saving={saving} onSave={null} className="settings-card--wide">
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
      </div>

      <AnimatePresence>
        {toast ? <Toast key={toast.message} type={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null}
        {removeQrConfirmOpen ? (
          <RemoveQrModal
            saving={saving === "gcashQrRemove"}
            onConfirm={removeGcashQr}
            onClose={() => setRemoveQrConfirmOpen(false)}
          />
        ) : null}
        {deliveryAreasOpen ? (
          <CustomerDeliveryAreasModal
            customers={filteredDeliveryCustomers}
            filter={deliveryAreaFilter}
            search={deliveryCustomerSearch}
            loading={deliveryCustomersLoading}
            error={deliveryCustomersError}
            savingCustomerId={deliveryCustomerSaving}
            onFilterChange={setDeliveryAreaFilter}
            onSearchChange={setDeliveryCustomerSearch}
            onClassify={updateDeliveryAreaOverride}
            onRetry={() => refreshDeliveryCustomers({ showLoading: true, includeCustomers: true })}
            onClose={() => setDeliveryAreasOpen(false)}
          />
        ) : null}
        {shopLocationModalOpen && shopLocationDraft ? (
          <ShopLocationModal
            value={shopLocationDraft}
            onChange={setShopLocationDraft}
            saving={saving === "general"}
            onSave={saveShopLocationModal}
            onClose={cancelShopLocationModal}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SettingsCard({ section, saving, editing = false, disabled = false, dirty = false, onEdit, onCancel, onSave, view, children, className = "" }) {
  const Icon = sectionIcons[section];
  return (
    <motion.section
      className={`settings-card settings-card--${section} premium-card min-w-0 p-4 sm:p-5 ${className}`}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: "easeOut" }}
    >
      <div className="settings-card__header mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="settings-card__heading flex min-w-0 flex-1 gap-3">
          <span className="settings-card__icon grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="settings-card__title font-display text-xl font-bold">{sectionTitles[section] || titleCase(section)}</h2>
            <p className="settings-card__description mt-1 text-sm leading-5">{sectionDescriptions[section]}</p>
          </div>
        </div>
        {onSave ? (
          <div className="settings-card__actions flex flex-wrap items-center gap-2 sm:justify-end">
            {editing ? (
              <>
                <span className="settings-editing-badge">Editing</span>
                {dirty ? <span className="settings-unsaved">Unsaved Changes</span> : null}
                <ActionButton type="secondary" size="sm" onClick={onCancel}>Cancel</ActionButton>
                <ActionButton size="sm" icon={Save} loading={saving === section} onClick={() => onSave(section)}>Save Changes</ActionButton>
              </>
            ) : (
              <button type="button" className="settings-edit-button" onClick={onEdit} disabled={disabled}>
                <Pencil size={15} /> Edit
              </button>
            )}
          </div>
        ) : null}
      </div>
      {editing || !view ? children : view}
    </motion.section>
  );
}

function SettingsValueGrid({ children, className = "" }) {
  return <div className={`settings-value-grid ${className}`}>{children}</div>;
}

function SettingsValue({ label, value, children, wide = false }) {
  const display = value === null || value === undefined || value === "" ? "Not set" : value;
  return (
    <div className={`settings-value ${wide ? "settings-value--wide" : ""}`}>
      <span className="settings-value__label">{label}</span>
      {children || <strong className="settings-value__text">{display}</strong>}
    </div>
  );
}

function SettingStatus({ enabled, label }) {
  const active = Boolean(enabled);
  return <span className={`settings-status ${active ? "settings-status--on" : "settings-status--off"}`}>{label || (active ? "Enabled" : "Disabled")}</span>;
}

function SettingsValueStatus({ label, enabled }) {
  return <SettingsValue label={label}><SettingStatus enabled={enabled} /></SettingsValue>;
}

function SettingsLogoPreview({ src }) {
  return (
    <div className="settings-logo-preview">
      {src ? <LogoImage src={src} className="settings-logo-preview__empty" alt="Saved RETELA shop logo" /> : <span className="settings-logo-preview__empty"><Store size={22} /></span>}
      <div>
        <span className="settings-value__label">Shop Logo</span>
        <strong className="settings-value__text">{src ? "Logo configured" : "No logo configured"}</strong>
      </div>
    </div>
  );
}

function GeneralSettingsView({ value, logo, onLocationEdit }) {
  const address = [value.shopAddress, value.shopMunicipality, value.shopProvince].filter(Boolean).join(", ") || "Not set";
  const hasPin = finiteCoordinate(value.shopLatitude) !== null && finiteCoordinate(value.shopLongitude) !== null;
  return (
    <div className="settings-view-content">
      <SettingsValueGrid>
        <SettingsValue label="Shop Name" value={value.shopName} />
        <SettingsValue label="Contact Number" value={value.contactNumber} />
        <SettingsValue label="Email Address" value={value.emailAddress} />
        <SettingsValue label="Shop Municipality" value={value.shopMunicipality} />
        <SettingsValue label="Currency" value={value.currency} />
        <SettingsValue label="Language" value={value.language} />
        <SettingsValue label="Shop Address" value={address} wide />
        <SettingsValue label="Shop Description" value={value.shopDescription} wide />
      </SettingsValueGrid>
      <div className="settings-view-subgrid">
        <SettingsLogoPreview src={logo} />
        <div className="settings-location-preview">
          <div className="settings-location-preview__copy">
            <MapPin size={18} />
            <div>
              <span className="settings-value__label">Exact Shop Location</span>
              <strong className="settings-value__text">{hasPin ? "Exact pin saved" : "No exact pin saved"}</strong>
              <span className="settings-location-preview__address">{address}</span>
            </div>
          </div>
          <button type="button" className="settings-inline-button" onClick={onLocationEdit}><MapPin size={14} /> Edit Location</button>
        </div>
      </div>
    </div>
  );
}

function AISettingsView({ value }) {
  return (
    <SettingsValueGrid>
      <SettingsValue label="Provider" value={titleCase(value.aiProvider || "auto")} />
      <SettingsValue label="Last Provider Used" value={value.lastProviderUsed || "None"} />
      <SettingsValue label="API Status"><SettingStatus enabled={String(value.apiStatus || "").toLowerCase() === "ready"} label={value.apiStatus || "Unknown"} /></SettingsValue>
      <SettingsValueStatus label="AI Assistant" enabled={value.aiAssistant} />
      <SettingsValueStatus label="AI Auto Reply" enabled={value.aiAutoReply} />
      <SettingsValueStatus label="AI Recommendation" enabled={value.aiRecommendation} />
      <SettingsValue label="Temperature" value={Number(value.aiChatTemperature ?? 0).toFixed(2)} />
    </SettingsValueGrid>
  );
}

function NotificationsSettingsView({ value }) {
  const groups = [
    ["Order Alerts", [["New Order Notifications", value.newOrderNotifications]]],
    ["Inventory Alerts", [["Low Stock Alerts", value.lowStockAlerts], ["Out of Stock Alerts", value.outOfStockAlerts]]],
    ["Communication", [["Refund Alerts", value.refundAlerts], ["Email Notifications", value.emailNotifications], ["Push Notifications", value.pushNotifications], ["Sound Notifications", value.soundNotifications]]],
    ["Meetup Reminders", [["24 Hours Before", value.meetup24HourReminder !== false], ["1 Hour Before", value.meetup1HourReminder !== false]]]
  ];
  return <div className="settings-view-groups">{groups.map(([title, rows]) => <div key={title} className="settings-view-group"><span className="settings-view-group__title">{title}</span><SettingsValueGrid>{rows.map(([label, enabled]) => <SettingsValueStatus key={label} label={label} enabled={enabled} />)}</SettingsValueGrid></div>)}</div>;
}

function PaymentSettingsView({ value, qrPreview, summary, loading, error, onManage, onRetry }) {
  const payment = value.payment;
  const general = value.general;
  const address = [general.shopAddress, general.shopMunicipality, general.shopProvince].filter(Boolean).join(", ") || "Not set";
  return (
    <div className="settings-view-content">
      <div className="settings-view-payment-top">
        <SettingsValueGrid>
          <SettingsValue label="GCash Number" value={payment.gcashNumber} />
          <SettingsValue label="GCash Status"><SettingStatus enabled={Boolean(payment.gcashQrUrl)} label={payment.gcashQrUrl ? "Saved" : "Not configured"} /></SettingsValue>
          <SettingsValue label="Shop Location" value={address} wide />
        </SettingsValueGrid>
        <div className="settings-qr-preview">{qrPreview ? <img src={qrPreview} alt="Saved GCash QR code" /> : <span><Upload size={20} /> QR not configured</span>}</div>
      </div>
      <div className="settings-view-group"><span className="settings-view-group__title">Delivery & Shipping</span><SettingsValueGrid>
        <SettingsValue label="Nearby Shipping Fee" value="FREE" />
        <SettingsValue label="Free Delivery Radius" value={`${Number(payment.freeDeliveryRadiusKm ?? 0)} km`} />
        <SettingsValue label="Outside Area Shipping" value={formatAdminPhp(payment.outsideAreaShippingFee)} />
        <SettingsValue label="Free / Nearby Municipalities" wide><div className="settings-chip-list">{(payment.freeDeliveryMunicipalities || []).map((item) => <span key={item} className="settings-chip">{item}</span>)}</div></SettingsValue>
      </SettingsValueGrid></div>
      <div className="settings-view-group"><span className="settings-view-group__title">Payment Options</span><SettingsValueGrid><SettingsValueStatus label="COD" enabled={payment.codEnabled} /><SettingsValueStatus label="Online Payment" enabled={payment.onlinePaymentEnabled} /><SettingsValueStatus label="Payment Verification" enabled={payment.paymentVerificationAutomation} /></SettingsValueGrid></div>
      <DeliveryAreaSummary summary={summary} loading={loading} error={error} onManage={onManage} onRetry={onRetry} />
      <div className="settings-view-group"><span className="settings-view-group__title">Coupons</span><SettingsValue label="Configured Coupons" value={`${(payment.coupons || []).length}`} /></div>
    </div>
  );
}

function SecuritySettingsView({ value, onEdit }) {
  return <div className="settings-view-content"><SettingsValueGrid><SettingsValueStatus label="Two-Factor Authentication" enabled={value.twoFactorAuthentication} /><SettingsValueStatus label="Admin Access Control" enabled={value.adminAccessControl} /><SettingsValueStatus label="Login Activity" enabled={value.loginActivity} /><SettingsValue label="Session Timeout" value={`${value.sessionTimeout} minutes`} /></SettingsValueGrid><div className="settings-password-preview"><div><span className="settings-value__label">Password</span><strong className="settings-value__text">Protected</strong></div><button type="button" className="settings-inline-button" onClick={onEdit}><LockKeyhole size={14} /> Change Password</button></div></div>;
}

function InventorySettingsView({ value }) {
  return <SettingsValueGrid><SettingsValue label="Low Stock Threshold" value={value.lowStockThreshold} /><SettingsValueStatus label="Auto Restock Alert" enabled={value.autoRestockAlert} /><SettingsValueStatus label="Barcode" enabled={value.barcodeEnabled} /><SettingsValueStatus label="SKU Generator" enabled={value.skuGeneratorEnabled} /></SettingsValueGrid>;
}

function ReportsSettingsView({ value }) {
  return <div className="settings-view-content"><SettingsValueGrid><SettingsValueStatus label="Auto Generate Reports" enabled={value.autoGenerateReports} /><SettingsValueStatus label="Daily Reports" enabled={value.dailyReports} /><SettingsValueStatus label="Weekly Reports" enabled={value.weeklyReports} /><SettingsValueStatus label="Monthly Reports" enabled={value.monthlyReports} /><SettingsValueStatus label="PDF Export" enabled={value.exportPdf} /><SettingsValueStatus label="Excel Export" enabled={value.exportExcel} /></SettingsValueGrid></div>;
}

function AppearanceSettingsView({ value, theme }) {
  return <SettingsValueGrid><SettingsValue label="Theme" value={titleCase(theme || (value.darkMode ? "dark" : "light"))} /><SettingsValue label="Sidebar" value={value.sidebarCollapse ? "Collapsed" : "Expanded"} /><SettingsValue label="Dashboard Layout" value={value.dashboardLayout} /><SettingsValue label="Theme Color"><span className="settings-color-value"><i style={{ backgroundColor: value.themeColor }} /> {value.themeColor}</span></SettingsValue></SettingsValueGrid>;
}

function CustomerSettingsView({ value }) {
  return <SettingsValueGrid><SettingsValueStatus label="Auto Welcome Message" enabled={value.autoWelcomeMessage} /><SettingsValueStatus label="Loyalty Rewards" enabled={value.loyaltyRewards} /><SettingsValueStatus label="Customer Broadcast Notifications" enabled={value.customerBroadcastNotifications} /></SettingsValueGrid>;
}

const aboutViewGroups = [
  ["story", "Shop Story", [["Mission", "mission"], ["Vision", "vision"]]],
  ["store", "Store Information", [["Full Address", "fullAddress"], ["Store Landmark", "landmark"], ["Business Days", "businessDays"], ["Opening Time", "openingTime"], ["Closing Time", "closingTime"]]],
  ["social", "Social Media", [["Facebook", "facebookPage"], ["Instagram", "instagramLink"], ["Messenger", "messengerLink"]]],
  ["customer", "Customer Information", [["Payment Methods", "paymentMethods"], ["Delivery Areas", "deliveryAreas"], ["Estimated Delivery Time", "estimatedDeliveryTime"], ["Support Channels", "supportChannels"]]],
  ["policies", "Policies", [["Return Conditions", "returnConditions"], ["Refund Process", "refundProcess"], ["Delivery & Meetup Safety", "deliverySafetyPolicy"]]],
  ["people", "People", [["Owner/Admin Profile", "ownerProfile"], ["Developers", "developers"], ["Thesis Members", "thesisMembers"]]]
];

function AboutSettingsView({ value }) {
  const [openGroups, setOpenGroups] = useState({ story: true });
  function toggleGroup(key) {
    setOpenGroups((current) => ({ ...current, [key]: !current[key] }));
  }
  return <div className="settings-about-groups">{aboutViewGroups.map(([key, title, fields]) => <div key={key} className="settings-about-group"><button type="button" className="settings-about-group__trigger" onClick={() => toggleGroup(key)} aria-expanded={Boolean(openGroups[key])}><span>{title}</span><ChevronDown size={18} className={openGroups[key] ? "is-open" : ""} /></button>{openGroups[key] ? <div className="settings-about-group__body"><SettingsValueGrid>{fields.map(([label, field]) => <SettingsValue key={field} label={label} value={value[field]} wide={String(value[field] || "").length > 100} />)}</SettingsValueGrid></div> : null}</div>)}</div>;
}

function formatAdminPhp(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function RemoveQrModal({ saving, onConfirm, onClose }) {
  return (
    <motion.div
      className="retela-modal-backdrop z-[175] bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={saving ? undefined : onClose}
    >
      <motion.div
        className="retela-modal-card retela-modal-dark modal-sm"
        initial={{ opacity: 0, scale: 0.94, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 18 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="retela-modal-body flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-rose-300/25 bg-rose-300/10 text-rose-200">
            <Trash2 size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-200/75">GCash payment</p>
            <h3 className="mt-2 font-display text-2xl font-bold">Remove GCash QR?</h3>
            <p className="mt-2 text-sm leading-6 text-white/58">The saved QR will be removed from Payment Settings. This does not change PayMongo, QRPh, or other payment options.</p>
          </div>
        </div>
        <div className="retela-modal-footer">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:border-neonbrand/45 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={onConfirm} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-400/15 px-4 py-3 text-sm font-bold text-rose-100 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
            {saving ? "Removing..." : "Remove QR"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ToggleGrid({ children }) {
  return <div className="settings-toggle-grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">{children}</div>;
}

function SettingsSectionHeading({ eyebrow, title }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/75">{eyebrow}</p>
      <h3 className="mt-1 text-lg font-bold text-white">{title}</h3>
    </div>
  );
}

function GcashQrInput({ file, preview, hasPersistedQr, onChange, onRemove }) {
  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">GCash QR</span>
      <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-neonbrand/20 bg-neonbrand/5 p-4 sm:flex-row sm:items-center">
        {preview ? (
          <img src={preview} className="h-28 w-28 shrink-0 rounded-2xl border border-white/10 bg-white object-contain p-2" alt="Saved GCash QR code" />
        ) : (
          <span className="grid h-28 w-28 shrink-0 place-items-center rounded-2xl border border-dashed border-white/15 bg-black/20 text-white/35">
            <Upload size={24} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <strong className="block break-words text-sm text-white">
            {file ? file.name : hasPersistedQr ? "Saved GCash QR" : "No GCash QR uploaded"}
          </strong>
          <span className="mt-1 block text-xs leading-5 text-white/45">
            {file ? "New QR ready to save." : hasPersistedQr ? "Loaded from saved Payment Settings." : "PNG, JPG, or WEBP up to 5MB."}
          </span>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-neonbrand/30 bg-neonbrand/10 px-3 py-2 text-xs font-bold text-neonbrand transition hover:bg-neonbrand/15">
              <Upload size={15} />
              {preview ? "Replace QR" : "Upload QR"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => onChange(event.target.files?.[0] || null)} />
            </label>
            {hasPersistedQr ? (
              <button type="button" onClick={onRemove} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-300/20">
                <Trash2 size={15} /> Remove QR
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShopLocationSummary({ value, onEdit }) {
  const latitude = finiteCoordinate(value.shopLatitude);
  const longitude = finiteCoordinate(value.shopLongitude);
  const hasExactPin = latitude !== null && longitude !== null;
  const area = [value.shopMunicipality, value.shopProvince, value.shopRegion].map((item) => String(item || "").trim()).filter(Boolean).join(", ");
  const address = String(value.shopAddress || area || "No shop location set").trim();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-4 sm:flex-row sm:items-center">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-neonbrand/25 bg-black/20 text-neonbrand">
        <MapPin size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/70">Shop Location</span>
        <strong className="mt-1 block break-words text-sm text-white">{address}</strong>
        <span className="mt-1 block text-xs text-white/48">{hasExactPin ? "Exact map pin saved" : "Set an exact map pin for distance calculations"}</span>
      </div>
      <button type="button" onClick={onEdit} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-bold text-white transition hover:border-neonbrand/40 hover:text-neonbrand">
        <MapPin size={15} /> {hasExactPin ? "Edit Shop Location" : "Set Shop Location"}
      </button>
    </div>
  );
}

function MunicipalityEditor({ values, draft, error, onDraftChange, onAdd, onRemove }) {
  const municipalities = Array.isArray(values) ? values : [];
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div>
        <span className="block text-xs font-bold uppercase tracking-[0.16em] text-white/45">Free / Nearby Delivery Area</span>
        <p className="mt-1 text-sm text-white/55">Customers in these municipalities qualify for free delivery.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {municipalities.length ? municipalities.map((municipality, index) => (
          <span key={`${municipality}-${index}`} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-neonbrand/25 bg-neonbrand/10 px-3 py-1.5 text-sm font-bold text-neonbrand">
            {municipality}
            <button type="button" onClick={() => onRemove(index)} className="rounded-lg p-0.5 text-neonbrand/70 transition hover:bg-neonbrand/15 hover:text-neonbrand" aria-label={`Remove ${municipality}`}>
              <X size={14} />
            </button>
          </span>
        )) : <span className="text-sm text-white/45">No municipalities added. The radius rule will still apply.</span>}
      </div>
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={onAdd}>
        <input className={controlClasses(error)} value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Add municipality" maxLength={120} />
        <button type="submit" className="gradient-btn inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold">
          <Plus size={16} /> Add municipality
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

function ReadOnlySetting({ label, value, detail }) {
  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">{label}</span>
      <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-neonbrand/20 bg-neonbrand/10 px-4 py-3">
        <strong className="text-sm text-neonbrand">{value}</strong>
        <span className="text-xs font-semibold text-white/45">{detail}</span>
      </div>
    </div>
  );
}

function DeliveryAreaSummary({ summary, loading, error, onManage, onRetry }) {
  return (
    <section className="grid gap-4 border-t border-white/10 pt-6">
      <div>
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/70">Delivery Area Summary</span>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
          <SummaryCount label="Nearby / Free" value={loading ? "—" : summary.nearby} />
          <SummaryCount label="Outside" value={loading ? "—" : summary.outside} />
        </div>
      </div>
      {error ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-rose-100">{error}</p>
          <button type="button" onClick={onRetry} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200/25 px-3 py-2 text-xs font-bold text-rose-100">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : null}
      <button type="button" onClick={onManage} className="gradient-btn inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold sm:w-fit">
        <Users size={17} /> Manage Customer Delivery Areas
      </button>
    </section>
  );
}

function SummaryCount({ label, value }) {
  const displayValue = typeof value === "number" ? Number(value || 0) : value;
  return (
    <div className="min-h-16 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-white/55">
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em]">{label}</span>
      <strong className="mt-1 block text-lg text-white">{displayValue}</strong>
    </div>
  );
}

function ShopLocationModal({ value, onChange, saving, onSave, onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    document.body.classList.add("retela-modal-open");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) closeRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("retela-modal-open");
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [saving]);

  return (
    <motion.div
      className="settings-location-modal-backdrop fixed inset-0 z-[190] flex items-end justify-center p-3 backdrop-blur-sm sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={saving ? undefined : onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-location-modal-title"
        className="settings-location-modal flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-[24px] sm:max-h-[90vh]"
        initial={{ opacity: 0, y: 28, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 28, scale: 0.98 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-location-modal__header flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <span className="settings-location-modal__eyebrow">Shop location</span>
            <h2 id="shop-location-modal-title" className="settings-location-modal__title mt-1 font-display text-xl font-bold sm:text-2xl">Edit Shop Location</h2>
            <p className="settings-location-modal__subtitle mt-1 text-xs leading-5 sm:text-sm">Search for the shop, adjust the exact pin, and save the coordinates used for delivery routes.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close shop location editor" className="settings-location-modal__close grid h-11 w-11 shrink-0 place-items-center rounded-xl transition disabled:opacity-50">
            <X size={18} />
          </button>
        </header>
        <div className="settings-location-modal__body min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <ShopLocationSetting value={value} onChange={onChange} />
        </div>
        <footer className="settings-location-modal__footer flex flex-wrap justify-end gap-2 px-4 py-4 sm:px-6">
          <button type="button" disabled={saving} onClick={onClose} className="settings-location-modal__cancel">Cancel</button>
          <button type="button" disabled={saving} onClick={onSave} className="settings-location-modal__save">
            {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
            {saving ? "Saving..." : "Save Location"}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}

function CustomerDeliveryAreasModal({ customers, filter, search, loading, error, savingCustomerId, onFilterChange, onSearchChange, onClassify, onRetry, onClose }) {
  const searchInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const savingCustomerRef = useRef(savingCustomerId);
  onCloseRef.current = onClose;
  savingCustomerRef.current = savingCustomerId;
  useEffect(() => {
    document.body.classList.add("retela-modal-open");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !savingCustomerRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => searchInputRef.current?.focus(), 80);
    return () => {
      document.body.classList.remove("retela-modal-open");
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const filters = [
    ["all", "All"],
    ["nearby", "Nearby / Free"],
    ["outside", "Outside"]
  ];
  return (
    <motion.div
      className="delivery-areas-modal-backdrop fixed inset-0 z-[180] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={savingCustomerId ? undefined : onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-areas-title"
        className="delivery-areas-modal flex max-h-[calc(100dvh-24px)] w-full min-w-0 flex-col overflow-hidden rounded-[24px] sm:max-h-[85vh]"
        initial={{ opacity: 0, y: 32, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 32, scale: 0.98 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="delivery-areas-modal__header flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <span className="delivery-areas-modal__eyebrow">Delivery settings</span>
            <h2 id="delivery-areas-title" className="delivery-areas-modal__title mt-1 font-display text-xl font-bold sm:text-2xl">Customer Delivery Areas</h2>
            <p className="delivery-areas-modal__subtitle mt-1 text-xs leading-5 sm:text-sm">Location is a suggestion. An admin selection is the shipping rule.</p>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(savingCustomerId)} aria-label="Close customer delivery areas" className="delivery-areas-modal__close grid h-11 w-11 shrink-0 place-items-center rounded-xl transition disabled:opacity-50">
            <X size={18} />
          </button>
        </header>

        <div className="delivery-areas-modal__controls grid shrink-0 gap-3 px-4 py-4 sm:px-6">
          <label className="delivery-areas-modal__search flex min-h-12 items-center gap-2 rounded-2xl px-4">
            <Search size={16} className="delivery-areas-modal__search-icon shrink-0" />
            <input ref={searchInputRef} className="delivery-areas-modal__search-input min-w-0 flex-1 bg-transparent text-sm outline-none" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search customer, municipality, city, or address" />
          </label>
          <div className="delivery-areas-modal__filters grid grid-cols-3 gap-2" aria-label="Filter customer delivery areas">
            {filters.map(([value, label]) => (
              <button key={value} type="button" onClick={() => onFilterChange(value)} aria-pressed={filter === value} className={`delivery-areas-filter min-h-10 rounded-xl px-2 py-2 text-xs font-bold sm:text-sm ${filter === value ? "delivery-areas-filter--selected" : ""}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="delivery-areas-modal__scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {loading ? (
            <div className="grid gap-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton min-h-44 rounded-2xl" />)}</div>
          ) : error ? (
            <div className="delivery-areas-modal__error grid justify-items-center gap-3 rounded-2xl p-5 text-center">
              <p className="text-sm font-semibold">{error}</p>
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"><RefreshCw size={14} /> Retry</button>
            </div>
          ) : customers.length ? (
            <div className="grid gap-3">
              {customers.map((customer) => (
                <CustomerDeliveryAreaRow key={customer.id} customer={customer} saving={Number(savingCustomerId) === Number(customer.id)} disabled={Boolean(savingCustomerId)} onClassify={onClassify} />
              ))}
            </div>
          ) : (
            <p className="delivery-areas-modal__empty rounded-2xl p-6 text-center text-sm">No customers match this search and filter.</p>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

function CustomerDeliveryAreaRow({ customer, saving, disabled, onClassify }) {
  const override = String(customer.deliveryAreaOverride || "").toLowerCase();
  const suggestedZone = String(customer.suggestedZone || "outside").toLowerCase();
  const distance = Number(customer.distanceKm);
  const hasDistance = customer.distanceKm !== null && customer.distanceKm !== undefined && customer.distanceKm !== "" && Number.isFinite(distance);
  const options = [
    ["nearby", "Nearby / Free"],
    ["outside", "Outside"]
  ];
  return (
    <article className="delivery-customer-card grid min-w-0 gap-3 rounded-2xl p-4 sm:p-5">
      <div className="min-w-0">
        <strong className="delivery-customer-card__name block break-words text-sm sm:text-base">{customer.name || "Customer"}</strong>
        <p className="delivery-customer-card__address mt-1 break-words text-xs leading-5">{customer.address || "Delivery address not provided"}</p>
        <div className="delivery-customer-card__meta mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold">
          {customer.municipality ? <span>Municipality: {customer.municipality}</span> : null}
          {hasDistance ? <span>Approx. distance: {distance.toFixed(1)} km</span> : null}
        </div>
      </div>
      <div className="delivery-customer-card__info flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs">
        <span className="delivery-customer-card__info-item"><span>Suggested by location</span><strong>{suggestedZone === "nearby" ? "Nearby" : "Outside"}</strong></span>
        <span className={`delivery-customer-card__info-item ${override ? "delivery-customer-card__info-item--manual" : ""}`}><span>Current mode</span><strong>{override ? "Manual" : "Automatic"}</strong></span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={`Delivery area for ${customer.name || "customer"}`}>
        {options.map(([value, label]) => {
          const selected = override === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={() => onClassify(customer.id, value)} className={`delivery-area-choice inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60 ${selected ? "delivery-area-choice--selected" : ""}`}>
              {saving && selected ? <Loader2 size={15} className="animate-spin" /> : selected ? <CheckCircle2 size={15} /> : null}
              {label}
            </button>
          );
        })}
      </div>
      {override ? (
        <button type="button" disabled={disabled} onClick={() => onClassify(customer.id, null)} className="delivery-area-automatic inline-flex w-fit items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:cursor-wait disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Use Automatic
        </button>
      ) : null}
    </article>
  );
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

const defaultShopMapCenter = { latitude: 7.1907, longitude: 124.5307 };

function finiteCoordinate(value) {
  const number = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

function isValidShopCoordinate(latitude, longitude, countryCode = "ph") {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (String(countryCode || "").toLowerCase() === "ph") {
    return latitude >= 4 && latitude <= 22 && longitude >= 116 && longitude <= 127;
  }
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && (Math.abs(latitude) > 0.5 || Math.abs(longitude) > 0.5);
}

function cleanGeocoderPart(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function firstGeocoderPart(...values) {
  return values.map(cleanGeocoderPart).find(Boolean) || "";
}

function looksLikePhilippineRegion(value) {
  return /\b(region|metro manila|national capital|soccsksargen|calabarzon|mimaropa|cordillera|bangsamoro|barmm|caraga|cagayan valley|central luzon|western visayas|central visayas|eastern visayas|zamboanga peninsula|northern mindanao)\b/i.test(String(value || ""));
}

function structuredGeocoderAddress(item) {
  const address = item?.address || {};
  const state = cleanGeocoderPart(address.state);
  let province = firstGeocoderPart(address.province, address.state_district);
  let region = firstGeocoderPart(address.region);

  if (!province && state && !looksLikePhilippineRegion(state)) province = state;
  if (!region && state && (looksLikePhilippineRegion(state) || province !== state)) region = state;

  return {
    municipality: firstGeocoderPart(address.city, address.municipality, address.town, address.city_district, address.county, address.locality),
    province,
    region,
    placeId: item?.place_id === null || item?.place_id === undefined ? "" : String(item.place_id)
  };
}

function parseGeocoderResult(item) {
  if (import.meta.env.DEV) {
    console.log("[geocoder] raw result", { lat: item?.lat, lon: item?.lon, display_name: item?.display_name });
  }
  const latitude = Number.parseFloat(String(item?.lat ?? "").trim());
  const longitude = Number.parseFloat(String(item?.lon ?? "").trim());
  const countryCode = item?.address?.country_code || "ph";
  if (!isValidShopCoordinate(latitude, longitude, countryCode)) return null;
  if (import.meta.env.DEV) console.log("[geocoder] parsed", { latitude, longitude });
  return {
    address: cleanGeocoderPart(item?.display_name),
    latitude,
    longitude,
    ...structuredGeocoderAddress(item)
  };
}

function ShopLocationSetting({ value, onChange, error, containerRef, className = "" }) {
  const initialAddress = String(value.shopAddress || "");
  const savedLatitude = finiteCoordinate(value.shopLatitude);
  const savedLongitude = finiteCoordinate(value.shopLongitude);
  const savedCoordinatesValid = savedLatitude === null && savedLongitude === null
    ? true
    : isValidShopCoordinate(savedLatitude, savedLongitude);
  const latitude = savedCoordinatesValid ? savedLatitude : null;
  const longitude = savedCoordinatesValid ? savedLongitude : null;
  const [query, setQuery] = useState(initialAddress);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [coordinateError, setCoordinateError] = useState("");

  useEffect(() => {
    setQuery(String(value.shopAddress || ""));
  }, [value.shopAddress]);

  function applyLocation(location = {}) {
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(location, key);
    const nextLatitude = hasOwn("latitude") ? location.latitude : latitude;
    const nextLongitude = hasOwn("longitude") ? location.longitude : longitude;
    const parsedLatitude = finiteCoordinate(nextLatitude);
    const parsedLongitude = finiteCoordinate(nextLongitude);
    if (parsedLatitude !== null || parsedLongitude !== null) {
      if (!isValidShopCoordinate(parsedLatitude, parsedLongitude)) {
        setCoordinateError("Invalid map coordinates returned. Please select the location again.");
        setResults([]);
        setResolving(false);
        return;
      }
      setCoordinateError("");
      if (import.meta.env.DEV) console.log("[shop-location] saving", { latitude: parsedLatitude, longitude: parsedLongitude });
    }
    onChange({
      shopAddress: hasOwn("address") ? cleanGeocoderPart(location.address) : cleanGeocoderPart(value.shopAddress),
      shopMunicipality: hasOwn("municipality") ? cleanGeocoderPart(location.municipality) : cleanGeocoderPart(value.shopMunicipality),
      shopProvince: hasOwn("province") ? cleanGeocoderPart(location.province) : cleanGeocoderPart(value.shopProvince),
      shopRegion: hasOwn("region") ? cleanGeocoderPart(location.region) : cleanGeocoderPart(value.shopRegion),
      shopPlaceId: hasOwn("placeId") ? cleanGeocoderPart(location.placeId) : cleanGeocoderPart(value.shopPlaceId),
      shopLatitude: parsedLatitude,
      shopLongitude: parsedLongitude
    });
  }

  async function searchLocation(event) {
    event?.preventDefault();
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=5&countrycodes=ph&q=${encodeURIComponent(text)}`);
      if (!response.ok) throw new Error("Search failed");
      const data = await response.json();
      const parsedResults = (Array.isArray(data) ? data : []).map((item) => {
        const parsed = parseGeocoderResult(item);
        return parsed ? { id: parsed.placeId || `${parsed.latitude}-${parsed.longitude}`, ...parsed } : null;
      }).filter((item) => item?.address);
      setResults(parsedResults);
      setCoordinateError(parsedResults.length ? "" : "Invalid map coordinates returned. Please select the location again.");
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function reverseGeocode(nextLatitude, nextLongitude) {
    const latitudeValue = finiteCoordinate(nextLatitude);
    const longitudeValue = finiteCoordinate(nextLongitude);
    if (!isValidShopCoordinate(latitudeValue, longitudeValue)) {
      setCoordinateError("Invalid map coordinates returned. Please select the location again.");
      setResults([]);
      return;
    }
    setCoordinateError("");
    setResolving(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(nextLatitude)}&lon=${encodeURIComponent(nextLongitude)}&zoom=18&addressdetails=1`);
      if (!response.ok) throw new Error("Reverse geocoding failed");
      const data = await response.json();
      const parsed = parseGeocoderResult({ ...data, lat: data?.lat ?? latitudeValue, lon: data?.lon ?? longitudeValue });
      const address = cleanGeocoderPart(parsed?.address || value.shopAddress || query);
      applyLocation({
        address,
        latitude: latitudeValue,
        longitude: longitudeValue,
        municipality: parsed?.municipality || "",
        province: parsed?.province || "",
        region: parsed?.region || "",
        placeId: parsed?.placeId || ""
      });
      if (address) setQuery(address);
    } catch {
      applyLocation({ address: value.shopAddress || query, latitude: latitudeValue, longitude: longitudeValue, placeId: "" });
    } finally {
      setResolving(false);
    }
  }

  function selectResult(result) {
    setQuery(result.address);
    setResults([]);
    applyLocation(result);
  }

  return (
    <div ref={containerRef} className={`settings-location-editor grid gap-3 rounded-[24px] border border-neonbrand/20 bg-neonbrand/10 p-4 md:col-span-2 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/80">Exact Shop Location</p>
          <h3 className="mt-1 text-base font-bold text-white">Set Exact Shop Location</h3>
          <p className="mt-1 text-sm text-white/55">Used as the delivery-route starting point in Admin Order Details.</p>
        </div>
        {latitude !== null && longitude !== null ? (
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-neonbrand/25 bg-neonbrand/10 px-3 py-1 text-xs font-bold text-neonbrand">
            <MapPin size={14} /> Exact pin saved
          </span>
        ) : null}
      </div>

      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={searchLocation}>
        <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-white">
          <Search size={16} className="text-neonbrand" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/35"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shop address or landmark..."
          />
        </label>
        <ActionButton size="sm" icon={searching ? Loader2 : Search} loading={searching} onClick={searchLocation}>Search</ActionButton>
      </form>

      {results.length ? (
        <div className="max-h-44 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-2">
          {results.map((result) => (
            <button key={result.id} type="button" className="flex w-full gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-white/75 transition hover:bg-neonbrand/10 hover:text-neonbrand" onClick={() => selectResult(result)}>
              <MapPin size={15} className="mt-0.5 shrink-0" />
              <span>{result.address}</span>
            </button>
          ))}
        </div>
      ) : null}

      <SettingsMiniMap
        latitude={latitude ?? defaultShopMapCenter.latitude}
        longitude={longitude ?? defaultShopMapCenter.longitude}
        hasPin={latitude !== null && longitude !== null}
        resolving={resolving}
        onSelect={(nextLatitude, nextLongitude) => reverseGeocode(nextLatitude, nextLongitude)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatusPill label="Latitude" value={latitude !== null ? latitude.toFixed(6) : "Not set"} />
        <StatusPill label="Longitude" value={longitude !== null ? longitude.toFixed(6) : "Not set"} />
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {coordinateError ? <ErrorText>{coordinateError}</ErrorText> : null}
      {!savedCoordinatesValid ? <ErrorText>Invalid map coordinates returned. Please select the location again.</ErrorText> : null}
      <button
        type="button"
        className="w-fit rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70 transition hover:border-rose-300/35 hover:text-rose-200"
        onClick={() => applyLocation({ address: value.shopAddress || "", latitude: null, longitude: null })}
      >
        Clear exact pin
      </button>
    </div>
  );
}

function SettingsMiniMap({ latitude, longitude, hasPin, resolving, onSelect, compact = false, readOnly = false }) {
  const [zoom, setZoom] = useState(15);
  const [tileState, setTileState] = useState("loading");
  const [tileVersion, setTileVersion] = useState(0);
  const center = projectToTile(latitude, longitude, zoom);
  const tileX = Math.floor(center.x);
  const tileY = Math.floor(center.y);
  const offsetX = center.x - tileX;
  const offsetY = center.y - tileY;
  const tiles = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      tiles.push({ x, y, tileX: tileX + x, tileY: tileY + y });
    }
  }

  function handleMapClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - rect.left - rect.width / 2) / 256;
    const dy = (event.clientY - rect.top - rect.height / 2) / 256;
    const next = unprojectFromTile(center.x + dx, center.y + dy, zoom);
    onSelect(next.latitude, next.longitude);
  }

  function retryTiles() {
    setTileState("loading");
    setTileVersion((value) => value + 1);
  }

  return (
    <div className="retela-delivery-map-card">
      <div className={`retela-delivery-map ${compact ? "h-36" : "h-72"}`} onClick={readOnly ? undefined : handleMapClick} role={readOnly ? "img" : "button"} tabIndex={readOnly ? -1 : 0} aria-label={readOnly ? "Shop location map preview" : "Tap map to set exact shop pin"}>
        {tileState !== "error" && tiles.map((tile) => (
          <img
            key={`${tile.tileX}-${tile.tileY}-${zoom}-${tileVersion}`}
            src={osmTileUrl(zoom, tile.tileX, tile.tileY, tileVersion)}
            alt=""
            loading="lazy"
            onLoad={() => setTileState((state) => state === "loading" ? "ready" : state)}
            onError={() => { if (import.meta.env.DEV) console.warn("[map] tile load error"); setTileState("error"); }}
            style={{
              left: `calc(50% + ${(tile.x - offsetX) * 256}px)`,
              top: `calc(50% + ${(tile.y - offsetY) * 256}px)`
            }}
          />
        ))}
        {tileState === "error" ? <div className="retela-map-status-overlay"><span>Map could not be loaded.</span><button type="button" onClick={(event) => { event.stopPropagation(); retryTiles(); }}>Retry</button></div> : null}
        {tileState === "loading" ? <div className="retela-map-status-overlay is-loading"><Loader2 size={16} className="animate-spin" /> Loading map...</div> : null}
        {tileState === "ready" ? <span className={`retela-delivery-map-pin ${hasPin ? "" : "opacity-60"}`}><MapPin size={30} /></span> : null}
        {!readOnly ? <div className="retela-delivery-map-tools">
          <button type="button" onClick={(event) => { event.stopPropagation(); setZoom((current) => Math.min(18, current + 1)); }}>+</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); setZoom((current) => Math.max(11, current - 1)); }}>-</button>
        </div> : null}
        {resolving ? <span className="retela-delivery-map-status"><Loader2 size={14} className="animate-spin" /> Resolving address</span> : null}
      </div>
      <p>Search, then tap the map to fine-tune the RETELA shop pin.</p>
    </div>
  );
}

function projectToTile(latitude, longitude, zoom) {
  const safeLatitude = Math.max(-85.0511, Math.min(85.0511, Number(latitude) || 0));
  const safeLongitude = Math.max(-180, Math.min(180, Number(longitude) || 0));
  const latRad = (safeLatitude * Math.PI) / 180;
  const scale = 2 ** zoom;
  return {
    x: ((safeLongitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  };
}

function unprojectFromTile(x, y, zoom) {
  const scale = 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return { latitude, longitude };
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

function NumberInput({ label, value, onChange, prefix, suffix, error }) {
  return (
    <FieldShell label={label} error={error}>
      <div className={`flex min-h-12 items-center gap-2 rounded-2xl border px-4 py-3 ${error ? "border-rose-400/55 bg-rose-500/10" : "border-white/10 bg-white/[0.06]"}`}>
        {prefix ? <span className="shrink-0 text-xs font-semibold text-white/45">{prefix}</span> : null}
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
          <input type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => onChange(event.target.files?.[0] || null)} />
          <span className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm font-bold text-white transition hover:border-neonbrand/40 hover:text-neonbrand">Browse</span>
        </span>
      </div>
    </FieldShell>
  );
}

function ToggleSwitch({ label, description, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="settings-toggle-row group" aria-pressed={checked}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5 text-white/85">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-4 text-white/45">{description}</span> : null}
      </span>
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
    <button type="button" disabled={loading} onClick={onClick} className={`${styleClass} inline-flex min-w-[148px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass}`}>
      {loading ? <Loader2 size={17} className="animate-spin" /> : Icon ? <Icon size={17} /> : null}
      <span>{loading ? "Saving..." : children}</span>
    </button>
  );
}

function Toast({ type, message, onClose }) {
  const success = type === "success";
  return (
    <motion.div
      className={`settings-toast fixed right-5 top-5 z-[160] flex max-w-[min(380px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border p-3 shadow-2xl backdrop-blur-2xl ${success ? "settings-toast--success" : "settings-toast--error"}`}
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.96 }}
    >
      <span className={`mt-0.5 ${success ? "text-neonbrand" : "text-rose-200"}`}>{success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">{success ? "Success" : "Action needed"}</strong>
        <p className="settings-toast__message mt-1 text-sm">{message}</p>
      </div>
      <button type="button" onClick={onClose} className="settings-toast__close rounded-full p-1 transition" aria-label="Close notification">x</button>
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
