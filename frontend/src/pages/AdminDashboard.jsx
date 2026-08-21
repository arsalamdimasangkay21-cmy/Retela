import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend } from "chart.js";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Activity, Archive, Barcode, Bot, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Edit3, Eye, FileSpreadsheet, Loader2, MapPin, Megaphone, MessageSquare, MoreHorizontal, PackageCheck, PackagePlus, Plus, Printer, ReceiptText, RotateCcw, Save, Search, Send, Shirt, ShoppingBag, SlidersHorizontal, Sparkles, Star, Tags, Trash2, TrendingUp, Upload, UserRound, WalletCards, X, Zap } from "lucide-react";
import { api, API_URL, cachedGet, clearGetCache, getApiErrorMessage } from "../api/client";
import { createApparelOption, deleteApparelOption, fetchApparelOptions } from "../api/apparelOptions";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import ConfirmDialog from "../components/ConfirmDialog";
import CustomerDocumentsModal from "../components/CustomerDocumentsModal";
import NotificationPreviewPanel from "../components/NotificationPreviewPanel";
import OrderDeliveryInfo, { MeetingLocationMap } from "../components/OrderDeliveryInfo";
import ProductImage from "../components/ProductImage";
import ProductQuickView from "../components/ProductQuickView";
import { Button, Card, Field, StatCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { getProductImageValue, normalizeProductImageFields, resolveProductImageUrl } from "../utils/productImage";
import AutomationsPage from "./AutomationsPage";
import AdminSettingsPage from "./AdminSettingsPage";
import BroadcastsPage from "./BroadcastsPage";
import AdminConversationsPage from "./AdminConversationsPage";
import PosPage from "./PosPage";
import { AnalyticsPrintOptionsModal, AnalyticsReportModal } from "../reports/AnalyticsReportModal";
import { exportSalesReportExcel } from "../reports/ExportExcel";
import { exportSalesReportPdf } from "../reports/ExportPDF";
import { openPrintReportWindow, previewSalesReport, printSalesReport, writePrintReportError } from "../reports/PrintReport";
import { defaultReportOptions, fetchSalesReport, reportDateRangeLabel, reportOptionsParams, reportRanges } from "../reports/ReportService";

const chartGlowPlugin = {
  id: "retelaGlow",
  beforeDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.shadowColor = "rgba(34,197,94,0.08)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  }
};

const defaultDeliverySafetyPolicy = "For everyone's safety, customers and delivery personnel should meet only at the confirmed delivery or meeting location shown in the order. Verify the order and customer/delivery identity before handing over or accepting an item. Avoid changing the meetup location through unofficial messages. Keep communication inside RETELA whenever possible. Do not share OTPs, passwords, or sensitive account information. If the location feels unsafe, contact the other party through RETELA and arrange a safer public meeting point before completing the order.";

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend, chartGlowPlugin);

const assetUrl = (url) => {
  if (!url) return "";
  const value = String(url).trim();
  if (!value) return "";
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return `${API_URL.replace(/\/api$/, "")}/${value.replace(/^\/+/, "")}`;
};
const fallbackApparelOptions = {
  brands: ["Nike", "Adidas", "Levi's", "Champion", "Uniqlo", "H&M", "Puma", "Lacoste", "Guess", "Other"],
  categories: ["T-Shirts", "Jackets", "Caps", "Other"],
  types: ["Men", "Women", "Kids", "Vintage", "Oversized", "Streetwear", "Sportswear", "Formal", "Casual", "Unisex", "Other"],
  sizes: ["XS", "S", "M", "L", "XL", "XXL", "Free Size", "Other"],
  conditions: ["Like New", "Excellent", "Very Good", "Good", "Fair", "Other"],
  colors: ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Pink", "Purple", "Orange", "Other"]
};
const blankProduct = { name: "", brand: "", category: "", gender: "", size: "", color: "", price: "", stock: "1", condition: "", description: "", image_url: "" };
const defaultCustomerFilters = { search: "", status: "all", approval: "all", sort: "newest" };
const SHOP_LOCATION = "Tela to Pera Thrift Shop, Midsayap, Cotabato, Philippines";
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
const commonCustomerLocations = ["Davao", "Cotabato", "Midsayap", "Kidapawan", "General Santos"];
const chartScales = {
  x: { ticks: { color: "#64748b" }, grid: { color: "#E5E7EB" } },
  y: { ticks: { color: "#64748b" }, grid: { color: "#E5E7EB" } }
};
const chartMotion = {
  animation: { duration: 1800, easing: "easeInOutQuart" },
  transitions: {
    active: { animation: { duration: 600, easing: "easeOutQuart" } },
    resize: { animation: { duration: 700, easing: "easeInOutQuart" } }
  }
};

const glowingLineStyle = {
  borderColor: "#22C55E",
  backgroundColor: "rgba(34,197,94,0.10)",
  borderWidth: 2,
  fill: true,
  tension: 0.35,
  cubicInterpolationMode: "monotone",
  pointBackgroundColor: "#ffffff",
  pointBorderColor: "#22C55E",
  pointBorderWidth: 2,
  pointRadius: 3,
  pointHoverRadius: 5,
  pointHoverBorderWidth: 2
};

function productPayloadValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function optionNames(rows = [], fallback = []) {
  const names = [...fallback, ...rows.map((row) => row?.name || row)].map((value) => String(value || "").trim()).filter(Boolean);
  return names.filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}

function optionItems(rows = [], fallback = []) {
  const map = new Map();
  const fallbackKeys = new Set(fallback.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean));
  fallback.forEach((name) => {
    const value = String(name || "").trim();
    if (value) map.set(value.toLowerCase(), { id: null, name: value, is_system: true });
  });
  rows.forEach((row) => {
    const value = String(row?.name || row || "").trim();
    if (!value) return;
    const key = value.toLowerCase();
    map.set(value.toLowerCase(), {
      id: row?.id ?? null,
      name: value,
      is_system: row?.is_system === true || row?.is_system === 1 || String(row?.is_system).toLowerCase() === "true" || fallbackKeys.has(key) || key === "other"
    });
  });
  const items = [...map.values()].sort((left, right) => {
    if (left.name.toLowerCase() === "other") return 1;
    if (right.name.toLowerCase() === "other") return -1;
    if (left.is_system !== right.is_system) return left.is_system ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return items;
}

function optionExists(options = [], name) {
  const normalized = String(name || "").trim().toLowerCase();
  const found = options.find((value) => String(value?.name || value || "").trim().toLowerCase() === normalized);
  return found?.name || found || "";
}

function resolveProductId(productOrId) {
  if (productOrId && typeof productOrId === "object") {
    return productOrId.id
      ?? productOrId.ID
      ?? productOrId.product_id
      ?? productOrId.productId
      ?? productOrId.apparel_id
      ?? productOrId.apparelId
      ?? productOrId.apparel_item_id
      ?? productOrId.apparelItemId
      ?? productOrId.item_id
      ?? null;
  }
  return productOrId;
}

function validProductId(productOrId) {
  const rawId = resolveProductId(productOrId);
  const productId = Number(rawId);
  return Number.isInteger(productId) && productId > 0 ? productId : null;
}

function deleteDisabledReason(product) {
  return validProductId(product) ? "" : "Cannot delete this item because the backend response did not include a valid product ID.";
}

function isDeletingProduct(product, deletingProductIds = []) {
  const productId = validProductId(product);
  return Boolean(productId && deletingProductIds.includes(productId));
}

function normalizeProductRow(product) {
  const productId = validProductId(product);
  if (!productId && import.meta.env.DEV) {
    console.warn("Loaded product is missing a valid id:", product);
  }
  const barcode = product?.sku || product?.barcode || "";
  return {
    ...normalizeProductImageFields(product),
    id: productId,
    sku: barcode,
    barcode
  };
}

function normalizeProductRows(rows = []) {
  return Array.isArray(rows) ? rows.map(normalizeProductRow) : [];
}

function notificationRowsFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.notifications)) return data.notifications;
  return [];
}

function adminNotificationTarget(row) {
  if (row.type === "message") return "Messages";
  if (["order", "order_cancelled", "payment"].includes(row.type)) return "Orders";
  if (row.type === "inventory") return "Inventory";
  if (["approval", "customer_registration", "registration"].includes(row.type)) return "Customers";
  if (["return", "refund"].includes(row.type)) return "Returns";
  if (row.type === "feedback") return "Feedback";
  return "Notifications";
}

function duplicateOptionMessage(label) {
  return `This ${label.toLowerCase()} already exists.`;
}

export default function AdminDashboard({ active, onChange }) {
  const { user, setUser } = useAuth();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [inventoryProducts, setInventoryProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [returns, setReturns] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [form, setForm] = useState(blankProduct);
  const [productImage, setProductImage] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false);
  const [filters, setFilters] = useState({ search: "", category: "all", brand: "all", stock: "all", size: "all", condition: "all" });
  const [customerFilters, setCustomerFilters] = useState(defaultCustomerFilters);
  const [profile, setProfile] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [rejectingUserIds, setRejectingUserIds] = useState([]);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [selectedDocumentCustomerId, setSelectedDocumentCustomerId] = useState(null);
  const [productToast, setProductToast] = useState(null);
  const [apparelOptions, setApparelOptions] = useState({ brands: [], categories: [], types: [], sizes: [], conditions: [], colors: [] });
  const [deletingProductIds, setDeletingProductIds] = useState([]);
  const [productSaving, setProductSaving] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [pendingProductDelete, setPendingProductDelete] = useState(null);
  const [pendingCustomerDelete, setPendingCustomerDelete] = useState(null);
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef(null);

  const optionValues = useMemo(() => ({
    brands: optionNames(apparelOptions.brands, fallbackApparelOptions.brands),
    categories: optionNames(apparelOptions.categories, fallbackApparelOptions.categories),
    types: optionNames(apparelOptions.types, fallbackApparelOptions.types),
    sizes: optionNames(apparelOptions.sizes, fallbackApparelOptions.sizes),
    conditions: optionNames(apparelOptions.conditions, fallbackApparelOptions.conditions),
    colors: optionNames(apparelOptions.colors, fallbackApparelOptions.colors)
  }), [apparelOptions]);

  const optionMeta = useMemo(() => ({
    brands: optionItems(apparelOptions.brands, fallbackApparelOptions.brands),
    categories: optionItems(apparelOptions.categories, fallbackApparelOptions.categories),
    types: optionItems(apparelOptions.types, fallbackApparelOptions.types),
    sizes: optionItems(apparelOptions.sizes, fallbackApparelOptions.sizes),
    conditions: optionItems(apparelOptions.conditions, fallbackApparelOptions.conditions),
    colors: optionItems(apparelOptions.colors, fallbackApparelOptions.colors)
  }), [apparelOptions]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const text = `${productSku(product)} ${product.name} ${product.brand} ${product.category || ""} ${product.size} ${product.condition}`.toLowerCase();
    const matchesSearch = text.includes(filters.search.toLowerCase());
    const matchesCategory = filters.category === "all" || product.category === filters.category;
    const brand = (product.brand || "").trim();
    const matchesBrand = filters.brand === "all" || brand === filters.brand;
    const matchesStock = filters.stock === "all"
      || (filters.stock === "low" && product.stock <= 5)
      || (filters.stock === "available" && product.stock > 0)
      || (filters.stock === "high" && product.stock >= 10);
    const matchesSize = filters.size === "all" || product.size === filters.size;
    const matchesCondition = filters.condition === "all" || product.condition === filters.condition;
    return matchesSearch && matchesCategory && matchesBrand && matchesStock && matchesSize && matchesCondition;
  }), [products, filters]);

  function showProductToast(message, tone = "success", placement = "bottom-right") {
    setProductToast({ message, tone, placement });
    window.clearTimeout(showProductToast.timer);
    showProductToast.timer = window.setTimeout(() => setProductToast(null), 2800);
  }

  const canUpdate = useCallback((cancelled) => mountedRef.current && !cancelled?.(), []);

  const getShared = useCallback((url, config = {}, options = {}) => (
    cachedGet(url, config, { cacheMs: 8000, retries: 1, ...options })
  ), []);

  const loadApparelOptions = useCallback(async ({ cancelled } = {}) => {
    const options = await fetchApparelOptions();
    if (canUpdate(cancelled)) setApparelOptions(options);
    return options;
  }, [canUpdate]);

  const loadDashboardData = useCallback(async ({ cancelled, force = false } = {}) => {
    if (canUpdate(cancelled)) setNotificationsLoading(true);
    try {
      const [reportRes, inventoryRes, orderRes, userRes, notificationRes] = await Promise.all([
        getShared("/reports/summary", {}, { force }),
        getShared("/products/inventory", {}, { force }),
        getShared("/orders", {}, { force }),
        getShared("/users", {}, { force }),
        getShared("/notifications", {}, { cacheMs: 0, force: true })
      ]);
      if (!canUpdate(cancelled)) return;
      setSummary(reportRes.data);
      setInventoryProducts(normalizeProductRows(inventoryRes.data));
      setOrders(orderRes.data);
      setUsers(userRes.data);
      setNotifications(notificationRowsFromResponse(notificationRes.data));
    } finally {
      if (canUpdate(cancelled)) setNotificationsLoading(false);
    }
  }, [canUpdate, getShared]);

  const loadCatalogData = useCallback(async ({ cancelled, force = false } = {}) => {
    const [productRes] = await Promise.all([
      getShared("/products", {}, { force }),
      loadApparelOptions({ cancelled })
    ]);
    if (!canUpdate(cancelled)) return;
    setProducts(normalizeProductRows(productRes.data));
  }, [canUpdate, getShared, loadApparelOptions]);

  const loadInventoryData = useCallback(async ({ cancelled, force = false } = {}) => {
    const [inventoryRes] = await Promise.all([
      getShared("/products/inventory", {}, { force }),
      loadApparelOptions({ cancelled })
    ]);
    if (!canUpdate(cancelled)) return;
    setInventoryProducts(normalizeProductRows(inventoryRes.data));
  }, [canUpdate, getShared, loadApparelOptions]);

  const loadOrdersData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/orders", {}, { force });
    if (canUpdate(cancelled)) setOrders(data);
  }, [canUpdate, getShared]);

  const loadCustomersData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/users", {}, { force });
    if (canUpdate(cancelled)) setUsers(data);
  }, [canUpdate, getShared]);

  const loadNotificationsData = useCallback(async ({ cancelled, force = false } = {}) => {
    if (canUpdate(cancelled)) setNotificationsLoading(true);
    try {
      const [notificationRes, userRes] = await Promise.all([
        getShared("/notifications", {}, { cacheMs: 0, force: true }),
        getShared("/users", {}, { force })
      ]);
      if (!canUpdate(cancelled)) return;
      setNotifications(notificationRowsFromResponse(notificationRes.data));
      setUsers(userRes.data);
    } finally {
      if (canUpdate(cancelled)) setNotificationsLoading(false);
    }
  }, [canUpdate, getShared]);

  const loadReviewsData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/reviews", {}, { force });
    if (canUpdate(cancelled)) setReviews(data);
  }, [canUpdate, getShared]);

  const loadReturnsData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/returns", {}, { force });
    if (canUpdate(cancelled)) setReturns(data);
  }, [canUpdate, getShared]);

  const loadProfileData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/users/me", {}, { force });
    if (canUpdate(cancelled)) setProfile(data);
  }, [canUpdate, getShared]);

  const loadSummaryData = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await getShared("/reports/summary", {}, { force });
    if (canUpdate(cancelled)) setSummary(data);
  }, [canUpdate, getShared]);

  const loadActiveData = useCallback((page = active, options = {}) => {
    if (page === "Dashboard") return loadDashboardData(options);
    if (page === "Apparel") return loadCatalogData(options);
    if (page === "Inventory") return loadInventoryData(options);
    if (page === "Orders") return loadOrdersData(options);
    if (page === "Customers" || page === "Locations") return loadCustomersData(options);
    if (page === "Notifications") return loadNotificationsData(options);
    if (page === "Feedback") return loadReviewsData(options);
    if (page === "Returns") return loadReturnsData(options);
    if (page === "Profile") return loadProfileData(options);
    if (page === "Reports" || page === "Sales Analytics" || page === "Sales") return loadSummaryData(options);
    return Promise.resolve();
  }, [active, loadCatalogData, loadCustomersData, loadDashboardData, loadInventoryData, loadNotificationsData, loadOrdersData, loadProfileData, loadReturnsData, loadReviewsData, loadSummaryData]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadActiveData(active, { cancelled: () => cancelled }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, loadActiveData]);

  const shouldRefreshActivePage = useCallback((page, eventName, detail = {}) => {
    const type = detail.type || detail.payload?.type || detail.notification?.type || detail.data?.type;
    if (eventName === "retela:user-status") return ["Dashboard", "Customers", "Locations"].includes(page);
    if (eventName === "retela:notification-new") return ["Dashboard", "Notifications"].includes(page);
    if (["order", "shipping", "refund", "return"].includes(type)) return ["Dashboard", "Orders", "Returns", "Reports", "Sales Analytics", "Sales"].includes(page);
    if (["inventory", "product", "new_product"].includes(type)) return ["Dashboard", "Apparel", "Inventory"].includes(page);
    return page === "Dashboard";
  }, []);

  useEffect(() => {
    function scheduleActiveRefresh(event) {
      if (!shouldRefreshActivePage(active, event.type, event.detail || {})) return;
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        loadActiveData(active, { force: true }).catch(() => {});
      }, 400);
    }
    window.addEventListener("retela:data-change", scheduleActiveRefresh);
    window.addEventListener("retela:notification-new", scheduleActiveRefresh);
    window.addEventListener("retela:user-status", scheduleActiveRefresh);
    return () => {
      window.clearTimeout(refreshTimerRef.current);
      window.removeEventListener("retela:data-change", scheduleActiveRefresh);
      window.removeEventListener("retela:notification-new", scheduleActiveRefresh);
      window.removeEventListener("retela:user-status", scheduleActiveRefresh);
    };
  }, [active, loadActiveData, shouldRefreshActivePage]);

  const refreshProductLists = useCallback(async () => {
    clearGetCache("/products");
    await Promise.all([
      loadCatalogData({ force: true }),
      loadInventoryData({ force: true })
    ]);
  }, [loadCatalogData, loadInventoryData]);

  const refreshActiveData = useCallback(() => loadActiveData(active, { force: true }), [active, loadActiveData]);

  const markNotificationRead = useCallback((notificationId) => {
    setNotifications((current) => current.map((row) => Number(row.id) === Number(notificationId) ? { ...row, is_read: true } : row));
  }, []);

  const openAdminNotification = useCallback(async (row) => {
    if (row?.id) {
      await api.patch(`/notifications/${row.id}/read`).catch(() => {});
      clearGetCache("/notifications");
      markNotificationRead(row.id);
      window.dispatchEvent(new CustomEvent("retela:notification-read", { detail: { id: row.id, type: row.type } }));
    }
    onChange(adminNotificationTarget(row || {}));
  }, [markNotificationRead, onChange]);

  async function saveProduct(event, resolvedForm = form, selectedImage = productImage) {
    event.preventDefault();
    if (productSaving) return;
    const price = Number(resolvedForm.price);
    const stock = Number(resolvedForm.stock);
    if (!resolvedForm.name?.trim() || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
      showProductToast("Enter a valid apparel name, positive price, and non-negative stock.", "error");
      return;
    }
    setProductSaving(true);
    try {
      const payload = new FormData();
      payload.append("name", productPayloadValue(resolvedForm.name));
      payload.append("brand", productPayloadValue(resolvedForm.brand || "Other"));
      payload.append("category", productPayloadValue(resolvedForm.category || "T-Shirts"));
      payload.append("gender", productPayloadValue(resolvedForm.gender || "Other"));
      payload.append("size", productPayloadValue(resolvedForm.size || "Free Size"));
      payload.append("color", productPayloadValue(resolvedForm.color || "Other"));
      payload.append("price", String(price));
      payload.append("stock", String(stock));
      payload.append("condition", productPayloadValue(resolvedForm.condition || "Good"));
      payload.append("description", productPayloadValue(resolvedForm.description));
      if (editingProductId && resolvedForm.image_url) payload.append("image_url", resolvedForm.image_url);
      const selectedImageFile = typeof File !== "undefined" && selectedImage instanceof File ? selectedImage : null;
      if (selectedImageFile) payload.append("image", selectedImageFile);
      if (import.meta.env.DEV) {
        console.log("[apparel image submit]", {
          hasFile: Boolean(selectedImageFile),
          isFile: Boolean(selectedImageFile),
          fileName: selectedImageFile?.name || null,
          formDataFields: Array.from(payload.keys())
        });
      }
      let response;
      if (editingProductId) {
        response = await api.put(`/products/${editingProductId}`, payload);
      } else {
        response = await api.post("/products", payload);
      }
      const savedItem = response?.data?.item || response?.data?.product || response?.data;
      setForm(blankProduct);
      setProductImage(null);
      setEditingProductId(null);
      setInventoryModalOpen(false);
      if (savedItem?.id) {
        setProducts((current) => {
          const nextItem = normalizeProductRows([savedItem])[0];
          const exists = current.some((item) => Number(item.id) === Number(nextItem.id));
          return exists
            ? current.map((item) => (Number(item.id) === Number(nextItem.id) ? nextItem : item))
            : [nextItem, ...current];
        });
        setInventoryProducts((current) => {
          const nextItem = normalizeProductRows([savedItem])[0];
          const exists = current.some((item) => Number(item.id) === Number(nextItem.id));
          return exists
            ? current.map((item) => (Number(item.id) === Number(nextItem.id) ? nextItem : item))
            : [nextItem, ...current];
        });
      }
      await refreshProductLists();
      showProductToast(response?.data?.message || (editingProductId ? "Apparel item updated successfully." : "Apparel item saved successfully."));
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not save this apparel item."), "error");
    } finally {
      setProductSaving(false);
    }
  }

  function editProduct(product) {
    if (String(product.id).startsWith("sample-")) return;
    setEditingProductId(product.id);
    setProductImage(null);
    setForm({
      name: product.name || "",
      brand: product.brand || "",
      category: product.category || "T-Shirts",
      gender: product.gender || "Unisex",
      size: product.size || "Free Size",
      color: product.color || "Other",
      price: product.price || "",
      stock: product.stock || "1",
      condition: product.condition || "Good",
      description: product.description || "",
      image_url: getProductImageValue(product)
    });
    setInventoryModalOpen(true);
  }

  async function deleteProduct(productOrId) {
    const productId = validProductId(productOrId);
    if (!productId) {
      console.error("Cannot delete product: missing product ID", productOrId);
      showProductToast("Cannot delete apparel item because its product ID is missing.", "error");
      return;
    }
    const productName = typeof productOrId === "object" ? productOrId.name || "this apparel item" : "this apparel item";
    setPendingProductDelete({ id: productId, name: productName });
  }

  async function confirmDeleteProduct() {
    const pending = pendingProductDelete;
    if (!pending?.id) return;
    const productId = pending.id;
    if (deletingProductIds.includes(productId)) return;
    setDeletingProductIds((ids) => [...ids, productId]);
    try {
      await api.delete(`/products/${productId}`);
      clearGetCache("/products");
      setProducts((rows) => rows.filter((product) => validProductId(product) !== productId));
      setInventoryProducts((rows) => rows.filter((product) => validProductId(product) !== productId));
      setPendingProductDelete(null);
      showProductToast("Apparel item moved to Trash Bin.");
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not delete this apparel item."), "error");
    } finally {
      setDeletingProductIds((ids) => ids.filter((id) => id !== productId));
    }
  }

  async function updateStock(productOrId, change) {
    if (String(productOrId?.id ?? productOrId).startsWith("sample-")) return;
    const productId = validProductId(productOrId);
    if (!productId) {
      showProductToast("Cannot update stock because the product ID is missing.", "error");
      return;
    }
    if (import.meta.env.DEV) {
      console.log("[stock update]", {
        productId,
        requestedStock: null,
        delta: change
      });
    }
    const actionKey = `stock-${productId}`;
    if (busyAction === actionKey) return;
    setBusyAction(actionKey);
    try {
      const { data } = await api.patch(`/products/${productId}/stock`, { delta: change });
      if (data?.id) {
        const updatedItem = normalizeProductRows([data])[0];
        setInventoryProducts((rows) => rows.map((product) => (validProductId(product) === productId ? updatedItem : product)));
        setProducts((rows) => rows.map((product) => (validProductId(product) === productId ? updatedItem : product)));
      }
      await refreshProductLists();
      showProductToast(change > 0 ? "Apparel item restocked successfully." : "Stock updated successfully.");
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not update stock."), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function updateOrder(id, status) {
    const actionKey = `order-${id}`;
    if (busyAction === actionKey) return;
    setBusyAction(actionKey);
    try {
      await api.patch(`/orders/${id}/status`, { status });
      clearGetCache("/orders");
      clearGetCache("/reports/summary");
      await Promise.all([loadOrdersData({ force: true }), loadSummaryData({ force: true })]);
      showProductToast("Order updated successfully.");
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not update order."), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function approveUser(id, status) {
    try {
      if (status === "rejected") {
        setRejectingUserIds((ids) => [...ids, id]);
      }
      await api.patch(`/users/${id}/status`, { status });
      clearGetCache("/users");
      clearGetCache("/notifications");
      await loadNotificationsData({ force: true });
    } finally {
      setRejectingUserIds((ids) => ids.filter((userId) => userId !== id));
    }
  }

  async function removeCustomer(id) {
    const customerId = Number(id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      showProductToast("Cannot remove customer because the customer ID is invalid.", "error");
      return;
    }
    const customer = users.find((row) => Number(row.id) === customerId);
    setPendingCustomerDelete({ id: customerId, name: customer?.username || customer?.display_name || `Customer #${customerId}` });
  }

  async function confirmRemoveCustomer() {
    const pending = pendingCustomerDelete;
    if (!pending?.id) return;
    const customerId = pending.id;
    setRejectingUserIds((ids) => ids.includes(customerId) ? ids : [...ids, customerId]);
    try {
      await api.delete(`/users/${customerId}`);
      clearGetCache("/users");
      await loadCustomersData({ force: true });
      setPendingCustomerDelete(null);
      showProductToast("Customer removed successfully.");
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not remove customer."), "error");
    } finally {
      setRejectingUserIds((ids) => ids.filter((userId) => userId !== customerId));
    }
  }

  async function decideReturn(id, status) {
    const actionKey = `return-${id}`;
    if (busyAction === actionKey) return;
    setBusyAction(actionKey);
    try {
      await api.patch(`/returns/${id}/decision`, { status });
      clearGetCache("/returns");
      clearGetCache("/orders");
      clearGetCache("/notifications");
      await loadReturnsData({ force: true });
      showProductToast("Return request updated.");
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not update return request."), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function saveProfile(event, profileInput = profile, photoInput = profilePhoto) {
    event.preventDefault();
    if (busyAction === "profile-save") return;
    setBusyAction("profile-save");
    try {
      const payload = new FormData();
      Object.entries(profileInput || {}).forEach(([key, value]) => payload.append(key, value ?? ""));
      if (photoInput) payload.append("profilePhoto", photoInput);
      const { data } = await api.patch("/users/me", payload, { headers: { "Content-Type": "multipart/form-data" } });
      localStorage.setItem("retela_user", JSON.stringify(data));
      setUser(data);
      setProfile(data);
      setProfilePhoto(null);
      clearGetCache("/users/me");
      showProductToast("Profile updated successfully.", "success", "top-right");
      return data;
    } catch (error) {
      showProductToast(getApiErrorMessage(error, "Could not save profile."), "error", "top-right");
      throw error;
    } finally {
      setBusyAction("");
    }
  }

  if (active === "Dashboard") {
    return <FuturisticDashboard summary={summary} products={inventoryProducts} orders={orders} users={users} notifications={notifications} notificationsLoading={notificationsLoading} onChange={onChange} onNotificationClick={openAdminNotification} />;
  }

  if (active === "Apparel") {
    return (
      <>
        <ProductGallery
          products={filteredProducts}
          filters={filters}
          setFilters={setFilters}
          optionValues={optionValues}
          onAdd={() => {
            setEditingProductId(null);
            setProductImage(null);
            setForm(blankProduct);
            setInventoryModalOpen(true);
            onChange("Inventory");
          }}
          onEdit={(product) => {
            editProduct(product);
            onChange("Inventory");
          }}
          onDelete={deleteProduct}
          deletingProductIds={deletingProductIds}
        />
        {productToast ? <AdminToast toast={productToast} onClose={() => setProductToast(null)} /> : null}
        <ConfirmDialog
          open={Boolean(pendingProductDelete)}
          title="Move apparel to Trash Bin?"
          message="This apparel item will be removed from active inventory and can be restored from Trash Bin."
          detail={pendingProductDelete?.name}
          confirmLabel="Move to Trash"
          busy={Boolean(pendingProductDelete?.id && deletingProductIds.includes(pendingProductDelete.id))}
          onClose={() => {
            if (!pendingProductDelete?.id || !deletingProductIds.includes(pendingProductDelete.id)) setPendingProductDelete(null);
          }}
          onConfirm={confirmDeleteProduct}
        />
      </>
    );
  }

  if (active === "Inventory") {
    return (
      <>
        <PremiumInventoryPage
          products={inventoryProducts}
          filters={filters}
          setFilters={setFilters}
          onAddItem={() => {
            setEditingProductId(null);
            setProductImage(null);
            setForm(blankProduct);
            setInventoryModalOpen(true);
          }}
          onEdit={editProduct}
          onDelete={deleteProduct}
          deletingProductIds={deletingProductIds}
          onUpdateStock={updateStock}
          modalOpen={inventoryModalOpen}
          onCloseModal={() => {
            setInventoryModalOpen(false);
            setEditingProductId(null);
            setProductImage(null);
            setForm(blankProduct);
          }}
          editingProductId={editingProductId}
          form={form}
          setForm={setForm}
          productImage={productImage}
          setProductImage={setProductImage}
          saveProduct={saveProduct}
          productSaving={productSaving}
          optionValues={optionValues}
          optionMeta={optionMeta}
          refreshApparelOptions={loadApparelOptions}
          showProductToast={showProductToast}
          productToast={productToast}
          onDismissToast={() => setProductToast(null)}
        />
        <ConfirmDialog
          open={Boolean(pendingProductDelete)}
          title="Move apparel to Trash Bin?"
          message="This apparel item will be removed from active inventory and can be restored from Trash Bin."
          detail={pendingProductDelete?.name}
          confirmLabel="Move to Trash"
          busy={Boolean(pendingProductDelete?.id && deletingProductIds.includes(pendingProductDelete.id))}
          onClose={() => {
            if (!pendingProductDelete?.id || !deletingProductIds.includes(pendingProductDelete.id)) setPendingProductDelete(null);
          }}
          onConfirm={confirmDeleteProduct}
        />
      </>
    );
  }

  if (active === "Orders") {
    return <OrderManagement rows={orders} updateOrder={updateOrder} onNavigate={onChange} />;
  }

  if (active === "POS") {
    return <PosPage />;
  }

  if (active === "Customers") {
    const allCustomers = users.filter((row) => row.role !== "admin");
    const normalizedSearch = customerFilters.search.trim().toLowerCase();
    const filteredCustomers = allCustomers
      .filter((customer) => {
        const matchesSearch = !normalizedSearch || customerSearchText(customer).includes(normalizedSearch);
        const matchesStatus = customerFilters.status === "all"
          || (customerFilters.status === "active" && isCustomerActive(customer))
          || (customerFilters.status === "offline" && !isCustomerActive(customer));
        const approval = String(customer.status || "pending").toLowerCase();
        const matchesApproval = customerFilters.approval === "all"
          || (customerFilters.approval === "pending" && !["approved", "rejected", "suspended"].includes(approval))
          || approval === customerFilters.approval;
        return matchesSearch && matchesStatus && matchesApproval;
      })
      .sort((a, b) => {
        if (customerFilters.sort === "oldest") return customerSortValue(a) - customerSortValue(b);
        if (customerFilters.sort === "name-az") return customerDisplayName(a).localeCompare(customerDisplayName(b));
        if (customerFilters.sort === "name-za") return customerDisplayName(b).localeCompare(customerDisplayName(a));
        return customerSortValue(b) - customerSortValue(a);
      });
    const customerOverview = {
      active: allCustomers.filter(isCustomerActive).length,
      offline: allCustomers.filter((customer) => !isCustomerActive(customer)).length,
      approved: allCustomers.filter((customer) => customer.status === "approved").length
    };
    const updateCustomerFilter = (key, value) => setCustomerFilters((current) => ({ ...current, [key]: value }));
    const clearCustomerFilters = () => setCustomerFilters(defaultCustomerFilters);

    return (
      <div className="admin-customers-page grid gap-4">
        <Card className="admin-customers-card admin-customers-filter-card">
          <div className="admin-customers-filter-heading">
            <div className="min-w-0">
              <p>Customer Directory</p>
              <h3>Manage Customers</h3>
              <span>{filteredCustomers.length} of {allCustomers.length} customers shown</span>
            </div>
            <button type="button" className="admin-customer-clear-link" onClick={clearCustomerFilters}>
              Clear Filters
            </button>
          </div>

          <Field
            icon={Search}
            placeholder="Search customer name, username, email, or phone"
            value={customerFilters.search}
            onChange={(event) => updateCustomerFilter("search", event.target.value)}
            wrapperClassName="admin-customer-search"
          />

          <div className="admin-customer-filter-grid" aria-label="Customer filters">
            <select value={customerFilters.status} onChange={(event) => updateCustomerFilter("status", event.target.value)} className="admin-customer-filter-control" aria-label="Filter by online status">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="offline">Offline</option>
            </select>
            <select value={customerFilters.approval} onChange={(event) => updateCustomerFilter("approval", event.target.value)} className="admin-customer-filter-control" aria-label="Filter by approval status">
              <option value="all">All Approval</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={customerFilters.sort} onChange={(event) => updateCustomerFilter("sort", event.target.value)} className="admin-customer-filter-control" aria-label="Sort customers">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name-az">Name A-Z</option>
              <option value="name-za">Name Z-A</option>
            </select>
          </div>

          <div className="admin-customer-overview-grid" aria-label="Customer overview">
            <div className="admin-customer-overview-card">
              <span className="admin-customer-overview-icon"><UserRound size={16} /></span>
              <div>
                <span>Active</span>
                <strong>{customerOverview.active}</strong>
              </div>
            </div>
            <div className="admin-customer-overview-card">
              <span className="admin-customer-overview-icon"><Clock3 size={16} /></span>
              <div>
                <span>Offline</span>
                <strong>{customerOverview.offline}</strong>
              </div>
            </div>
            <div className="admin-customer-overview-card">
              <span className="admin-customer-overview-icon"><CheckCircle2 size={16} /></span>
              <div>
                <span>Approved</span>
                <strong>{customerOverview.approved}</strong>
              </div>
            </div>
          </div>
        </Card>
        <CustomersResponsiveView
          rows={filteredCustomers}
          rejectingUserIds={rejectingUserIds}
          onApprove={(id) => approveUser(id, "approved")}
          onView={(id) => setSelectedDocumentCustomerId(id)}
          onDelete={removeCustomer}
        />
        <CustomerDocumentsModal customerId={selectedDocumentCustomerId} open={Boolean(selectedDocumentCustomerId)} onClose={() => setSelectedDocumentCustomerId(null)} />
        <ConfirmDialog
          open={Boolean(pendingCustomerDelete)}
          title="Remove customer account?"
          message="This customer account will be removed from the active customers list."
          detail={pendingCustomerDelete?.name}
          confirmLabel="Remove Customer"
          busy={Boolean(pendingCustomerDelete?.id && rejectingUserIds.includes(pendingCustomerDelete.id))}
          onClose={() => {
            if (!pendingCustomerDelete?.id || !rejectingUserIds.includes(pendingCustomerDelete.id)) setPendingCustomerDelete(null);
          }}
          onConfirm={confirmRemoveCustomer}
        />
      </div>
    );
  }

  if (active === "Reports" || active === "Sales Analytics" || active === "Sales") {
    return <SalesAnalytics summary={summary} />;
  }

  if (active === "Automations") return <AutomationsPage />;
  if (active === "Broadcasts") return <BroadcastsPage />;
  if (active === "Purchases") return <Card><h3 className="font-display text-xl font-bold">Purchases</h3><p className="mt-2 text-sm text-slate-500">Purchase tracking can be connected to supplier records when this module is ready.</p></Card>;

  if (active === "Notifications") return <AdminNotifications rows={notifications} loading={notificationsLoading} users={users} rejectingUserIds={rejectingUserIds} selectedRegistration={selectedRegistration} setSelectedRegistration={setSelectedRegistration} approveUser={approveUser} onChange={onChange} onNotificationRead={markNotificationRead} />;
  if (active === "Feedback") return <AdminFeedback reviews={reviews} />;
  if (active === "Returns") return <AdminReturns rows={returns} decideReturn={decideReturn} />;
  if (active === "Archive") return <ArchivePage onChanged={refreshActiveData} />;
  if (active === "Trash Bin") return <TrashBinPage onChanged={refreshActiveData} />;
  if (active === "Messages") return <AdminConversationsPage />;
  if (active === "Locations") return <AdminLocations users={users} />;
  if (active === "Profile") return <AdminProfile profile={profile} setProfile={setProfile} profilePhoto={profilePhoto} setProfilePhoto={setProfilePhoto} saveProfile={saveProfile} profileSaving={busyAction === "profile-save"} showToast={showProductToast} />;
  if (active === "Settings") return <AdminSettingsPage onChange={onChange} />;
  return <TableCard rows={returns} actions={(row) => <><button onClick={() => decideReturn(row.id, "approved")} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Approve</button><button onClick={() => decideReturn(row.id, "rejected")} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Reject</button></>} />;
}

function ArchivePage({ onChanged }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  const loadArchive = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await cachedGet("/messages/archive", {}, { cacheMs: 8000, retries: 1, force });
    if (!cancelled?.()) setConversations(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadArchive({ cancelled: () => cancelled })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadArchive]);

  async function restoreConversation(id) {
    setBusyId(`restore-${id}`);
    try {
      await api.patch(`/messages/${id}/restore`);
      clearGetCache("/messages/archive");
      await loadArchive({ force: true });
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function trashConversation(id) {
    setBusyId(`trash-${id}`);
    try {
      await api.patch(`/messages/${id}/trash`);
      clearGetCache("/messages/archive");
      await loadArchive({ force: true });
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="rounded-[30px] border border-white/10 bg-black/35 p-6 shadow-2xl shadow-black/25">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Archived records</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">Archive</h1>
      </section>
      <Card className="p-0">
        <RecordTable
          loading={loading}
          rows={conversations}
          emptyTitle="Archive is empty"
          columns={["Customer", "Last Message", "Archived", "Actions"]}
          renderRow={(row) => (
            <tr key={row.id} className="border-b border-white/10">
              <td className="px-5 py-4 font-bold text-white">{row.username || `Customer #${row.customer_id}`}</td>
              <td className="max-w-md px-5 py-4 text-white/60"><span className="line-clamp-2">{row.latest_message || "No messages"}</span></td>
              <td className="px-5 py-4 text-white/55">{formatAdminDate(row.archived_at || row.updated_at)}</td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <SmallAction disabled={Boolean(busyId)} onClick={() => restoreConversation(row.id)} icon={RotateCcw}>Restore</SmallAction>
                  <SmallAction disabled={Boolean(busyId)} onClick={() => trashConversation(row.id)} icon={Trash2} danger>Move to Trash</SmallAction>
                </div>
              </td>
            </tr>
          )}
        />
      </Card>
    </motion.div>
  );
}

function TrashBinPage({ onChanged }) {
  const [apparel, setApparel] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadTrash = useCallback(async ({ cancelled, force = false } = {}) => {
    const [apparelRes, conversationRes, broadcastRes] = await Promise.all([
      cachedGet("/products/archived", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/messages/trash", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/broadcasts/trash", {}, { cacheMs: 8000, retries: 1, force })
    ]);
    if (cancelled?.()) return;
    setApparel(apparelRes.data);
    setConversations(conversationRes.data);
    setBroadcasts(broadcastRes.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadTrash({ cancelled: () => cancelled })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTrash]);

  async function restoreApparel(id) {
    setBusyId(`apparel-restore-${id}`);
    try {
      await api.patch(`/products/${id}/restore`);
      clearGetCache("/products");
      await loadTrash({ force: true });
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteApparel(id) {
    setDeleteConfirm({ type: "apparel", id, title: "Permanently delete apparel?", detail: "This apparel item cannot be restored after deletion." });
  }

  async function confirmDelete() {
    if (!deleteConfirm?.id || !deleteConfirm?.type) return;
    const { id, type } = deleteConfirm;
    if (type === "apparel") {
      setBusyId(`apparel-delete-${id}`);
      try {
        await api.delete(`/products/${id}/permanent`);
        clearGetCache("/products");
        await loadTrash({ force: true });
        await onChanged?.();
        setDeleteConfirm(null);
      } finally {
        setBusyId("");
      }
      return;
    }
    if (type === "conversation") {
      setBusyId(`conversation-delete-${id}`);
      try {
        await api.delete(`/messages/${id}/permanent`);
        clearGetCache("/messages/trash");
        await loadTrash({ force: true });
        await onChanged?.();
        setDeleteConfirm(null);
      } finally {
        setBusyId("");
      }
      return;
    }
    if (type === "broadcast") {
      setBusyId(`broadcast-delete-${id}`);
      try {
        await api.delete(`/broadcasts/${id}/permanent`);
        clearGetCache("/broadcasts/trash");
        await loadTrash({ force: true });
        await onChanged?.();
        setDeleteConfirm(null);
      } finally {
        setBusyId("");
      }
    }
  }

  async function restoreConversation(id) {
    setBusyId(`conversation-restore-${id}`);
    try {
      await api.patch(`/messages/${id}/restore`);
      clearGetCache("/messages/trash");
      await loadTrash({ force: true });
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteConversation(id) {
    setDeleteConfirm({ type: "conversation", id, title: "Permanently delete conversation?", detail: "This conversation cannot be restored after deletion." });
  }

  async function restoreBroadcast(id) {
    setBusyId(`broadcast-restore-${id}`);
    try {
      await api.patch(`/broadcasts/${id}/restore`);
      clearGetCache("/broadcasts/trash");
      await loadTrash({ force: true });
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteBroadcast(id) {
    setDeleteConfirm({ type: "broadcast", id, title: "Permanently delete broadcast?", detail: "This broadcast cannot be restored after deletion." });
  }

  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="rounded-[30px] border border-white/10 bg-black/35 p-6 shadow-2xl shadow-black/25">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-200">Deleted records</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">Trash Bin</h1>
      </section>
      <Card className="p-0">
        <RecordSection title="Deleted Apparel" icon={Shirt} />
        <RecordTable
          loading={loading}
          rows={apparel}
          emptyTitle="No deleted apparel"
          columns={["Apparel", "Stock", "Deleted", "Actions"]}
          renderRow={(row) => (
            <tr key={`apparel-${row.id}`} className="border-b border-white/10">
              <td className="px-5 py-4">
                <strong className="block text-white">{row.name}</strong>
                <span className="text-xs text-white/45">{row.brand || "Other"} | {row.category || "Apparel"} | {row.size || "Free Size"}</span>
              </td>
              <td className="px-5 py-4 text-white/65">{row.stock}</td>
              <td className="px-5 py-4 text-white/55">{formatAdminDate(row.deleted_at)}</td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <SmallAction disabled={Boolean(busyId)} onClick={() => restoreApparel(row.id)} icon={RotateCcw}>Restore</SmallAction>
                  <SmallAction disabled={Boolean(busyId)} onClick={() => deleteApparel(row.id)} icon={Trash2} danger>Delete Permanently</SmallAction>
                </div>
              </td>
            </tr>
          )}
        />
      </Card>
      <Card className="p-0">
        <RecordSection title="Deleted Conversations" icon={MessageSquare} />
        <RecordTable
          loading={loading}
          rows={conversations}
          emptyTitle="No deleted conversations"
          columns={["Customer", "Last Message", "Deleted", "Actions"]}
          renderRow={(row) => (
            <tr key={`conversation-${row.id}`} className="border-b border-white/10">
              <td className="px-5 py-4 font-bold text-white">{row.username || `Customer #${row.customer_id}`}</td>
              <td className="max-w-md px-5 py-4 text-white/60"><span className="line-clamp-2">{row.latest_message || "No messages"}</span></td>
              <td className="px-5 py-4 text-white/55">{formatAdminDate(row.deleted_at)}</td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <SmallAction disabled={Boolean(busyId)} onClick={() => restoreConversation(row.id)} icon={RotateCcw}>Restore</SmallAction>
                  <SmallAction disabled={Boolean(busyId)} onClick={() => deleteConversation(row.id)} icon={Trash2} danger>Delete Permanently</SmallAction>
                </div>
              </td>
            </tr>
          )}
        />
      </Card>
      <Card className="p-0">
        <RecordSection title="Deleted Broadcasts" icon={Megaphone} />
        <RecordTable
          loading={loading}
          rows={broadcasts}
          emptyTitle="No deleted broadcasts"
          columns={["Broadcast", "Status", "Deleted", "Actions"]}
          renderRow={(row) => (
            <tr key={`broadcast-${row.id}`} className="border-b border-white/10">
              <td className="px-5 py-4">
                <strong className="block text-white">{row.title}</strong>
                <span className="line-clamp-1 text-xs text-white/45">{row.message}</span>
              </td>
              <td className="px-5 py-4 text-white/65">{row.status}</td>
              <td className="px-5 py-4 text-white/55">{formatAdminDate(row.deleted_at)}</td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <SmallAction disabled={Boolean(busyId)} onClick={() => restoreBroadcast(row.id)} icon={RotateCcw}>Restore</SmallAction>
                  <SmallAction disabled={Boolean(busyId)} onClick={() => deleteBroadcast(row.id)} icon={Trash2} danger>Delete Permanently</SmallAction>
                </div>
              </td>
            </tr>
          )}
        />
      </Card>
      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.title}
        message="This action cannot be undone."
        detail={deleteConfirm?.detail}
        confirmLabel="Delete Permanently"
        busy={Boolean(deleteConfirm && busyId === `${deleteConfirm.type}-delete-${deleteConfirm.id}`)}
        onClose={() => {
          if (!busyId) setDeleteConfirm(null);
        }}
        onConfirm={confirmDelete}
      />
    </motion.div>
  );
}

function RecordSection({ title, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand"><Icon size={18} /></span>
      <h2 className="font-display text-xl font-bold text-white">{title}</h2>
    </div>
  );
}

function RecordTable({ loading, rows, columns, renderRow, emptyTitle }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.035] text-xs uppercase tracking-[0.12em] text-white/42">
            {columns.map((column) => <th key={column} className="px-5 py-4">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length} className="px-5 py-8 text-center text-white/50">Loading records...</td></tr>
          ) : rows.length ? rows.map(renderRow) : (
            <tr><td colSpan={columns.length} className="px-5 py-8 text-center text-white/50">{emptyTitle}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SmallAction({ children, icon: Icon, onClick, disabled, danger = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "border-rose-300/25 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20"}`}>
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

function formatAdminDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PremiumInventoryPage({
  products,
  filters,
  setFilters,
  onAddItem,
  onEdit,
  onDelete,
  deletingProductIds = [],
  onUpdateStock,
  modalOpen,
  onCloseModal,
  editingProductId,
  form,
  setForm,
  productImage,
  setProductImage,
  saveProduct,
  productSaving = false,
  optionValues = {},
  optionMeta = {},
  refreshApparelOptions,
  showProductToast,
  productToast,
  onDismissToast
}) {
  const sourceProducts = products.map(normalizeInventoryProduct);
  const [page, setPage] = useState(1);
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [selectedBarcodeIds, setSelectedBarcodeIds] = useState([]);
  const pageSize = 6;
  const visibleProducts = useMemo(() => sourceProducts.filter((product) => {
    const text = `${productSku(product)} ${product.name} ${product.brand || ""} ${product.category} ${product.size} ${product.condition}`.toLowerCase();
    const matchesSearch = text.includes(filters.search.toLowerCase());
    const matchesCategory = filters.category === "all" || product.category === filters.category;
    const matchesSize = filters.size === "all" || product.size === filters.size;
    const matchesCondition = filters.condition === "all" || product.condition === filters.condition;
    return matchesSearch && matchesCategory && matchesSize && matchesCondition;
  }), [sourceProducts, filters]);
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / pageSize));
  const pageProducts = visibleProducts.slice((page - 1) * pageSize, page * pageSize);
  const scannedProduct = useMemo(() => findProductByBarcode(sourceProducts, barcodeQuery), [sourceProducts, barcodeQuery]);
  const allBarcodeIds = useMemo(() => sourceProducts.map((product) => Number(product.id)).filter(Boolean), [sourceProducts]);
  const selectedBarcodeProducts = useMemo(() => sourceProducts.filter((product) => selectedBarcodeIds.includes(Number(product.id))), [sourceProducts, selectedBarcodeIds]);
  const stats = [
    { title: "T-Shirts Stock", value: stockByCategory(sourceProducts, "T-Shirts"), subtitle: "Available tees", icon: PackageCheck },
    { title: "Caps Stock", value: stockByCategory(sourceProducts, "Caps"), subtitle: "Caps on hand", icon: PackagePlus },
    { title: "Jackets Stock", value: stockByCategory(sourceProducts, "Jackets"), subtitle: "Outerwear count", icon: ShoppingBagIcon },
    { title: "Total Apparel Inventory", value: sourceProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0), subtitle: `${sourceProducts.length} apparel items`, icon: SlidersHorizontal }
  ];

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.category, filters.size, filters.condition]);

  useEffect(() => {
    setSelectedBarcodeIds((ids) => ids.filter((id) => allBarcodeIds.includes(id)));
  }, [allBarcodeIds]);

  function handleBarcodeQuery(value) {
    setBarcodeQuery(value);
    setFilters({ ...filters, search: value });
  }

  function toggleBarcode(id) {
    const productId = Number(id);
    setSelectedBarcodeIds((ids) => ids.includes(productId) ? ids.filter((value) => value !== productId) : [...ids, productId]);
  }

  function selectAllBarcodes() {
    setSelectedBarcodeIds(allBarcodeIds);
  }

  function clearSelectedBarcodes() {
    setSelectedBarcodeIds([]);
  }

  return (
    <motion.div
      className="inventory-page grid min-w-0 gap-5"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_50%_30%,rgba(56,255,136,0.18),transparent_55%)] lg:block" />
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Real-time stock control</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Inventory</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58 sm:text-base">Manage thrift shop apparel and stock in real-time.</p>
          </div>
          <button type="button" onClick={onAddItem} className="gradient-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold shadow-[0_0_35px_rgba(56,255,136,0.15)] sm:w-auto">
            <Plus size={18} />
            Add Apparel Item
          </button>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => <InventoryStatCard key={stat.title} index={index} {...stat} />)}
      </div>

      <BarcodeScannerPanel
        title="Inventory Barcode Scanner"
        value={barcodeQuery}
        onChange={handleBarcodeQuery}
        product={scannedProduct}
      />

      <Card className="inventory-filter-card">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_150px_170px_auto]">
          <Field icon={Search} placeholder="Search apparel inventory" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <InventorySelect label="Category" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })} options={["all", ...(optionValues.categories || []).filter((value) => value !== "Other")]} />
          <InventorySelect label="Size" value={filters.size} onChange={(value) => setFilters({ ...filters, size: value })} options={["all", ...(optionValues.sizes || []).filter((value) => value !== "Other")]} />
          <InventorySelect label="Condition" value={filters.condition} onChange={(value) => setFilters({ ...filters, condition: value })} options={["all", ...(optionValues.conditions || []).filter((value) => value !== "Other")]} />
          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-5 py-3 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black hover:shadow-[0_0_30px_rgba(56,255,136,0.18)]">
            <SlidersHorizontal size={17} />
            Filter
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Stock List</h2>
            <p className="mt-1 text-sm text-white/45">Inventory is the source of truth for apparel, stock, and barcodes.</p>
          </div>
          <button type="button" onClick={() => setBarcodeModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-4 py-2.5 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
            <Barcode size={17} />
            Barcodes
          </button>
        </div>
        {pageProducts.length ? (
          <>
            <div className="hidden xl:block">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[8%]" />
                  <col className="w-[15%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[7%]" />
                  <col className="w-[9%]" />
                  <col className="w-[8%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.035] text-[11px] uppercase tracking-[0.08em] text-white/42">
                    <th className="px-3 py-4">Image</th>
                    <th className="px-3 py-4">Apparel</th>
                    <th className="px-3 py-4">Barcode/SKU</th>
                    <th className="px-3 py-4">Category</th>
                    <th className="px-3 py-4">Size</th>
                    <th className="px-3 py-4">Condition</th>
                    <th className="px-3 py-4">Stock</th>
                    <th className="px-3 py-4">Price</th>
                    <th className="px-3 py-4">Status</th>
                    <th className="px-3 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageProducts.map((product, index) => (
                    <motion.tr
                      key={product.id}
                      className="group border-b border-white/7 align-top transition duration-300 hover:bg-neonbrand/[0.045]"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: index * 0.035 }}
                    >
                      <td className="px-3 py-4">
                        <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-lg shadow-black/20">
                          <ProductImage product={product} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt={product.name} />
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <strong className="block break-words text-white">{product.name}</strong>
                        <span className="mt-1 block break-words text-xs text-white/42">{product.brand || "Curated thrift item"}</span>
                      </td>
                      <td className="px-3 py-4">
                        <div className="grid gap-1">
                          <div className="h-9 overflow-hidden rounded-xl border border-white/10 bg-white p-1">
                            <BarcodeSvg value={productSku(product)} compact />
                          </div>
                          <span className="break-all text-[11px] font-bold text-neonbrand">{productSku(product)}</span>
                        </div>
                      </td>
                      <td className="break-words px-3 py-4 text-white/70">{product.category}</td>
                      <td className="break-words px-3 py-4 text-white/70">{product.size || "Free Size"}</td>
                      <td className="break-words px-3 py-4 text-white/70">{normalizeCondition(product.condition)}</td>
                      <td className="px-3 py-4"><span className="font-display text-lg font-bold text-white">{product.stock}</span></td>
                      <td className="break-words px-3 py-4 font-bold text-white">PHP {Number(product.price || 0).toLocaleString()}</td>
                      <td className="px-3 py-4"><InventoryStatusBadge stock={product.stock} status={product.status} /></td>
                      <td className="px-3 py-4">
                        <InventoryActions product={product} onEdit={onEdit} onUpdateStock={onUpdateStock} onDelete={onDelete} deletingProductIds={deletingProductIds} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-4 xl:hidden">
              {pageProducts.map((product) => (
                <article key={product.id} className="rounded-3xl border border-white/10 bg-white/[0.055] p-3">
                  <div className="flex gap-3">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06]">
                      <ProductImage product={product} className="h-full w-full object-cover" alt={product.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block break-words text-white">{product.name}</strong>
                      <span className="mt-1 block break-words text-xs text-white/45">{product.brand || "Other"} | {product.category || "Apparel"} | {product.size || "Free Size"}</span>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <InventoryStatusBadge stock={product.stock} status={product.status} />
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-bold text-white/65">{product.stock} stock</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white p-2">
                      <div className="h-12">
                        <BarcodeSvg value={productSku(product)} compact />
                      </div>
                      <p className="mt-1 break-all text-center text-xs font-black text-emerald-700">{productSku(product)}</p>
                    </div>
                    <div className="grid gap-1 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/65">
                      <span><strong className="text-white/80">Condition:</strong> {normalizeCondition(product.condition)}</span>
                      <span><strong className="text-white/80">Price:</strong> PHP {Number(product.price || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <InventoryActions product={product} onEdit={onEdit} onUpdateStock={onUpdateStock} onDelete={onDelete} deletingProductIds={deletingProductIds} mobile />
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : <div className="p-5"><EmptyState title="No inventory yet" subtitle="Add real apparel items to populate this database-backed inventory view." /></div>}
        <div className="flex flex-col justify-between gap-3 px-4 py-4 text-sm text-white/50 sm:flex-row sm:items-center sm:px-5">
          <p>Showing {pageProducts.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, visibleProducts.length)} of {visibleProducts.length} inventory items</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronLeft size={18} />
            </button>
            <span className="rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-bold text-white/75">Page {page} of {totalPages}</span>
            <button type="button" disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </Card>

      {barcodeModalOpen ? (
        <BarcodeSelectionModal
          products={sourceProducts}
          selectedIds={selectedBarcodeIds}
          selectedProducts={selectedBarcodeProducts}
          allSelected={Boolean(allBarcodeIds.length) && selectedBarcodeIds.length === allBarcodeIds.length}
          onToggle={toggleBarcode}
          onSelectAll={selectAllBarcodes}
          onClear={clearSelectedBarcodes}
          onPrintSelected={() => printProductBarcodes(selectedBarcodeProducts)}
          onClose={() => setBarcodeModalOpen(false)}
        />
      ) : null}

      {modalOpen ? (
        <ProductEditorModal
          editingProductId={editingProductId}
          form={form}
          setForm={setForm}
          productImage={productImage}
          setProductImage={setProductImage}
          saveProduct={saveProduct}
          productSaving={productSaving}
          optionValues={optionValues}
          optionMeta={optionMeta}
          refreshApparelOptions={refreshApparelOptions}
          showProductToast={showProductToast}
          onClose={onCloseModal}
        />
      ) : null}
      {productToast ? <AdminToast toast={productToast} onClose={onDismissToast} /> : null}
    </motion.div>
  );
}

function InventoryStatCard({ title, value, subtitle, icon: Icon, index }) {
  return (
    <motion.article
      className="group rounded-[26px] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/25 backdrop-blur-2xl transition duration-300 hover:border-neonbrand/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.015 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">{title}</p>
          <strong className="mt-4 block font-display text-4xl font-bold text-white">{value}</strong>
          <span className="mt-2 block text-sm text-white/45">{subtitle}</span>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)] transition duration-300 group-hover:scale-110">
          <Icon size={23} />
        </span>
      </div>
    </motion.article>
  );
}

function InventorySelect({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1">
      <span className="sr-only">{label}</span>
      <select className="h-full rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm text-white outline-none transition focus:border-neonbrand/60 focus:ring-4 focus:ring-neonbrand/10" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option === "all" ? label : option}</option>)}
      </select>
    </label>
  );
}

function InventoryStatusBadge({ stock, status }) {
  const badgeStatus = status || (Number(stock) <= 0 ? "Out of Stock" : Number(stock) <= 5 ? "Low Stock" : "In Stock");
  const styles = {
    "In Stock": "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    "Low Stock": "border-orange-400/20 bg-orange-400/10 text-orange-300",
    "Out of Stock": "border-rose-400/20 bg-rose-400/10 text-rose-300"
  };
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${styles[badgeStatus]}`}>{badgeStatus}</span>;
}

function InventoryActions({ product, onEdit, onUpdateStock, onDelete, deletingProductIds = [], mobile = false }) {
  const deleting = isDeletingProduct(product, deletingProductIds);
  return (
    <div className={mobile ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>
      <InventoryActionButton tone="edit" icon={Edit3} onClick={() => onEdit(product)}>
        Edit
      </InventoryActionButton>
      <InventoryActionButton tone="more" icon={MoreHorizontal} disabled={!validProductId(product)} title={deleteDisabledReason(product)} onClick={() => onUpdateStock(product, Number(product.stock) <= 0 ? 1 : -1)}>
        More
      </InventoryActionButton>
      <InventoryActionButton tone="delete" icon={Trash2} disabled={!validProductId(product) || deleting} title={deleteDisabledReason(product)} onClick={() => onDelete(product)} className={mobile ? "col-span-2" : ""}>
        {deleting ? "Deleting..." : "Delete"}
      </InventoryActionButton>
    </div>
  );
}

function InventoryActionButton({ tone, icon: Icon, children, onClick, disabled = false, title = "", className = "" }) {
  const styles = {
    edit: "border-[#60A5FA] bg-[#DBEAFE] text-[#1D4ED8] hover:border-[#2563EB]",
    more: "border-[#D1D5DB] bg-[#F3F4F6] text-[#374151] hover:border-[#9CA3AF]",
    delete: "border-[#fda29b] bg-[#fff1f0] text-[#b42318] hover:border-[#f97066] hover:bg-[#fee4e2] hover:text-[#912018] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(217,45,32,0.45)]"
  };
  return (
    <button type="button" disabled={disabled} title={title} onClick={onClick} className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-3 py-2 text-sm font-semibold leading-none shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45 ${styles[tone] || styles.more} ${className}`}>
      {Icon ? <Icon size={16} className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

function BarcodeScannerPanel({ title, value, onChange, product, onPrint, compact = false }) {
  const hasQuery = Boolean(String(value || "").trim());
  return (
    <Card className={`border-neonbrand/15 bg-neonbrand/[0.055] ${compact ? "sales-barcode-card" : ""}`}>
      <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-neonbrand/25 bg-neonbrand/10 text-neonbrand">
              <Barcode size={22} />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-white">{title}</h2>
              <p className="mt-1 text-sm text-white/45">Scan or type a RETELA barcode/SKU.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neonbrand" size={18} />
              <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="RETELA-000001"
                className="min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.07] py-3 pl-12 pr-4 text-sm font-semibold uppercase text-white outline-none placeholder:text-white/35 focus:border-neonbrand/60 focus:ring-4 focus:ring-neonbrand/10"
              />
            </div>
            <button type="button" onClick={() => { if (!compact) onChange(""); }} className="rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
              {compact ? "Scan" : "Clear"}
            </button>
          </div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
          {product ? (
            <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="grid gap-2">
                <div className="h-20 overflow-hidden rounded-2xl bg-white p-2">
                  <BarcodeSvg value={productSku(product)} />
                </div>
                <strong className="truncate text-center text-sm text-neonbrand">{productSku(product)}</strong>
                {onPrint ? (
                  <button type="button" onClick={() => onPrint(product)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-3 py-2 text-xs font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
                    <Printer size={15} />
                    Print Barcode
                  </button>
                ) : null}
              </div>
              <div className="min-w-0">
                <h3 className="truncate font-display text-2xl font-bold text-white">{product.name}</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Detail label="Category" value={product.category || "Apparel"} />
                  <Detail label="Size" value={product.size || "Free Size"} />
                  <Detail label="Price" value={money(product.price)} />
                  <Detail label="Stock" value={product.stock} />
                </div>
                <div className="mt-3">
                  <InventoryStatusBadge stock={product.stock} status={product.status} />
                </div>
              </div>
            </div>
          ) : (
            compact ? (
              <p className="sales-barcode-status">{hasQuery ? "No matching product found. Check the barcode/SKU and try again." : "Ready to scan or search by SKU."}</p>
            ) : (
              <EmptyState
                title={hasQuery ? "No matching product found" : "Ready to scan"}
                subtitle={hasQuery ? "Check the barcode/SKU and try again." : "Matching product details will appear here immediately."}
              />
            )
          )}
        </div>
      </div>
    </Card>
  );
}

function AdminToast({ toast, onClose }) {
  const success = toast?.tone !== "error";
  const positionClass = toast?.placement === "top-right" ? "top-5 right-5" : "bottom-5 right-5";
  return (
    <div className={`fixed ${positionClass} z-[170] flex max-w-sm items-start gap-3 rounded-[24px] border p-4 text-white shadow-2xl backdrop-blur-2xl ${success ? "border-neonbrand/25 bg-black/85" : "border-rose-300/25 bg-rose-950/85"}`}>
      {success ? <Check size={20} className="mt-0.5 shrink-0 text-neonbrand" /> : <Trash2 size={20} className="mt-0.5 shrink-0 text-rose-200" />}
      <p className="min-w-0 flex-1 text-sm leading-6 text-white/72">{toast?.message}</p>
      <button type="button" onClick={onClose} className="shrink-0 rounded-full px-2 text-white/45 hover:bg-white/10 hover:text-white">x</button>
    </div>
  );
}

function ProductEditorModal({ editingProductId, form, setForm, productImage, setProductImage, saveProduct, productSaving = false, optionValues = {}, optionMeta = {}, refreshApparelOptions, showProductToast, onClose }) {
  const inputClass = "h-12 min-h-12 w-full rounded-xl border border-[#cfded4] bg-white px-3 py-2 text-sm font-semibold text-[#17211b] outline-none transition placeholder:text-[#8b9a91] focus:border-[#20b66a] focus:ring-4 focus:ring-[rgba(32,182,106,0.18)]";
  const secondaryButtonClass = "inline-flex min-h-12 items-center justify-center rounded-xl border border-[#cfded4] bg-white px-5 py-2.5 text-sm font-bold text-[#17211b] shadow-sm transition hover:border-[#20b66a] hover:text-[#15884f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20b66a] active:scale-95";
  const primaryButtonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#20b66a] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-700/18 transition hover:bg-[#15884f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20b66a] active:scale-95";
  const [otherValues, setOtherValues] = useState({ brand: "", category: "", gender: "", size: "", color: "", condition: "" });
  const [otherErrors, setOtherErrors] = useState({});
  const [deletingOptionKeys, setDeletingOptionKeys] = useState([]);
  const deletingOptionKeysRef = useRef(new Set());
  const [existingImageUrl, setExistingImageUrl] = useState(null);
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const previewObjectUrlRef = useRef("");
  const displayedImageUrl = previewImageUrl || existingImageUrl;
  const optionConfigs = [
    { kind: "brands", formKey: "brand", label: "brand", inputLabel: "Brand Name", placeholder: "Enter new brand name", message: "Brand added successfully." },
    { kind: "categories", formKey: "category", label: "category", inputLabel: "Category", placeholder: "Enter new category", message: "Category added successfully." },
    { kind: "types", formKey: "gender", label: "type", inputLabel: "Type", placeholder: "Enter new type", message: "Type added successfully." },
    { kind: "sizes", formKey: "size", label: "size", inputLabel: "Size", placeholder: "Enter custom size", message: "Size added successfully." },
    { kind: "colors", formKey: "color", label: "color", inputLabel: "Color", placeholder: "Enter new color", message: "Color added successfully." },
    { kind: "conditions", formKey: "condition", label: "condition", inputLabel: "Condition", placeholder: "Enter new condition", message: "Condition added successfully." }
  ];

  function revokePreviewObjectUrl() {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
    }
  }

  useEffect(() => {
    revokePreviewObjectUrl();
    setExistingImageUrl(resolveProductImageUrl(form));
    setSelectedImageFile(null);
    setPreviewImageUrl(null);
    setImageLoadFailed(false);
    setProductImage(null);
  }, [editingProductId, form.image_url]);

  useEffect(() => () => revokePreviewObjectUrl(), []);

  function handleImageChange(event) {
    const file = event.target.files?.[0] || null;
    revokePreviewObjectUrl();
    setSelectedImageFile(file);
    setProductImage(file);
    setImageLoadFailed(false);
    if (!file) {
      setPreviewImageUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    previewObjectUrlRef.current = objectUrl;
    setPreviewImageUrl(objectUrl);
  }

  async function createAndSelectOption(kind, formKey, name, successMessage) {
    const trimmedName = name.trim();
    const existing = optionExists(optionValues[kind], trimmedName);
    const selectedName = existing || (await createApparelOption(kind, trimmedName)).name;
    await refreshApparelOptions();
    setForm((current) => ({ ...current, [formKey]: selectedName }));
    showProductToast(successMessage);
    return selectedName;
  }

  async function resolveOtherOptions(baseForm = form) {
    const nextForm = { ...baseForm };
    const nextErrors = {};

    for (const config of optionConfigs) {
      if (nextForm[config.formKey] !== "Other") continue;
      const typedValue = String(otherValues[config.formKey] || "").trim();
      if (!typedValue) {
        nextErrors[config.formKey] = `Specify ${config.label} is required.`;
        continue;
      }
      const existing = optionExists(optionValues[config.kind], typedValue);
      if (existing) {
        nextForm[config.formKey] = existing;
        continue;
      }
      nextForm[config.formKey] = await createAndSelectOption(config.kind, config.formKey, typedValue, config.message);
    }

    setOtherErrors(nextErrors);
    if (Object.keys(nextErrors).length) return null;
    return nextForm;
  }

  async function removeOptionImmediately(option) {
    if (!option?.kind || !option?.id) return;
    const optionKey = `${option.kind}:${option.id}`;
    if (deletingOptionKeysRef.current.has(optionKey)) return;
    deletingOptionKeysRef.current.add(optionKey);
    setDeletingOptionKeys([...deletingOptionKeysRef.current]);
    try {
      await deleteApparelOption(option.kind, option.id);
      if (form[option.formKey] === option.name) {
        setForm((current) => ({ ...current, [option.formKey]: "" }));
      }
      await refreshApparelOptions();
      showProductToast(`${option.name} removed from reusable options.`);
    } catch {
      showProductToast("Could not remove option.", "error", "top-right");
    } finally {
      deletingOptionKeysRef.current.delete(optionKey);
      setDeletingOptionKeys([...deletingOptionKeysRef.current]);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const resolvedForm = await resolveOtherOptions(form);
    if (!resolvedForm) return;
    setForm(resolvedForm);
    await saveProduct(event, resolvedForm, selectedImageFile);
  }

  return (
    <motion.div
      className="retela-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <motion.section
        className="retela-modal-card modal-form bg-[#f8fbf9]"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apparel-editor-title"
      >
        <div className="retela-modal-header bg-[#f8fbf9]">
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Apparel Item</p>
              <h3 id="apparel-editor-title" className="mt-1 font-display text-xl font-bold text-[#17211b] sm:text-2xl">{editingProductId ? "Edit Apparel Item" : "Add Apparel Item"}</h3>
            </div>
            <button type="button" disabled={productSaving} onClick={onClose} className="retela-modal-close disabled:cursor-not-allowed disabled:opacity-60" aria-label="Close apparel editor">
              <X size={18} />
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="retela-modal-body">
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
          <input className={inputClass} placeholder="Apparel Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {optionConfigs.slice(0, 5).map((config) => (
            <ApparelOptionSelect
              key={config.formKey}
              label={config.inputLabel}
              value={form[config.formKey] || ""}
              options={optionMeta?.[config.kind] || []}
              placeholder={`Select ${config.label}`}
              customPlaceholder={config.placeholder}
              customValue={otherValues[config.formKey] || ""}
              customError={otherErrors[config.formKey]}
              onChange={(value) => {
                setForm({ ...form, [config.formKey]: value });
                setOtherErrors((errors) => ({ ...errors, [config.formKey]: "" }));
                if (value !== "Other") setOtherValues((current) => ({ ...current, [config.formKey]: "" }));
              }}
              onCustomChange={(value) => {
                setOtherValues((current) => ({ ...current, [config.formKey]: value }));
                setOtherErrors((errors) => ({ ...errors, [config.formKey]: "" }));
              }}
              deleteKeyPrefix={config.kind}
              deletingOptionKeys={deletingOptionKeys}
              onDeleteOption={(option) => removeOptionImmediately({ ...option, kind: config.kind, formKey: config.formKey })}
            />
          ))}
            <input className={inputClass} placeholder="Price" type="number" min="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <input className={inputClass} placeholder="Stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          {optionConfigs.slice(5).map((config) => (
            <ApparelOptionSelect
              key={config.formKey}
              label={config.inputLabel}
              value={form[config.formKey] || ""}
              options={optionMeta?.[config.kind] || []}
              placeholder={`Select ${config.label}`}
              customPlaceholder={config.placeholder}
              customValue={otherValues[config.formKey] || ""}
              customError={otherErrors[config.formKey]}
              onChange={(value) => {
                setForm({ ...form, [config.formKey]: value });
                setOtherErrors((errors) => ({ ...errors, [config.formKey]: "" }));
                if (value !== "Other") setOtherValues((current) => ({ ...current, [config.formKey]: "" }));
              }}
              onCustomChange={(value) => {
                setOtherValues((current) => ({ ...current, [config.formKey]: value }));
                setOtherErrors((errors) => ({ ...errors, [config.formKey]: "" }));
              }}
              deleteKeyPrefix={config.kind}
              deletingOptionKeys={deletingOptionKeys}
              onDeleteOption={(option) => removeOptionImmediately({ ...option, kind: config.kind, formKey: config.formKey })}
            />
          ))}
          <div className="grid gap-2">
            <span className="text-xs font-bold text-slate-700">{editingProductId ? "Current image" : "Apparel image"}</span>
            <div className="grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-stretch md:grid-cols-1">
              <div className="h-[160px] w-full overflow-hidden rounded-[14px] border border-[#d7e3db] bg-white">
                {displayedImageUrl && !imageLoadFailed ? (
                  <img
                    src={displayedImageUrl}
                    className="h-full w-full object-cover"
                    alt={`${form.name || "Apparel"} preview`}
                    onError={() => setImageLoadFailed(true)}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-center text-xs font-bold text-slate-400">No image</div>
                )}
              </div>
              <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#58c998] bg-[#effcf5] p-3 text-sm font-bold text-[#087a55] transition hover:bg-emerald-100 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#20b66a]">
                <Upload size={17} />
                {selectedImageFile ? selectedImageFile.name : "Browse apparel image"}
                <input className="hidden" type="file" accept="image/*" onChange={handleImageChange} aria-label="Browse apparel image" />
              </label>
            </div>
          </div>
          <textarea className={`${inputClass} h-auto min-h-[120px] max-h-[220px] resize-y md:col-span-2`} placeholder="Apparel description, fit notes, flaws, fabric, or styling details" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="sticky bottom-0 -mx-[22px] mt-1 grid gap-3 border-t border-[#dce8e0] bg-[#f8fbf9] px-[22px] pb-1 pt-3 md:col-span-2 sm:flex sm:justify-end">
            <button type="button" disabled={productSaving} className={`${secondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={productSaving} className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}>
              {productSaving ? <Loader2 className="animate-spin" size={17} /> : editingProductId ? <Save size={17} /> : <PackagePlus size={17} />}
              {productSaving ? "Saving..." : editingProductId ? "Save Apparel Item" : "Add Apparel Item"}
            </button>
          </div>
          </div>
        </form>
      </motion.section>
    </motion.div>
  );
}

function ApparelOptionSelect({ label, value, options = [], placeholder, customPlaceholder, customValue, customError, deleteKeyPrefix = "", deletingOptionKeys = [], onChange = () => {}, onCustomChange = () => {}, onDeleteOption }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const safeOptions = Array.isArray(options) ? options : [];
  const selected = safeOptions.find((option) => option?.name === value || option?.value === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative grid gap-1">
      <button
        type="button"
        className="flex h-12 min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[#cfded4] bg-white px-3 py-2 text-left text-sm font-semibold text-[#17211b] outline-none transition focus:border-[#20b66a] focus:ring-4 focus:ring-[rgba(32,182,106,0.18)]"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected || value ? "truncate" : "truncate text-[#8b9a91]"}>{selected?.name || value || placeholder}</span>
        <ChevronRight size={16} className={`shrink-0 text-emerald-700 transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[145] max-h-60 overflow-y-auto rounded-xl border border-[#cfded4] bg-white p-1 shadow-[0_18px_45px_rgba(15,23,42,0.18)]" role="listbox">
          <button type="button" className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-slate-400 transition hover:bg-emerald-50" onClick={() => { onChange(""); setOpen(false); }}>
            {placeholder}
          </button>
          {safeOptions.map((option) => {
            const optionName = String(option?.name || option?.value || "").trim();
            if (!optionName) return null;
            const custom = Boolean(option?.id) && option?.is_system !== true && optionName !== "Other" && typeof onDeleteOption === "function";
            const deleteKey = `${deleteKeyPrefix}:${option?.id}`;
            const deleting = custom && deletingOptionKeys.includes(deleteKey);
            return (
              <div
                key={`${option?.id || "system"}-${optionName}`}
                tabIndex={0}
                className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition ${value === optionName ? "bg-emerald-50 text-emerald-800" : "text-slate-700 hover:bg-emerald-50"}`}
                onClick={() => {
                  onChange(optionName);
                  setOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onChange(optionName);
                  setOpen(false);
                }}
                role="option"
                aria-selected={value === optionName}
              >
                <span className="min-w-0 flex-1 truncate">{optionName}</span>
                {custom ? (
                  <span
                    role="button"
                    tabIndex={deleting ? -1 : 0}
                    aria-label={`Remove ${optionName}`}
                    aria-disabled={deleting}
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition ${deleting ? "cursor-wait text-slate-300" : "text-slate-400 hover:bg-rose-50 hover:text-rose-600"}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (deleting) return;
                      onDeleteOption({ ...option, name: optionName });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (deleting) return;
                      onDeleteOption({ ...option, name: optionName });
                    }}
                  >
                    {deleting ? <Loader2 className="animate-spin" size={14} /> : <X size={14} />}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {value === "Other" ? (
        <OtherOptionInput
          label={customPlaceholder}
          placeholder={customPlaceholder}
          value={customValue}
          error={customError}
          onChange={onCustomChange}
        />
      ) : null}
    </div>
  );
}

function OtherOptionInput({ label, placeholder, value, error, onChange }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <input className="h-11 min-h-11 w-full rounded-xl border border-[#cfded4] bg-white px-3 py-2 text-sm font-semibold text-[#17211b] outline-none transition placeholder:text-[#8b9a91] focus:border-[#20b66a] focus:ring-4 focus:ring-[rgba(32,182,106,0.18)]" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required />
      {error ? <span className="text-xs font-bold text-rose-600">{error}</span> : null}
    </label>
  );
}

function normalizeInventoryProduct(product) {
  return {
    ...product,
    category: normalizeInventoryCategory(product.category),
    condition: normalizeCondition(product.condition),
    status: product.status || (Number(product.stock) <= 0 ? "Out of Stock" : Number(product.stock) <= 5 ? "Low Stock" : "In Stock")
  };
}

function normalizeInventoryCategory(category) {
  return String(category || "").trim() || "T-Shirts";
}

function normalizeCondition(condition) {
  return String(condition || "").trim() || "Good";
}

function stockByCategory(products, category) {
  return products.filter((product) => product.category === category).reduce((sum, product) => sum + Number(product.stock || 0), 0);
}

function ShoppingBagIcon(props) {
  return <PackageCheck {...props} />;
}

function buildDashboardMonthlyTrend(monthlySales = []) {
  const monthMap = new Map(
    (monthlySales || []).map((item) => [String(item.month || ""), Number(item.total || 0)])
  );
  const now = new Date();
  const rows = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    rows.push({
      key,
      month: date.toLocaleDateString(undefined, { month: "short" }),
      revenue: monthMap.get(key) ?? 0
    });
  }
  return rows;
}

function DashboardRevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-[#DDEFE5] bg-white px-4 py-3 text-[#111827] shadow-lg">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#14532D]">{label}</p>
      <p className="mt-2 text-sm font-bold text-[#111827]">{money(payload[0].value)}</p>
    </div>
  );
}

function FuturisticDashboard({ summary, products, orders, users, notifications, notificationsLoading = false, onChange, onNotificationClick }) {
  const totalRevenue = Number(summary?.sales?.total_sales || 0);
  const totalOrders = Number(summary?.sales?.order_count || orders.length || 0);
  const customerCount = users.filter((row) => row.status !== "rejected").length;
  const aiConversations = notifications.filter((row) => row.type === "message").length;
  const conversionRate = customerCount ? Math.min(100, Math.round((totalOrders / customerCount) * 100)) : 0;
  const monthlySales = summary?.monthlySales || [];
  const salesTrendRows = buildDashboardMonthlyTrend(monthlySales);
  const lowStockProducts = products.filter((product) => Number(product.stock) > 0 && Number(product.stock) <= 5);
  const stockTotal = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const cards = [
    { title: "Total Revenue", value: money(totalRevenue), hint: "Reportable sales", icon: TrendingUp, action: () => onChange("Sales Analytics") },
    { title: "Total Orders", value: totalOrders.toLocaleString(), hint: "Confirmed orders", icon: ReceiptText, action: () => onChange("Orders") },
    { title: "Total Customers", value: customerCount.toLocaleString(), hint: "Active customer base", icon: UsersIcon, action: () => onChange("Customers") },
    { title: "AI Conversations", value: aiConversations.toLocaleString(), hint: "Message events", icon: Bot, action: () => onChange("Messages") },
    { title: "Conversion Rate", value: `${conversionRate}%`, hint: "Orders per customer", icon: Zap, action: () => onChange("Sales Analytics") }
  ];
  const channelData = {
    labels: ["Orders", "Messages", "Feedback"],
    datasets: [{
      data: [orders.length, notifications.filter((row) => row.type === "message").length, notifications.filter((row) => row.type === "feedback").length],
      backgroundColor: ["#22C55E", "#38BDF8", "#F59E0B"],
      hoverBackgroundColor: ["#16A34A", "#0284C7", "#D97706"],
      borderColor: "#FFFFFF",
      borderWidth: 3,
      hoverOffset: 6,
      spacing: 2
    }]
  };

  return (
    <motion.div className="admin-dashboard-shell grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
      <section className="admin-dashboard-intro relative overflow-hidden rounded-2xl border border-[#DDEFE5] bg-white p-6 shadow-sm sm:p-8">
        <div className="relative max-w-3xl">
          <span className="admin-dashboard-kicker inline-flex items-center gap-2 rounded-full border border-[#DDEFE5] bg-[#DCFCE7] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#14532D]">
            <Sparkles size={15} /> RETELA
          </span>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-[#111827] sm:text-5xl">Commerce Admin Dashboard</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-500">Manage sales, customers, conversations, inventory signals, and daily ecommerce operations.</p>
        </div>
      </section>

      <div className="admin-dashboard-stats grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card, index) => <CommerceStatCard key={card.title} index={index} {...card} />)}
      </div>

      <div className="admin-dashboard-main-grid grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <ChartPanel title="Sales Overview" subtitle="Monthly database revenue trend" hasData={Boolean(salesTrendRows.length)} className="admin-sales-overview-panel">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesTrendRows} margin={{ top: 20, right: 18, left: -16, bottom: 8 }}>
              <defs>
                <linearGradient id="dashboardRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22C55E" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={70}
                tickFormatter={(value) => `PHP ${Number(value || 0).toLocaleString()}`}
              />
              <RechartsTooltip content={<DashboardRevenueTooltip />} cursor={{ stroke: "#22C55E", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#22C55E"
                strokeWidth={2}
                fill="url(#dashboardRevenueGradient)"
                dot={{ r: 3, fill: "#FFFFFF", stroke: "#22C55E", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: "#22C55E", stroke: "#ffffff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
        <NotificationPreviewPanel
          notifications={notifications}
          loading={notificationsLoading}
          title="Notifications"
          onViewAll={() => onChange("Notifications")}
          onNotificationClick={onNotificationClick}
          emptyTitle="No admin notifications yet"
          maxItems={3}
          className="admin-dashboard-notifications xl:sticky xl:top-24"
        />
      </div>

      <div className="admin-dashboard-secondary-grid grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <ChartPanel title="Top Channels" subtitle="Operational activity mix" hasData={orders.length || notifications.length} className="admin-top-channels-panel">
          <Doughnut data={channelData} options={{ ...chartMotion, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { color: "#111827", boxWidth: 12, padding: 16 } } } }} />
        </ChartPanel>
        <div className="admin-signal-grid grid gap-5 sm:grid-cols-2">
          <SignalWidget title="Recent Activity" icon={Activity} items={orders.slice(0, 3).map((order) => `Order #${order.id} is ${order.status}`)} empty="No recent orders yet." />
          <SignalWidget title="AI Performance" icon={Bot} items={[`${aiConversations} message notifications`, `${notifications.filter((row) => row.type === "feedback").length} feedback events`, "Assistant uses live inventory only"]} />
          <SignalWidget title="Inventory Overview" icon={PackageCheck} items={[`${products.length} apparel items`, `${stockTotal} total stock`, `${lowStockProducts.length} low stock alerts`]} />
          <SignalWidget title="System Status" icon={Zap} items={["API connected", "Realtime notifications enabled", "Inventory source: database"]} />
        </div>
      </div>

      <Card className="admin-low-stock-panel">
        <div className="admin-low-stock-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Low Stock Alerts</h2>
            <p className="mt-1 text-sm text-white/45">Only real inventory records are shown here.</p>
          </div>
          <button type="button" onClick={() => onChange("Inventory")} className="rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-4 py-2 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">View Inventory</button>
        </div>
        <div className="admin-low-stock-grid mt-4 grid gap-3 md:grid-cols-3">
          {lowStockProducts.length ? lowStockProducts.slice(0, 3).map((product) => (
            <div key={product.id} className="admin-low-stock-item rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <strong className="block truncate text-white">{product.name}</strong>
              <p className="mt-1 text-sm text-white/45">{product.category || "Apparel"} | {product.stock} left</p>
            </div>
          )) : <p className="text-sm text-white/50 md:col-span-3">No low-stock apparel right now.</p>}
        </div>
      </Card>
    </motion.div>
  );
}

function CommerceStatCard({ title, value, hint, icon: Icon, action, index }) {
  return (
    <motion.button type="button" onClick={action} className="admin-commerce-stat-card group rounded-[26px] border border-white/10 bg-white/[0.06] p-5 text-left shadow-2xl shadow-black/25 backdrop-blur-2xl transition duration-300 hover:border-neonbrand/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4, scale: 1.015 }} transition={{ duration: 0.35, delay: index * 0.04 }}>
      <span className="grid h-11 w-11 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)]">
        <Icon size={21} />
      </span>
      <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-white/42">{title}</p>
      <strong className="mt-2 block truncate font-display text-2xl font-bold text-white">{value}</strong>
      <span className="mt-2 block text-xs text-white/45">{hint}</span>
    </motion.button>
  );
}

function ChartPanel({ title, subtitle, hasData, children, className = "" }) {
  return (
    <Card className={`chart-3d-card admin-dashboard-chart-card ${className}`}>
      <div>
        <h2 className="font-display text-xl font-bold text-white">{title}</h2>
        <p className="mt-1 text-sm text-white/45">{subtitle}</p>
      </div>
      <div className="chart-stage mt-5 h-80">
        {hasData ? children : <EmptyState title="No data yet" subtitle="Charts will appear once real records are available." />}
      </div>
    </Card>
  );
}

function SignalWidget({ title, icon: Icon, items, empty }) {
  const visible = items.filter(Boolean);
  return (
    <Card className="admin-signal-widget">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-white">{title}</h3>
        <Icon size={20} className="text-neonbrand" />
      </div>
      <div className="mt-4 grid gap-2">
        {visible.length ? visible.map((item) => <p key={item} className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white/62">{item}</p>) : <p className="text-sm text-white/50">{empty}</p>}
      </div>
    </Card>
  );
}

function UsersIcon(props) {
  return <MessageSquare {...props} />;
}

function SalesAnalytics({ summary }) {
  const [trendPeriod, setTrendPeriod] = useState("day");
  const [reportRange, setReportRange] = useState(defaultReportOptions.dateRange);
  const [salesChannel, setSalesChannel] = useState("all");
  const [appliedDateOptions, setAppliedDateOptions] = useState({
    dateRange: defaultReportOptions.dateRange,
    startDate: defaultReportOptions.startDate,
    endDate: defaultReportOptions.endDate
  });
  const [customRange, setCustomRange] = useState({ startDate: "", endDate: "" });
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");
  const [reportOptions, setReportOptions] = useState(defaultReportOptions);
  const [reportAction, setReportAction] = useState(null);
  const [reportState, setReportState] = useState(null);
  const [reportMessage, setReportMessage] = useState("");
  const [barcodeProducts, setBarcodeProducts] = useState([]);
  const [salesBarcodeQuery, setSalesBarcodeQuery] = useState("");
  const salesChartRef = useRef(null);
  const paymentChartRef = useRef(null);
  const visibleSummary = analyticsSummary || summary || {};
  const currentDateReportOptions = useMemo(() => ({
    ...defaultReportOptions,
    ...reportOptions,
    dateRange: appliedDateOptions.dateRange,
    startDate: appliedDateOptions.startDate || "",
    endDate: appliedDateOptions.endDate || "",
    channel: salesChannel
  }), [reportOptions, appliedDateOptions, salesChannel]);
  const totalSales = Number(visibleSummary?.sales?.total_sales || 0);
  const totalOrders = Number(visibleSummary?.sales?.order_count || 0);
  const itemsSold = Number(visibleSummary?.sales?.items_sold || 0);
  const averageOrder = Number(visibleSummary?.sales?.average_order_value || 0);
  const averageRating = Number(visibleSummary?.ratings?.average_rating || 0);
  const reviewCount = Number(visibleSummary?.ratings?.review_count || 0);
  const dailySales = (visibleSummary?.dailySales || []).map((item) => ({
    label: item.day,
    total: Number(item.total || 0)
  }));
  const monthlySales = (visibleSummary?.monthlySales || []).map((item) => ({
    label: item.month,
    total: Number(item.total || 0)
  }));
  const trendRows = trendPeriod === "month" ? monthlySales : dailySales;
  const paymentMethodRows = visibleSummary?.paymentMethods || [];
  const paymentMethodTotal = paymentMethodRows.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const paymentColors = { cod: "#16A34A", cash: "#0EA5E9", gcash: "#F97316", online: "#F97316", debit: "#8B5CF6", credit: "#EC4899", maya: "#14B8A6" };
  const paymentMethodData = paymentMethodRows.map((row) => {
    const revenue = Number(row?.total || 0);
    return {
      key: row.payment_method,
      label: paymentLabel(row.payment_method),
      color: paymentColors[row.payment_method] || "#c4b5fd",
      value: paymentMethodTotal ? Math.round((revenue / paymentMethodTotal) * 100) : 0,
      revenue
    };
  });
  const topProducts = (visibleSummary?.bestProducts || []).map((product) => ({
    name: product.name,
    category: normalizeInventoryCategory(product.category),
    units: Number(product.sold || 0),
    revenue: Number(product.revenue || 0),
    imageUrl: resolveProductImageUrl(product)
  }));
  const channelBreakdownRows = (visibleSummary?.channelBreakdown || []).map((row) => ({
    key: row.order_channel || "online",
    label: row.order_channel === "pos" ? "PoS" : "Online Order",
    total: Number(row.total || 0),
    orders: Number(row.order_count || 0)
  }));
  const channelBreakdownTotal = channelBreakdownRows.reduce((sum, row) => sum + row.total, 0);
  const cards = [
    { title: "Total Sales", value: money(totalSales), change: "Live", caption: "database revenue", icon: TrendingUp, tone: "sales" },
    { title: "Average Order Value", value: money(averageOrder), change: "Live", caption: "per reportable order", icon: WalletCards, tone: "aov" },
    { title: "Items Sold", value: itemsSold.toLocaleString(), change: "Live", caption: "database quantities", icon: ShoppingBag, tone: "items" },
    { title: "Average Rating", value: averageRating.toFixed(1), change: `${reviewCount} reviews`, caption: "customer feedback", icon: Star, tone: "rating" }
  ];
  const hasAnalyticsData = totalOrders > 0
    || totalSales > 0
    || itemsSold > 0
    || reviewCount > 0
    || Number(visibleSummary?.inventory?.product_count || 0) > 0
    || topProducts.length > 0
    || dailySales.length > 0
    || monthlySales.length > 0
    || paymentMethodRows.length > 0;
  const chartData = {
    labels: trendRows.map((item) => item.label),
    datasets: [{
      label: trendPeriod === "month" ? "Monthly Sales" : "Daily Sales",
      data: trendRows.map((item) => item.total),
      ...glowingLineStyle,
      borderColor: "#2563EB",
      backgroundColor: "rgba(37, 99, 235, 0.10)",
      pointBorderColor: "#2563EB"
    }]
  };
  const chartOptions = {
    ...chartMotion,
    maintainAspectRatio: false,
    responsive: true,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: { color: "#64748b", boxWidth: 12, usePointStyle: true, pointStyle: "circle" }
      },
      tooltip: {
        backgroundColor: "#111827",
        borderColor: "#DDEFE5",
        borderWidth: 1,
        padding: 12,
        titleColor: "#ffffff",
        bodyColor: "#DCFCE7",
        callbacks: { label: (context) => `Sales: ${money(context.parsed.y)}` }
      }
    },
    scales: {
      x: { title: { display: true, text: trendPeriod === "month" ? "Month" : "Date", color: "#64748b" }, ticks: { color: "#64748b" }, grid: { color: "#EEF2F7" } },
      y: { title: { display: true, text: "Sales (PHP)", color: "#64748b" }, ticks: { color: "#64748b", callback: (value) => `PHP ${Number(value).toLocaleString()}` }, grid: { color: "#E5E7EB" } }
    }
  };
  const scannedSalesProduct = useMemo(() => findProductByBarcode(barcodeProducts.map(normalizeInventoryProduct), salesBarcodeQuery), [barcodeProducts, salesBarcodeQuery]);

  useEffect(() => {
    let cancelled = false;
    cachedGet("/products/inventory", {}, { cacheMs: 8000, retries: 1 })
      .then(({ data }) => {
        if (!cancelled) setBarcodeProducts(data);
      })
      .catch(() => {
        if (!cancelled) setBarcodeProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setAnalyticsLoading(true);
    setAnalyticsError("");
    cachedGet("/reports/summary", { params: reportOptionsParams({ ...defaultReportOptions, ...appliedDateOptions, channel: salesChannel }) }, { cacheMs: 8000, retries: 1 })
      .then(({ data }) => {
        if (alive) setAnalyticsSummary(data);
      })
      .catch((error) => {
        if (alive) setAnalyticsError(error?.response?.data?.message || error?.message || "Unable to load analytics for the selected period.");
      })
      .finally(() => {
        if (alive) setAnalyticsLoading(false);
      });
    return () => { alive = false; };
  }, [appliedDateOptions.dateRange, appliedDateOptions.startDate, appliedDateOptions.endDate, salesChannel]);

  useEffect(() => {
    setReportOptions((current) => ({
      ...current,
      dateRange: appliedDateOptions.dateRange,
      startDate: appliedDateOptions.startDate || "",
      endDate: appliedDateOptions.endDate || "",
      channel: salesChannel
    }));
  }, [appliedDateOptions.dateRange, appliedDateOptions.startDate, appliedDateOptions.endDate, salesChannel]);

  function handleDateRangeChange(value) {
    setReportRange(value);
    if (value === "custom") return;
    setAppliedDateOptions({ dateRange: value, startDate: "", endDate: "" });
  }

  function applyCustomDateRange() {
    if (!customRange.startDate || !customRange.endDate) return;
    setAppliedDateOptions({ dateRange: "custom", startDate: customRange.startDate, endDate: customRange.endDate });
  }

  function openReportOptions(action) {
    if (!hasAnalyticsData || analyticsLoading) return;
    setReportAction(action);
    setReportOptions((current) => ({
      ...defaultReportOptions,
      ...current,
      dateRange: appliedDateOptions.dateRange,
      startDate: appliedDateOptions.startDate || "",
      endDate: appliedDateOptions.endDate || "",
      channel: salesChannel
    }));
  }

  function closeReportOptions() {
    if (reportState === "loading") return;
    setReportAction(null);
  }

  async function handleExportPdf() {
    setReportState("loading");
    setReportMessage("Loading report data...");
    try {
      const report = await fetchSalesReport(currentDateReportOptions);
      await exportSalesReportPdf({ report, range: currentDateReportOptions.dateRange, options: currentDateReportOptions, chartRefs: { sales: salesChartRef, payment: paymentChartRef } });
      setReportState("success");
      setReportMessage("PDF report exported successfully.");
      setReportAction(null);
    } catch (error) {
      setReportState("error");
      setReportMessage(error?.message || "Unable to export PDF report.");
    }
  }

  async function handleExportExcel() {
    setReportState("loading");
    setReportMessage("Loading report data...");
    try {
      const report = await fetchSalesReport(currentDateReportOptions);
      exportSalesReportExcel({ report, range: currentDateReportOptions.dateRange, options: currentDateReportOptions });
      setReportState("success");
      setReportMessage("Excel report exported successfully.");
      setReportAction(null);
    } catch (error) {
      setReportState("error");
      setReportMessage(error?.message || "Unable to export Excel report.");
    }
  }

  async function handlePreviewReport() {
    let printWindow;
    setReportState("loading");
    setReportMessage("Loading report data...");
    try {
      printWindow = openPrintReportWindow();
      const report = await fetchSalesReport(currentDateReportOptions);
      await previewSalesReport(report, currentDateReportOptions, printWindow, { sales: salesChartRef, payment: paymentChartRef });
      setReportState("success");
      setReportMessage("Print preview opened successfully.");
    } catch (error) {
      writePrintReportError(printWindow, error?.message || "Unable to load report data.");
      setReportState("error");
      setReportMessage(error?.message || "Unable to preview report.");
    }
  }

  async function handlePrintReport() {
    let printWindow;
    setReportState("loading");
    setReportMessage("Loading report data...");
    try {
      printWindow = openPrintReportWindow();
      const report = await fetchSalesReport(currentDateReportOptions);
      await printSalesReport(report, currentDateReportOptions, printWindow, { sales: salesChartRef, payment: paymentChartRef });
      setReportState("success");
      setReportMessage("Print report opened successfully.");
      setReportAction(null);
    } catch (error) {
      writePrintReportError(printWindow, error?.message || "Unable to load report data.");
      setReportState("error");
      setReportMessage(error?.message || "Unable to print report.");
    }
  }

  const exportDisabled = analyticsLoading || reportState === "loading" || !hasAnalyticsData;
  const customRangeReady = Boolean(customRange.startDate && customRange.endDate);

  return (
    <motion.div className="sales-analytics-page grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
      <section className="sales-analytics-toolbar">
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="sales-analytics-eyebrow">RETELA SYSTEM - Tela to Pera Thrift Shop</p>
            <h1>Apparel Analytics</h1>
            <p>Track apparel sales, inventory trends, low stock, and revenue.</p>
          </div>
          <div className="sales-analytics-controls">
            <div className="sales-filter-row">
              <select value={reportRange} onChange={(event) => handleDateRangeChange(event.target.value)} className="sales-date-select">
                {reportRanges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
              </select>
              <div className="sales-channel-tabs" role="tablist" aria-label="Sales channel">
                {[
                  { value: "all", label: "All Sales" },
                  { value: "pos", label: "PoS" },
                  { value: "online", label: "Online Order" }
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={salesChannel === option.value}
                    onClick={() => setSalesChannel(option.value)}
                    className={salesChannel === option.value ? "is-active" : ""}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {reportRange === "custom" ? (
              <div className="sales-custom-range">
                <input type="date" value={customRange.startDate} onChange={(event) => setCustomRange((current) => ({ ...current, startDate: event.target.value }))} aria-label="Start Date" />
                <input type="date" value={customRange.endDate} onChange={(event) => setCustomRange((current) => ({ ...current, endDate: event.target.value }))} aria-label="End Date" />
                <button type="button" disabled={!customRangeReady || analyticsLoading} onClick={applyCustomDateRange}>Apply</button>
              </div>
            ) : null}
            <div className="sales-export-row">
              <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("pdf")}>
                <Download size={16} />
                Export PDF
              </button>
              <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("excel")}>
                <FileSpreadsheet size={16} />
                Export Excel
              </button>
              <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("print")}>
                <Printer size={16} />
                Print Report
              </button>
            </div>
          </div>
        </div>
      </section>

      {analyticsLoading ? (
        <Card>
          <div className="flex items-center gap-3 text-sm font-semibold text-white/70">
            <Loader2 className="animate-spin text-neonbrand" size={18} />
            Loading analytics for {reportDateRangeLabel(appliedDateOptions)}...
          </div>
        </Card>
      ) : null}

      {analyticsError ? (
        <Card>
          <p className="text-sm font-semibold text-rose-200">{analyticsError}</p>
        </Card>
      ) : null}

      {!analyticsLoading && !hasAnalyticsData ? (
        <Card>
          <p className="text-sm font-semibold text-white/70">No analytics available for the selected period.</p>
        </Card>
      ) : null}

      <BarcodeScannerPanel
        title="Sales Barcode Scanner"
        value={salesBarcodeQuery}
        onChange={setSalesBarcodeQuery}
        product={scannedSalesProduct}
        onPrint={printProductBarcode}
        compact
      />

      <div className="analytics-stats-grid grid gap-4 overflow-x-auto pb-2">
        {cards.map((card, index) => <SalesMetricCard key={card.title} index={index} {...card} />)}
      </div>

      <Card className="analytics-reports-card">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Apparel Reports</h2>
            <p className="mt-1 text-sm text-white/45">Available Reports: Apparel Sales Report, Inventory Report, Orders Report, Customer Report, Returns Report.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold text-neonbrand">
            <span className="rounded-full border border-neonbrand/20 bg-neonbrand/10 px-3 py-2">Print Report</span>
            <span className="rounded-full border border-neonbrand/20 bg-neonbrand/10 px-3 py-2">Export PDF</span>
            <span className="rounded-full border border-neonbrand/20 bg-neonbrand/10 px-3 py-2">Export Excel</span>
          </div>
        </div>
      </Card>

      <div className="analytics-primary-grid">
        <div ref={salesChartRef} className="min-w-0">
        <Card className="chart-3d-card analytics-chart-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-white">Sales Trends</h2>
              <p className="mt-1 text-sm text-white/45">Live order revenue from the system database.</p>
            </div>
            <div className="inline-flex rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-1">
              {["day", "month"].map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setTrendPeriod(period)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold uppercase transition ${trendPeriod === period ? "bg-neonbrand text-black" : "text-neonbrand hover:bg-neonbrand/10"}`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-stage sales-trends-stage">
            {trendRows.length ? <Line data={chartData} options={chartOptions} /> : <EmptyState title="No sales yet" subtitle="Live orders from the database will populate the sales trend." />}
          </div>
        </Card>
        </div>
        <div ref={paymentChartRef} className="min-w-0">
          <AnalyticsDonutCard title="Revenue Overview" data={paymentMethodData} icon={Tags} total={paymentMethodTotal} className="analytics-revenue-card" compact />
        </div>
      </div>

      <Card className="sales-channel-card">
        <div className="sales-section-heading">
          <div>
            <h2>Sales Channels</h2>
            <p>Revenue by source, separate from payment method.</p>
          </div>
          <Tags size={20} />
        </div>
        <div className="sales-channel-breakdown">
          {channelBreakdownRows.length ? channelBreakdownRows.map((row) => (
            <div key={row.key} className="sales-channel-row">
              <span>{row.label}</span>
              <div>
                <strong>{money(row.total)}</strong>
                <small>{row.orders} orders</small>
              </div>
              <progress value={channelBreakdownTotal ? row.total : 0} max={channelBreakdownTotal || 1} />
            </div>
          )) : <p className="sales-empty-inline">No channel sales for this filter.</p>}
        </div>
      </Card>

      <div className="analytics-lower-grid">
        <Card className="analytics-top-products-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-white">Top Selling Apparel</h2>
              <p className="mt-1 text-sm text-white/45">Best-performing thrift pieces by revenue.</p>
            </div>
            <Shirt className="text-neonbrand" size={22} />
          </div>
          <div className="grid gap-3">
            {topProducts.length ? topProducts.map((product, index) => (
              <motion.article key={product.name} className="analytics-product-row flex min-w-0 items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition hover:border-neonbrand/25 hover:bg-neonbrand/[0.055]" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, delay: index * 0.04 }}>
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-[10px] font-bold text-white/35">No Image</div>}
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-white">{product.name}</strong>
                  <span className="mt-1 block text-xs text-white/45">{product.category || "Apparel"}</span>
                </div>
                <div className="text-right">
                  <strong className="block text-white">{product.units} sold</strong>
                  <span className="mt-1 block text-xs font-bold text-neonbrand">{money(product.revenue)}</span>
                </div>
              </motion.article>
            )) : <EmptyState title="No best sellers yet" subtitle="Orders from your real apparel items will appear here." />}
          </div>
        </Card>

        <div className="analytics-side-stack">
          <Card className="analytics-monthly-card">
            <h2 className="font-display text-xl font-bold text-white">Monthly Sales</h2>
            <p className="mt-1 text-sm text-white/45">Live sales grouped by month.</p>
            <div className="mt-4 grid gap-3">
              {monthlySales.length ? monthlySales.slice(-6).map((item) => (
                <div key={item.label} className="analytics-month-row flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
                  <span className="text-sm font-semibold text-white/72">{item.label}</span>
                  <strong className="text-sm text-neonbrand">{money(item.total)}</strong>
                </div>
              )) : <EmptyState title="No monthly sales yet" subtitle="Live orders will appear here by month." />}
            </div>
          </Card>
          <Card className="analytics-summary-card">
            <h2 className="font-display text-xl font-bold text-white">Sales Summary</h2>
            <div className="mt-4 grid gap-3">
              <SummaryRow label="Gross Sales" value={money(totalSales)} positive />
              <SummaryRow label="Total Orders" value={totalOrders.toLocaleString()} positive />
              <SummaryRow label="Average Order Value" value={money(averageOrder)} positive />
              <SummaryRow label="Items Sold" value={itemsSold.toLocaleString()} positive />
              <div className="mt-1 border-t border-white/10 pt-3">
                <SummaryRow label="Net Sales" value={money(totalSales)} positive strong />
              </div>
            </div>
          </Card>
        </div>
      </div>
      <AnalyticsPrintOptionsModal
        open={Boolean(reportAction)}
        title={reportAction === "pdf" ? "Export PDF" : reportAction === "excel" ? "Export Excel" : "Print Analytics Report"}
        primaryLabel={reportAction === "pdf" ? "Export PDF" : reportAction === "excel" ? "Export Excel" : "Print"}
        options={currentDateReportOptions}
        busy={reportState === "loading"}
        onClose={closeReportOptions}
        onChange={setReportOptions}
        onPreview={handlePreviewReport}
        onPrimary={reportAction === "pdf" ? handleExportPdf : reportAction === "excel" ? handleExportExcel : handlePrintReport}
      />
      <AnalyticsReportModal state={reportState} message={reportMessage} onClose={() => setReportState(null)} />
    </motion.div>
  );
}

function SalesMetricCard({ title, value, change, caption, icon: Icon, index, tone = "sales" }) {
  return (
    <motion.article className={`metric-card sales-metric-card is-${tone}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -3, scale: 1.01 }} transition={{ duration: 0.28, delay: index * 0.04 }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p>{title}</p>
          <strong className="metric-value block font-display font-bold">{value}</strong>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="sales-metric-chip">{change}</span>
            <span className="sales-metric-caption">{caption}</span>
          </div>
        </div>
        <span className="sales-metric-icon">
          <Icon size={23} />
        </span>
      </div>
    </motion.article>
  );
}

function AnalyticsDonutCard({ title, data, icon: Icon, compact, total = 0, className = "" }) {
  const hasSales = data.some((item) => Number(item.value || 0) > 0);
  const chart = {
    labels: data.map((item) => item.label),
    datasets: [{
      data: data.map((item) => item.value),
      backgroundColor: data.map((item) => item.color),
      hoverBackgroundColor: data.map((item) => item.color),
      borderColor: "#ffffff",
      borderWidth: 3,
      hoverOffset: 8,
      spacing: 2
    }]
  };
  return (
    <Card className={`chart-3d-card ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[#123526]">{title}</h2>
          <p className="mt-1 text-sm text-[#557166]">Revenue distribution by payment method.</p>
        </div>
        <Icon className="text-[#16a36a]" size={22} />
      </div>
      <div className={`chart-stage analytics-donut-stage mx-auto mt-4 ${compact ? "h-48" : "h-64"} max-w-sm`}>
        {hasSales ? <Doughnut data={chart} options={{ ...chartMotion, cutout: "68%", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(5,5,5,0.92)", callbacks: { label: (context) => `${context.label}: ${context.parsed}%` } } } }} /> : <EmptyState title="No payment sales yet" subtitle="Orders from the database will populate this chart." />}
        {hasSales ? (
          <div className="analytics-donut-total" aria-hidden="true">
            <strong>{money(total)}</strong>
            <span>Total</span>
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3">
        {data.map((item) => (
          <div key={item.label} className="analytics-donut-legend-row">
            <span><span style={{ backgroundColor: item.color }} />{item.label}</span>
            <strong>{item.value}% <small>{money(item.revenue)}</small></strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SummaryRow({ label, value, positive, strong }) {
  return (
    <div className="sales-summary-row">
      <span className={strong ? "is-strong" : ""}>{label}</span>
      <strong className={`${positive ? "is-positive" : "is-negative"} ${strong ? "is-strong" : ""}`}>{value}</strong>
    </div>
  );
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function productSku(product) {
  return product?.sku || product?.barcode || "Barcode unavailable";
}

function barcodePattern(value) {
  const text = String(value || "").toUpperCase();
  const bits = [1, 0, 1, 0, 1, 0];
  Array.from(text).forEach((char) => {
    const code = char.charCodeAt(0);
    for (let index = 0; index < 7; index += 1) bits.push((code >> index) & 1);
    bits.push(0, 1);
  });
  bits.push(1, 0, 1, 0, 1);
  return bits;
}

function BarcodeSvg({ value, compact = false }) {
  if (!value || value === "Barcode unavailable") {
    return (
      <div className="grid h-full w-full place-items-center rounded-md bg-white text-center text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
        Barcode unavailable
      </div>
    );
  }
  const bits = barcodePattern(value);
  const barWidth = compact ? 2 : 3;
  const height = compact ? 38 : 56;
  const width = bits.length * barWidth;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={`Barcode ${value}`} preserveAspectRatio="none">
      <rect width={width} height={height} rx="6" fill="#ffffff" />
      {bits.map((bit, index) => bit ? <rect key={index} x={index * barWidth} y={compact ? 7 : 10} width={barWidth} height={compact ? 24 : 34} fill="#111827" /> : null)}
    </svg>
  );
}

function barcodeSvgMarkup(value) {
  const safeValue = escapePrintHtml(value);
  if (!value || value === "Barcode unavailable") {
    return `<div style="display:grid;place-items:center;width:360px;height:118px;border:1px solid #d1d5db;border-radius:10px;color:#6b7280;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">${safeValue}</div>`;
  }
  const bits = barcodePattern(value);
  const barWidth = 3;
  const height = 74;
  const width = bits.length * barWidth;
  const bars = bits.map((bit, index) => bit ? `<rect x="${index * barWidth}" y="12" width="${barWidth}" height="42" fill="#111827" />` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="360" height="118" role="img" aria-label="Barcode ${safeValue}"><rect width="${width}" height="${height}" rx="8" fill="#ffffff" />${bars}<text x="${width / 2}" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#111827">${safeValue}</text></svg>`;
}

function escapePrintHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function printProductBarcode(product) {
  const sku = productSku(product);
  const name = escapePrintHtml(product?.name || "RETELA Product");
  const category = escapePrintHtml(product?.category || "Apparel");
  const size = escapePrintHtml(product?.size || "Free Size");
  const status = escapePrintHtml(product?.status || "In Stock");
  const printWindow = window.open("", "_blank", "width=520,height=620");
  if (!printWindow) return;
  printWindow.document.write(`
    <html>
      <head>
        <title>${sku} Barcode</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 28px; color: #102018; }
          .sheet { border: 1px solid #DDEFE5; border-radius: 18px; padding: 22px; text-align: center; }
          h1 { margin: 0 0 6px; font-size: 22px; }
          p { margin: 4px 0; color: #4b6356; }
          .sku { margin-top: 14px; font-size: 18px; font-weight: 800; letter-spacing: 0.08em; color: #14532D; }
          .meta { margin-top: 12px; font-size: 14px; }
          @media print { body { padding: 0; } .sheet { border: 0; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <h1>${name}</h1>
          <p>${category} | ${size}</p>
          ${barcodeSvgMarkup(sku)}
          <div class="sku">${sku}</div>
          <div class="meta">PHP ${Number(product?.price || 0).toLocaleString()} | Stock: ${Number(product?.stock || 0)} | ${status}</div>
        </div>
        <script>window.onload = () => { window.print(); window.setTimeout(() => window.close(), 300); };</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printProductBarcodes(products) {
  const selectedProducts = products.filter(Boolean);
  if (!selectedProducts.length) return;
  const labels = selectedProducts.map((product) => {
    const sku = productSku(product);
    const name = escapePrintHtml(product?.name || "RETELA Product");
    const brand = escapePrintHtml(product?.brand || "Other");
    return `
      <section class="label">
        <div class="name">${name}</div>
        <div class="brand">${brand}</div>
        <div class="barcode">${barcodeSvgMarkup(sku)}</div>
        <div class="sku">${escapePrintHtml(sku)}</div>
      </section>
    `;
  }).join("");
  const printWindow = window.open("", "_blank", "width=980,height=760");
  if (!printWindow) return;
  printWindow.document.write(`
    <html>
      <head>
        <title>RETELA Barcode Labels</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #102018; background: #ffffff; }
          .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8mm 5mm; padding: 0; }
          .label { min-height: 43mm; break-inside: avoid; page-break-inside: avoid; border: 1px solid #CFEBDD; border-radius: 10px; padding: 5mm 4mm; text-align: center; }
          .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 800; color: #102018; }
          .brand { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; font-weight: 700; color: #527062; }
          .barcode { margin-top: 3mm; height: 20mm; overflow: hidden; }
          .barcode svg { width: 100%; height: 100%; }
          .sku { margin-top: 2mm; font-size: 10px; font-weight: 900; letter-spacing: 0.06em; color: #14532D; }
          @media screen { body { padding: 16px; background: #EEF7F1; } .sheet { max-width: 210mm; margin: 0 auto; padding: 10mm; background: white; box-shadow: 0 18px 60px rgba(16,32,24,0.16); } }
        </style>
      </head>
      <body>
        <main class="sheet">${labels}</main>
        <script>window.onload = () => { window.print(); window.setTimeout(() => window.close(), 400); };</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function findProductByBarcode(products, value) {
  const queryText = String(value || "").trim().toLowerCase();
  if (!queryText) return null;
  return products.find((product) => productSku(product).toLowerCase() === queryText) || null;
}

function paymentLabel(method) {
  if (method === "cash") return "Cash";
  if (method === "gcash") return "GCash";
  if (method === "debit") return "Debit Card";
  if (method === "credit") return "Credit Card";
  if (method === "maya") return "Maya";
  return "COD";
}

function OrderManagement({ rows, updateOrder, onNavigate }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrderId, setLoadingOrderId] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFilters, setOrderFilters] = useState({ status: "all", payment: "all", fulfillment: "all", date: "all" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orderPage, setOrderPage] = useState(1);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      return;
    }
    let alive = true;
    setLoadingOrderId(selectedOrderId);
    api.get(`/orders/${selectedOrderId}/items`)
      .then(({ data }) => {
        if (alive) {
          setSelectedOrder(data);
          setTrackingNumber(data.order.tracking_number || "");
        }
      })
      .catch(() => {
        if (alive) setSelectedOrder(null);
      })
      .finally(() => {
        if (alive) setLoadingOrderId(null);
      });
    return () => { alive = false; };
  }, [selectedOrderId, reloadToken]);

  const onlineOrders = rows.filter((row) => String(row.order_channel || "online").toLowerCase() !== "pos");
  const filteredOrders = onlineOrders.map((row, index) => ({
    id: row.id,
    order_no: `Order #${row.id}`,
    list_no: onlineOrders.length - index,
    customer: row.username || "Walk-in Customer",
    status: orderStatusLabel(displayFulfillmentStatus(row)),
    status_key: displayFulfillmentStatus(row),
    total: money(row.total_amount),
    payment: paymentLabel(row.payment_method),
    payment_key: row.payment_method,
    fulfillment: row.fulfillment_method === "pickup" ? "Pick up" : "Delivery",
    fulfillment_key: row.fulfillment_method || "delivery",
    items: row.item_count || 0,
    tracking: row.tracking_number || "Not set",
    created_at: row.created_at
  })).filter((row) => {
    const search = orderSearch.trim().toLowerCase();
    const text = `${row.id} ${row.order_no} ${row.list_no} ${row.customer} ${row.payment} ${row.tracking}`.toLowerCase();
    const matchesSearch = !search || text.includes(search);
    const matchesStatus = orderFilters.status === "all" || row.status_key === orderFilters.status;
    const matchesPayment = orderFilters.payment === "all" || row.payment_key === orderFilters.payment;
    const matchesFulfillment = orderFilters.fulfillment === "all" || row.fulfillment_key === orderFilters.fulfillment;
    const matchesDate = orderFilters.date === "all" || isOrderInDateRange(row.created_at, orderFilters.date);
    return matchesSearch && matchesStatus && matchesPayment && matchesFulfillment && matchesDate;
  });
  const ordersPerPage = 8;
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / ordersPerPage));
  const currentPage = Math.min(orderPage, pageCount);
  const visible = filteredOrders.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);
  const activeFilterCount = Object.values(orderFilters).filter((value) => value !== "all").length + (orderSearch.trim() ? 1 : 0);

  useEffect(() => {
    setOrderPage(1);
  }, [orderSearch, orderFilters.status, orderFilters.payment, orderFilters.fulfillment, orderFilters.date, onlineOrders.length]);

  function updateOrderFilter(key, value) {
    setOrderFilters((filters) => ({ ...filters, [key]: value }));
  }

  function clearOrderFilters() {
    setOrderSearch("");
    setOrderFilters({ status: "all", payment: "all", fulfillment: "all", date: "all" });
    setFiltersOpen(false);
  }

  useEffect(() => {
    if (!selectedOrderId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    document.body.style.overflow = "hidden";
    document.body.classList.add("retela-modal-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.body.classList.remove("retela-modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedOrderId]);

  async function saveTracking() {
    if (!selectedOrder?.order?.id) return;
    await api.patch(`/orders/${selectedOrder.order.id}/tracking`, { tracking_number: trackingNumber });
    setReloadToken((value) => value + 1);
  }

  return (
    <div className="admin-orders-page grid gap-4">
      <Card className="admin-orders-header-card">
        <div className="admin-orders-header">
          <div>
            <p>Order Management</p>
            <h3>Orders</h3>
          </div>
          <span>Showing {filteredOrders.length} of {onlineOrders.length} orders</span>
        </div>
      </Card>
      <section className="admin-orders-filter-card">
        <div className="orders-toolbar">
          <Field icon={Search} placeholder="Search customer, order ID, payment, or tracking" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} wrapperClassName="admin-orders-search" />
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="orders-filter-btn" aria-expanded={filtersOpen} aria-controls="orders-filter-panel">
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount ? <span>{activeFilterCount}</span> : null}
          </button>
        </div>
        <div id="orders-filter-panel" className={`admin-orders-filter-grid ${filtersOpen ? "is-open" : ""}`}>
          <OrderFilterSelect label="Status" value={orderFilters.status} onChange={(value) => updateOrderFilter("status", value)} options={[
            ["all", "All"],
            ["pending", "Pending"],
            ["approved", "Accepted"],
            ["awaiting_payment", "Awaiting Payment"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"]
          ]} />
          <OrderFilterSelect label="Payment" value={orderFilters.payment} onChange={(value) => updateOrderFilter("payment", value)} options={[
            ["all", "All"],
            ["cash", "Cash"],
            ["cod", "COD"],
            ["gcash", "GCash"],
            ["debit", "Debit Card"]
          ]} />
          <OrderFilterSelect label="Fulfillment" value={orderFilters.fulfillment} onChange={(value) => updateOrderFilter("fulfillment", value)} options={[
            ["all", "All"],
            ["delivery", "Delivery"],
            ["pickup", "Pick up"]
          ]} />
          <OrderFilterSelect label="Date" value={orderFilters.date} onChange={(value) => updateOrderFilter("date", value)} options={[
            ["today", "Today"],
            ["week", "This Week"],
            ["month", "This Month"],
            ["all", "All"]
          ]} />
          <button type="button" onClick={clearOrderFilters} className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-[#DDEFE5] bg-white px-4 text-sm font-bold text-[#14532D] transition hover:bg-[#DCFCE7]">
            Clear Filters
          </button>
        </div>
      </section>
      <OrdersResponsiveView rows={visible} onViewDetails={setSelectedOrderId} />
      <OrdersPagination page={currentPage} pageCount={pageCount} onPageChange={setOrderPage} />
      <AnimatePresence>
        {selectedOrderId ? (
          <OrderDetailsModal
            loading={loadingOrderId}
            selectedOrder={selectedOrder}
            trackingNumber={trackingNumber}
            setTrackingNumber={setTrackingNumber}
            saveTracking={saveTracking}
            updateOrder={updateOrder}
            onStatusChanged={() => setReloadToken((value) => value + 1)}
            onMeetingPlaceSaved={(details) => {
              setSelectedOrder((current) => current?.order ? { ...current, order: { ...current.order, ...details } } : current);
              setReloadToken((value) => value + 1);
            }}
            onMessageCustomer={(order) => {
              localStorage.setItem("retela_admin_chat_context", JSON.stringify({
                customerId: Number(order.user_id),
                orderId: Number(order.id),
                context: `Conversation regarding Order #${order.id}`
              }));
              onNavigate?.("Messages");
            }}
            onClose={() => setSelectedOrderId(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function formatMeetupDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatMeetupTime(value) {
  if (!value) return "";
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return "";
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function OrdersResponsiveView({ rows, onViewDetails }) {
  if (!rows.length) {
    return (
      <Card className="admin-orders-list-card">
        <EmptyState title="No orders found" subtitle="Matching customer orders and POS sales will appear here." />
      </Card>
    );
  }

  return (
    <Card className="admin-orders-list-card">
      <div className="orders-desktop-view">
        <div className="orders-table-wrapper" role="region" aria-label="Orders table" tabIndex={0}>
          <table className="orders-table">
            <colgroup>
              <col className="orders-col-order" />
              <col className="orders-col-customer" />
              <col className="orders-col-status" />
              <col className="orders-col-total" />
              <col className="orders-col-payment" />
              <col className="orders-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Order No.</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong className="orders-order-number">{order.order_no}</strong>
                    <span className="orders-list-number">List #{order.list_no}</span>
                  </td>
                  <td className="orders-customer-cell">{order.customer}</td>
                  <td><OrderStatusBadge status={order.status_key} label={order.status} /></td>
                  <td className="orders-total-cell">{order.total}</td>
                  <td>{order.payment}</td>
                  <td><OrderDetailsButton order={order} onViewDetails={onViewDetails} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="orders-mobile-view">
        {rows.map((order) => (
          <article key={order.id} className="order-mobile-card">
            <div className="order-mobile-header">
              <div>
                <h3>{order.order_no}</h3>
                <span>List #{order.list_no}</span>
              </div>
              <OrderStatusBadge status={order.status_key} label={order.status} />
            </div>
            <div className="order-mobile-grid">
              <OrderInfoItem label="Customer" value={order.customer} />
              <OrderInfoItem label="Status" value={<OrderStatusBadge status={order.status_key} label={order.status} />} />
              <OrderInfoItem label="Total" value={order.total} strong />
              <OrderInfoItem label="Payment" value={order.payment} />
            </div>
            <div className="order-mobile-actions">
              <OrderDetailsButton order={order} onViewDetails={onViewDetails} />
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}

function OrderInfoItem({ label, value, strong = false }) {
  return (
    <div className="order-mobile-field">
      <span>{label}</span>
      <strong className={strong ? "is-strong" : ""}>{value}</strong>
    </div>
  );
}

function OrderDetailsButton({ order, onViewDetails }) {
  return (
    <button type="button" onClick={() => onViewDetails(order.id)} className="order-details-btn" aria-label={`View details for ${order.order_no}`}>
      <Eye size={16} />
      Details
    </button>
  );
}

function OrderStatusBadge({ status, label }) {
  return (
    <span className={`order-status-badge is-${status || "pending"}`}>
      {label || orderStatusLabel(status)}
    </span>
  );
}

function OrdersPagination({ page, pageCount, onPageChange }) {
  return (
    <nav className="orders-pagination" aria-label="Orders pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} aria-label="Previous orders page">
        <ChevronLeft size={16} />
      </button>
      <span>{page} of {pageCount}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} aria-label="Next orders page">
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

function OrderFilterSelect({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1">
      <span className="px-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <select
        className="min-h-12 rounded-2xl border border-[#DDEFE5] bg-white px-3 text-sm font-semibold text-[#111827] outline-none transition focus:border-[#22C55E] focus:ring-4 focus:ring-[#DCFCE7]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function isOrderInDateRange(dateValue, range) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfOrderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (range === "today") {
    return startOfOrderDay.getTime() === startOfToday.getTime();
  }
  if (range === "week") {
    const day = startOfToday.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() + mondayOffset);
    const startOfNextWeek = new Date(startOfWeek);
    startOfNextWeek.setDate(startOfWeek.getDate() + 7);
    return date >= startOfWeek && date < startOfNextWeek;
  }
  if (range === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  return true;
}

function OrderDetailsModal({ loading, selectedOrder, trackingNumber, setTrackingNumber, saveTracking, updateOrder, onStatusChanged, onMeetingPlaceSaved, onMessageCustomer, onClose }) {
  const source = selectedOrder?.order;
  const [meetingPlaceDraft, setMeetingPlaceDraft] = useState("");
  const [meetingLatitudeDraft, setMeetingLatitudeDraft] = useState(null);
  const [meetingLongitudeDraft, setMeetingLongitudeDraft] = useState(null);
  const [meetupDateDraft, setMeetupDateDraft] = useState("");
  const [meetupTimeDraft, setMeetupTimeDraft] = useState("");
  const [meetingPlaceSaving, setMeetingPlaceSaving] = useState(false);
  const [meetingPlaceError, setMeetingPlaceError] = useState("");
  const [deliverySafetyPolicy, setDeliverySafetyPolicy] = useState(defaultDeliverySafetyPolicy);

  useEffect(() => {
    setMeetingPlaceDraft(source?.meeting_place || "");
    setMeetingLatitudeDraft(source?.meeting_latitude == null ? null : Number(source.meeting_latitude));
    setMeetingLongitudeDraft(source?.meeting_longitude == null ? null : Number(source.meeting_longitude));
    setMeetupDateDraft(source?.meetup_date ? String(source.meetup_date).slice(0, 10) : "");
    setMeetupTimeDraft(source?.meetup_time ? String(source.meetup_time).slice(0, 5) : "");
    setMeetingPlaceError("");
  }, [source?.id, source?.meeting_place, source?.meeting_latitude, source?.meeting_longitude, source?.meetup_date, source?.meetup_time]);

  useEffect(() => {
    let active = true;
    cachedGet("/settings/public", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (active) setDeliverySafetyPolicy(String(data?.about?.deliverySafetyPolicy || defaultDeliverySafetyPolicy).trim() || defaultDeliverySafetyPolicy);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function updateStatus(status) {
    if (!source?.id) return;
    await updateOrder(source.id, status);
    onStatusChanged();
  }

  async function saveMeetingPlace() {
    if (!source?.id || meetingPlaceSaving) return;
    setMeetingPlaceSaving(true);
    setMeetingPlaceError("");
    try {
      const { data } = await api.patch(`/orders/${source.id}/meeting-place`, {
        meetingPlace: meetingPlaceDraft,
        meetingLatitude: meetingLatitudeDraft,
        meetingLongitude: meetingLongitudeDraft,
        meetupDate: meetupDateDraft,
        meetupTime: meetupTimeDraft
      });
      onMeetingPlaceSaved?.({
        meeting_place: data.meeting_place || null,
        meeting_latitude: data.meeting_latitude ?? null,
        meeting_longitude: data.meeting_longitude ?? null,
        meetup_date: data.meetup_date || null,
        meetup_time: data.meetup_time || null
      });
    } catch (error) {
      setMeetingPlaceError(getApiErrorMessage(error, "Could not save meeting place."));
    } finally {
      setMeetingPlaceSaving(false);
    }
  }

  return (
    <motion.div className="retela-modal-backdrop z-[120] p-3 sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="retela-modal-card admin-order-details-modal max-h-[88vh] w-[min(92vw,900px)] max-w-none bg-white text-[#111827]" initial={{ opacity: 0, scale: 0.94, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 18 }} transition={{ duration: 0.22, ease: "easeOut" }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-order-details-title">
          {loading ? (
            <div className="retela-modal-body grid gap-4">
              <div className="skeleton h-8 w-1/2 rounded-2xl" />
              <div className="skeleton h-24 rounded-3xl" />
              <div className="skeleton h-40 rounded-3xl" />
            </div>
          ) : source ? (
            <>
              <div className="retela-modal-header">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{source.order_channel === "pos" ? "POS Transaction" : "Customer Order"}</p>
                  <h3 id="admin-order-details-title" className="mt-2 font-display text-2xl font-bold text-[#111827]">Order #{source.id}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">{source.username || "Walk-in Customer"} | {new Date(source.created_at).toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-3 py-2 text-xs font-bold ${orderBadgeClass(displayFulfillmentStatus(source))}`}>{orderStatusLabel(displayFulfillmentStatus(source))}</span>
              </div>
              <div className="retela-modal-body grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <OrderSummaryCard label="Total" value={`PHP ${source.total_amount}`} />
                <OrderSummaryCard label="Items" value={selectedOrder.items.length} />
                <OrderSummaryCard label="Payment" value={`${paymentLabel(source.payment_method)} · ${paymentStatusLabel(source.payment_status)}`} />
              </div>
              <div className="rounded-2xl border border-[#dfe9e3] bg-[#f8faf9] p-4">
                <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Tracking Number</span>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input className="min-w-0 flex-1 rounded-xl border border-[#dfe9e3] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" placeholder="Enter tracking number" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                  <button type="button" onClick={saveTracking} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700">Save</button>
                </div>
              </div>
              {source.fulfillment_method === "delivery" ? <OrderDeliveryInfo order={source} title="Delivery Location" mapLabel="View Delivery Route" routeEnabled /> : null}
              {source.meetup_eligible ? <section className="admin-meeting-place-card">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Meeting Place</p>
                  <h4 className="mt-1 font-display text-lg font-bold text-[#111827]">Admin-selected meetup location</h4>
                </div>
                <textarea
                  value={meetingPlaceDraft}
                  onChange={(event) => setMeetingPlaceDraft(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Enter meeting place"
                  className="min-h-24 w-full resize-y rounded-2xl border border-[#dfe9e3] bg-white px-3 py-3 text-sm font-semibold text-[#111827] outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
                {source.delivery_latitude != null && source.delivery_longitude != null ? <div className="grid gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Select Meeting Location</p>
                  <MeetingLocationMap
                    customer={{ latitude: Number(source.delivery_latitude), longitude: Number(source.delivery_longitude) }}
                    meeting={meetingLatitudeDraft != null && meetingLongitudeDraft != null ? { latitude: meetingLatitudeDraft, longitude: meetingLongitudeDraft } : null}
                    onSelect={({ latitude, longitude }) => {
                      setMeetingLatitudeDraft(latitude);
                      setMeetingLongitudeDraft(longitude);
                    }}
                  />
                  <p className="break-words text-xs font-semibold text-slate-500">Selected location: {meetingLatitudeDraft != null && meetingLongitudeDraft != null ? `${meetingLatitudeDraft.toFixed(7)}, ${meetingLongitudeDraft.toFixed(7)}` : "Tap the map to choose a meeting point."}</p>
                </div> : <p className="text-xs font-semibold text-amber-700">Customer delivery coordinates are unavailable, so a meetup point cannot be selected on the map.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    <span>Meetup Date</span>
                    <input type="date" value={meetupDateDraft} onChange={(event) => setMeetupDateDraft(event.target.value)} className="min-h-11 rounded-xl border border-[#dfe9e3] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-slate-700">
                    <span>Meetup Time</span>
                    <input type="time" value={meetupTimeDraft} onChange={(event) => setMeetupTimeDraft(event.target.value)} className="min-h-11 rounded-xl border border-[#dfe9e3] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={meetingPlaceSaving} onClick={saveMeetingPlace} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {meetingPlaceSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Meetup Details
                  </button>
                  {source.meeting_place || source.meetup_date || source.meetup_time ? <span className="break-words text-xs font-semibold text-slate-500">Saved: {source.meeting_place || "No meeting place"}{source.meetup_date ? ` · ${formatMeetupDate(source.meetup_date)}` : ""}{source.meetup_time ? ` · ${formatMeetupTime(source.meetup_time)}` : ""}</span> : <span className="text-xs font-semibold text-slate-500">Meeting place and meetup schedule will be provided by the shop.</span>}
                </div>
                {meetingPlaceError ? <p className="text-xs font-bold text-rose-600">{meetingPlaceError}</p> : null}
              </section> : null}
              <section className="admin-delivery-safety-card">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Delivery & Meetup Safety</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{deliverySafetyPolicy}</p>
              </section>
              <div className="grid gap-3">
                {selectedOrder.items.map((item) => (
                  <div key={`${item.product_id}-${item.quantity}`} className="flex items-center gap-3 rounded-2xl border border-[#dfe9e3] bg-white p-3 shadow-sm transition hover:border-emerald-200">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-100">
                      <ProductImage src={item.image_url} className="h-full w-full object-cover" placeholderClassName="text-slate-400" alt={item.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[#111827]">{item.name}</strong>
                      <p className="mt-1 truncate text-sm font-medium text-slate-500">{item.brand || "Other Brands"} | {item.category} | {item.size}</p>
                      <p className="mt-2 text-sm font-bold text-emerald-700">Qty {item.quantity} x PHP {item.price}</p>
                    </div>
                  </div>
                ))}
              </div>
              </div>
              <div className="retela-modal-footer">
                <div className="flex w-full flex-wrap items-center gap-2">
                {source.user_id ? <button type="button" onClick={() => onMessageCustomer?.(source)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"><MessageSquare size={15} /> Message Customer</button> : null}
                <button disabled={!canAcceptOrder(source)} onClick={() => updateStatus("approved")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${canAcceptOrder(source) ? orderButtonClass("approved") : "bg-slate-100 text-slate-500"}`}>Accept</button>
                <button disabled={!["pending", "approved", "processing", "ready"].includes(displayFulfillmentStatus(source))} onClick={() => updateStatus("cancelled")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${["pending", "approved", "processing", "ready"].includes(displayFulfillmentStatus(source)) ? orderButtonClass("cancelled") : "bg-slate-100 text-slate-500"}`}>Reject</button>
                <button disabled={!["approved", "processing"].includes(displayFulfillmentStatus(source))} onClick={() => updateStatus("ready")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${["approved", "processing"].includes(displayFulfillmentStatus(source)) ? orderButtonClass("ready") : "bg-slate-100 text-slate-500"}`}>Out for Delivery</button>
                <button disabled={displayFulfillmentStatus(source) !== "ready"} onClick={() => updateStatus("completed")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${displayFulfillmentStatus(source) === "ready" ? orderButtonClass("completed") : "bg-slate-100 text-slate-500"}`}>Completed</button>
                <button type="button" onClick={onClose} className="ml-auto rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">Close</button>
                </div>
              </div>
            </>
          ) : <p className="retela-modal-body text-slate-600">Order details are not available.</p>}
      </motion.div>
    </motion.div>
  );
}

function OrderSummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#dfe9e3] bg-[#f8faf9] p-3">
      <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <strong className="mt-1 block break-words text-[#111827]">{value || "Not provided"}</strong>
    </div>
  );
}

function TableCard({ rows, actions, rowClassName, columns }) {
  const visibleColumns = columns || Object.keys(rows[0] || { id: "", status: "", created_at: "" }).slice(0, 7);
  return (
    <Card className="overflow-x-auto">
      {rows.length ? (
        <table className="w-full min-w-[760px] text-left text-sm text-white/75">
          <thead><tr className="border-b border-white/10 text-white/45">{visibleColumns.map((k) => <th key={k} className="p-3">{k}</th>)}<th className="p-3">Actions</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className={`border-b border-white/5 ${rowClassName?.(row) || ""}`}>{visibleColumns.map((k) => <td key={k} className="max-w-64 break-words p-3">{formatCell(k, row[k])}</td>)}<td className="p-3"><div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/25 p-2 shadow-lg">{actions?.(row)}</div></td></tr>)}</tbody>
        </table>
      ) : <EmptyState title="No recent transactions" subtitle="Real records will appear here after customers start interacting with the system." />}
    </Card>
  );
}

function CustomersResponsiveView({ rows, rejectingUserIds = [], onApprove, onView, onDelete }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState title="No customers found" subtitle="Approved and pending customer accounts will appear here." />
      </Card>
    );
  }

  return (
    <Card className="admin-customers-card">
      <div className="customer-desktop-view">
        <div className="customers-table-wrapper" role="region" aria-label="Customers table" tabIndex={0}>
          <table className="customers-table">
            <colgroup>
              <col className="customer-col-display" />
              <col className="customer-col-email" />
              <col className="customer-col-phone" />
              <col className="customer-col-location" />
              <col className="customer-col-status" />
              <col className="customer-col-birthday" />
              <col className="customer-col-gender" />
              <col className="customer-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Location</th>
                <th>Status</th>
                <th>Birthday</th>
                <th>Gender</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id} className={rejectingUserIds.includes(customer.id) ? "trash-vanish" : ""}>
                  <td className="customer-wrap">
                    <div className="customer-name-cell">
                      <span className="customer-table-avatar" aria-hidden="true">{customerInitials(customer)}</span>
                      <span className="customer-table-name-text">{customerDisplayName(customer)}</span>
                    </div>
                  </td>
                  <td className="customer-email">{customer.email || "-"}</td>
                  <td className="customer-nowrap">{customer.phone_number || "-"}</td>
                  <td className="customer-wrap">{customer.location || "-"}</td>
                  <td><CustomerApprovalStatus status={customer.status} /></td>
                  <td className="customer-nowrap">{formatBirthday(customer.birthday)}</td>
                  <td className="customer-nowrap">{customer.gender || "-"}</td>
                  <td>
                    <CustomerTableActions
                      customer={customer}
                      disabled={rejectingUserIds.includes(customer.id)}
                      onView={onView}
                      onDelete={onDelete}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="customer-mobile-view">
        {rows.map((customer) => (
          <CustomerMobileCard
            key={customer.id}
            customer={customer}
            disabled={rejectingUserIds.includes(customer.id)}
            onApprove={onApprove}
            onView={onView}
            onDelete={onDelete}
          />
        ))}
      </div>
    </Card>
  );
}

function CustomerTableActions({ customer, disabled, onView, onDelete }) {
  return (
    <div className="customer-table-actions">
      <button
        type="button"
        onClick={() => onView?.(customer.id)}
        className="customer-action-view"
        aria-label={`View customer ${customer.username || customer.id}`}
        title="View customer"
      >
        <Eye size={17} />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDelete?.(customer.id)}
        className="customer-action-delete"
        aria-label={`Delete customer ${customer.username || customer.id}`}
        title="Delete customer"
      >
        <Trash2 size={17} />
      </button>
    </div>
  );
}

function CustomerMobileCard({ customer, disabled, onApprove, onView, onDelete }) {
  return (
    <article className={`customer-mobile-card ${disabled ? "trash-vanish" : ""}`}>
      <div className="customer-mobile-card-top">
        <div className="customer-mobile-avatar" aria-hidden="true">{customerInitials(customer)}</div>
        <div className="customer-mobile-title">
          <div>
            <h3>{customerDisplayName(customer)}</h3>
            <p>@{customer.username || "customer"}</p>
          </div>
          <span className={`customer-presence-badge ${customer.presence_status === "active" ? "is-online" : ""}`}>
            <PresenceDot status={customer.presence_status} />{presenceLabel(customer.presence_status)}
          </span>
        </div>
      </div>

      <div className="mobile-customer-info">
        <MobileCustomerRow label="Email" value={customer.email || "-"} wide />
        <MobileCustomerRow label="Phone" value={customer.phone_number || "-"} />
        <MobileCustomerRow label="Location" value={customer.location || "-"} wide />
        <MobileCustomerRow label="Birthday" value={formatBirthday(customer.birthday)} />
        <MobileCustomerRow label="Gender" value={customer.gender || "-"} />
      </div>

      <div className="customer-mobile-footer">
        <CustomerApprovalControl
          customer={customer}
          disabled={disabled}
          onApprove={onApprove}
        />
        <div className="customer-mobile-icon-actions">
          <button
            type="button"
            onClick={() => onView?.(customer.id)}
            className="customer-action-view"
            aria-label={`View customer ${customer.username || customer.id}`}
            title="View customer"
          >
            <Eye size={17} />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDelete?.(customer.id)}
            className="customer-action-delete"
            aria-label={`Delete customer ${customer.username || customer.id}`}
            title="Delete customer"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}

function MobileCustomerRow({ label, value, wide = false }) {
  return (
    <div className={`mobile-customer-row ${wide ? "is-wide" : ""}`}>
      <span className="mobile-customer-label">{label}</span>
      <strong className="mobile-customer-value">{value}</strong>
    </div>
  );
}

function CustomerApprovalStatus({ status }) {
  return (
    <span className={`customer-approval-badge is-${status || "pending"}`}>
      {status === "pending_otp" ? "Awaiting email OTP" : registrationStatusLabel(status)}
    </span>
  );
}

function CustomerApprovalControl({ customer, disabled, onApprove }) {
  const approved = customer.status === "approved";
  return approved ? (
    <span className="customer-approved-compact">
      <Check size={14} />
      Approved
    </span>
  ) : (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onApprove?.(customer.id)}
      className="customer-action-approve"
      aria-label={`Approve customer ${customer.username || customer.id}`}
    >
      Approve
    </button>
  );
}

function customerDisplayName(customer) {
  return customer.display_name || customer.username || `Customer #${customer.id}`;
}

function customerSearchText(customer) {
  return [
    customer.display_name,
    customer.username,
    customer.email,
    customer.phone_number
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function isCustomerActive(customer) {
  return String(customer.presence_status || "").toLowerCase() === "active";
}

function customerSortValue(customer) {
  const value = Date.parse(customer.registration_created_at || customer.created_at || customer.updated_at || "");
  return Number.isFinite(value) ? value : Number(customer.id) || 0;
}

function customerInitials(customer) {
  const source = customerDisplayName(customer);
  return String(source)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
}

function formatBirthday(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatCell(key, value) {
  if (key === "is_online") {
    return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${value ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><ActiveDot active={value} />{value ? "Online" : "Offline"}</span>;
  }
  return String(value ?? "");
}

function displayFulfillmentStatus(order) {
  // Older PayMongo orders stored `paid` in the fulfillment status. They are
  // still pending fulfillment once payment is confirmed.
  if (order?.status === "paid" && order?.payment_status === "paid") return "pending";
  return order?.status || "pending";
}

function canAcceptOrder(order) {
  if (!order) return false;
  const fulfillmentStatus = displayFulfillmentStatus(order);
  if (fulfillmentStatus !== "pending") return false;
  const paymentMethod = String(order.payment_method || "").toLowerCase();
  return paymentMethod === "cod" || paymentMethod === "cash" || order.payment_status === "paid" || order.status === "paid";
}

function paymentStatusLabel(status) {
  const labels = {
    paid: "Paid",
    awaiting_payment: "Awaiting Payment",
    failed: "Payment Failed",
    cancelled: "Cancelled",
    refunded: "Refunded",
    unpaid: "Unpaid"
  };
  return labels[status] || "Unpaid";
}

function orderButtonClass(status) {
  const styles = {
    approved: "bg-emerald-50 text-emerald-700",
    processing: "bg-blue-50 text-bluebrand",
    ready: "bg-amber-50 text-amber-700",
    completed: "order-action-completed border border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100",
    cancelled: "bg-rose-50 text-rose-700"
  };
  return styles[status] || "bg-white text-bluebrand";
}

function orderBadgeClass(status) {
  const styles = {
    pending: "border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]",
    awaiting_payment: "border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]",
    paid: "border border-[#BFDBFE] bg-[#DBEAFE] text-[#1D4ED8]",
    approved: "border border-[#BFDBFE] bg-[#DBEAFE] text-[#1D4ED8]",
    processing: "border border-[#BFDBFE] bg-[#DBEAFE] text-[#1D4ED8]",
    ready: "border border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]",
    completed: "border border-[#BBF7D0] bg-[#DCFCE7] text-[#166534]",
    cancelled: "border border-[#FECACA] bg-[#FEE2E2] text-[#B91C1C]",
    payment_failed: "border border-[#FECACA] bg-[#FEE2E2] text-[#B91C1C]"
  };
  return styles[status] || "border border-[#BFDBFE] bg-[#DBEAFE] text-[#1D4ED8]";
}

function orderStatusLabel(status) {
  const labels = {
    pending: "Pending",
    awaiting_payment: "Awaiting Payment",
    paid: "Paid",
    approved: "Accepted",
    processing: "Processing",
    ready: "Out to Deliver",
    completed: "Completed",
    cancelled: "Cancelled",
    payment_failed: "Payment Failed"
  };
  return labels[status] || status;
}

function ProductGallery({ products, filters, setFilters, optionValues, onAdd, onEdit, onDelete, deletingProductIds = [] }) {
  const [quickViewProduct, setQuickViewProduct] = useState(null);

  return (
    <Card className="border-white/10 bg-white/[0.06] shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
        <div className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Apparel Catalog</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-white">Manage Apparel</h3>
          </div>
          <Button onClick={onAdd}><PackagePlus size={17} /> Add Apparel Item</Button>
        </div>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_170px_150px_150px]">
          <Field icon={Search} placeholder="Filter apparel items" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            <option value="all">All items</option>
            {(optionValues.categories || []).filter((category) => category !== "Other").map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })}>
            <option value="all">All brands</option>
            {(optionValues.brands || []).filter((brand) => brand !== "Other").map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })}>
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="available">Available</option>
            <option value="high">High stock</option>
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.condition} onChange={(e) => setFilters({ ...filters, condition: e.target.value })}>
            <option value="all">All condition</option>
            {(optionValues.conditions || []).filter((condition) => condition !== "Other").map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          </select>
        </div>
        {products.length ? <div className="retela-admin-product-grid">
          {products.map((p) => (
            <motion.article key={p.id} className="retela-admin-product-card w-full min-w-0 rounded-[20px] border border-white/10 bg-white/[0.07] p-2.5 shadow-xl shadow-black/18 backdrop-blur-2xl transition duration-300 hover:-translate-y-0.5 hover:border-neonbrand/30 hover:shadow-[0_18px_55px_rgba(0,0,0,0.3),0_0_28px_rgba(56,255,136,0.08)]" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
              <div className="retela-admin-product-image-wrap relative overflow-hidden rounded-xl bg-white/[0.06]">
                <ProductImage product={p} className="h-full w-full object-cover" alt={p.name} />
                <button type="button" className="retela-product-eye-button" onClick={() => setQuickViewProduct(p)} aria-label={`Preview ${p.name}`}>
                  <Eye size={15} />
                </button>
              </div>
              <div className="retela-admin-product-body mt-3 min-w-0">
                <h4 className="truncate font-bold text-white" title={p.name}>{p.name}</h4>
                <div className="mt-2 grid gap-1 text-xs text-white/52">
                  <p className="truncate"><span className="font-bold text-white/72">Category:</span> {p.category || "T-Shirts"}</p>
                  <p className="truncate"><span className="font-bold text-white/72">Brand:</span> {p.brand || "Other"}</p>
                  <p className="truncate"><span className="font-bold text-white/72">Size:</span> {p.size || "Free Size"}</p>
                  <p className="truncate"><span className="font-bold text-white/72">Condition:</span> {normalizeCondition(p.condition)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-white">PHP {Number(p.price || 0).toLocaleString()}</strong>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${p.stock <= 5 ? "border-orange-400/20 bg-orange-400/10 text-orange-300" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"}`}>{p.stock} stock</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onEdit?.(p)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/72 transition hover:border-neonbrand/40 hover:text-neonbrand">
                  <Edit3 size={14} />
                  Edit
                </button>
                <button type="button" disabled={!validProductId(p) || isDeletingProduct(p, deletingProductIds)} title={deleteDisabledReason(p)} onClick={() => onDelete?.(p)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#fda29b] bg-[#fff1f0] px-3 py-2 text-xs font-bold text-[#b42318] transition hover:border-[#f97066] hover:bg-[#fee4e2] hover:text-[#912018] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(217,45,32,0.45)] disabled:cursor-not-allowed disabled:opacity-45">
                  <Trash2 size={14} />
                  {isDeletingProduct(p, deletingProductIds) ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.article>
          ))}
        </div> : <EmptyState title="No apparel items added yet." subtitle="Use Add Apparel Item to create the first thrift item when inventory is ready." />}
        <ProductQuickView
          product={quickViewProduct}
          isOpen={Boolean(quickViewProduct)}
          onClose={() => setQuickViewProduct(null)}
          mode="admin"
        />
    </Card>
  );
}

function BarcodeSelectionModal({ products, selectedIds, selectedProducts, allSelected, onToggle, onSelectAll, onClear, onPrintSelected, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[220] grid place-items-center bg-black/65 p-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
      role="presentation"
    >
      <motion.section
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-neonbrand/20 bg-[#07110d]/96 text-white shadow-[0_32px_110px_rgba(0,0,0,0.58),0_0_65px_rgba(56,255,136,0.12)]"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-selection-title"
      >
        <div className="flex flex-col gap-4 border-b border-white/10 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Barcode Management</p>
            <h3 id="barcode-selection-title" className="mt-2 font-display text-2xl font-bold">Select Barcode Labels</h3>
            <p className="mt-1 text-sm text-white/48">{selectedProducts.length} selected of {products.length} inventory items</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={allSelected ? onClear : onSelectAll} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/72 transition hover:border-neonbrand/35 hover:text-neonbrand">
              <Check size={16} />
              {allSelected ? "Clear All" : "Select All"}
            </button>
            <button type="button" onClick={onPrintSelected} disabled={!selectedProducts.length} className="inline-flex items-center gap-2 rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-4 py-2.5 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black disabled:cursor-not-allowed disabled:opacity-45">
              <Printer size={16} />
              Print Selected Barcodes
            </button>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:border-neonbrand/35 hover:text-neonbrand" aria-label="Close barcode manager">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {products.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => {
                const selected = selectedIds.includes(Number(product.id));
                return (
                  <button key={product.id} type="button" onClick={() => onToggle(product.id)} className={`grid gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${selected ? "border-neonbrand/40 bg-neonbrand/10" : "border-white/10 bg-white/[0.055] hover:border-neonbrand/24"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? "border-neonbrand bg-neonbrand text-black" : "border-white/20 bg-black/20 text-transparent"}`}>
                        <Check size={14} />
                      </span>
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-white">{product.brand || "Other"}</strong>
                        <span className="mt-0.5 block truncate text-xs text-white/45">{product.name}</span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white p-2">
                      <div className="h-14">
                        <BarcodeSvg value={productSku(product)} compact />
                      </div>
                    </div>
                    <span className="truncate rounded-xl border border-neonbrand/20 bg-neonbrand/10 px-3 py-2 text-center text-xs font-black tracking-[0.08em] text-neonbrand">{productSku(product)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No barcodes available" subtitle="Add apparel inventory to generate RETELA barcode labels." />
          )}
        </div>
      </motion.section>
    </motion.div>,
    document.body
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div className="empty-panel grid min-h-56 place-items-center rounded-[24px] p-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)]">
          <Sparkles size={22} />
        </div>
        <h4 className="font-display text-xl font-bold text-white">{title}</h4>
        <p className="mt-2 max-w-md text-sm leading-6 text-white/50">{subtitle}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, emptyMessage, hasData, children }) {
  return (
    <Card>
      <h3 className="font-display text-lg font-bold text-white">{title}</h3>
      <div className="mt-4 h-72">
        {hasData ? children : <EmptyState title={emptyMessage} subtitle="Charts will appear once data is recorded." />}
      </div>
    </Card>
  );
}

function ListCard({ rows }) {
  return <div className="grid gap-4">{rows.map((row) => <Card key={row.id}><strong>{row.title}</strong><p className="mt-1 text-sm text-slate-500">{row.body}</p></Card>)}</div>;
}

function normalizeLocationText(location) {
  return String(location || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function registrationStatusLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Declined";
  if (status === "suspended") return "Suspended";
  return status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "Pending";
}

function AdminLocations({ users }) {
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [search, setSearch] = useState("");
  const [routeError, setRouteError] = useState(false);

  const customers = useMemo(() => users.filter((user) => user.role !== "admin"), [users]);
  const savedLocations = useMemo(() => {
    const seen = new Set();
    return customers
      .map((customer) => String(customer.location || "").trim())
      .filter(Boolean)
      .filter((location) => {
        const key = normalizeLocationText(location);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const savedLocationOptions = useMemo(() => {
    const commonKeys = new Set(commonCustomerLocations.map(normalizeLocationText));
    return savedLocations.filter((location) => !commonKeys.has(normalizeLocationText(location)));
  }, [savedLocations]);

  const filteredCustomers = useMemo(() => {
    const selectedKey = normalizeLocationText(selectedLocation);
    const searchKey = normalizeLocationText(search);
    return customers.filter((customer) => {
      const locationKey = normalizeLocationText(customer.location);
      const matchesLocation = selectedLocation === "all" || (locationKey && (locationKey === selectedKey || locationKey.includes(selectedKey)));
      const searchable = normalizeLocationText(`${customer.username || ""} ${customer.email || ""} ${customer.phone_number || ""} ${customer.location || ""}`);
      const matchesSearch = !searchKey || searchable.includes(searchKey);
      return matchesLocation && matchesSearch;
    });
  }, [customers, search, selectedLocation]);

  const selectedOrigin = selectedLocation === "all" ? "" : selectedLocation;
  const hasSelectedOrigin = Boolean(normalizeLocationText(selectedOrigin));
  const directionsMapUrl = hasSelectedOrigin && GOOGLE_MAPS_API_KEY
    ? `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${encodeURIComponent(selectedOrigin)}&destination=${encodeURIComponent(SHOP_LOCATION)}&mode=driving`
    : "";
  const fallbackDirectionsMapUrl = hasSelectedOrigin
    ? `https://maps.google.com/maps?saddr=${encodeURIComponent(selectedOrigin)}&daddr=${encodeURIComponent(SHOP_LOCATION)}&output=embed`
    : "";
  const shopMapUrl = `https://www.google.com/maps?q=${encodeURIComponent(SHOP_LOCATION)}&output=embed`;
  const activeMapUrl = hasSelectedOrigin ? directionsMapUrl || fallbackDirectionsMapUrl : shopMapUrl;
  const externalRouteUrl = hasSelectedOrigin
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(selectedOrigin)}&destination=${encodeURIComponent(SHOP_LOCATION)}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SHOP_LOCATION)}`;

  useEffect(() => {
    setRouteError(false);
  }, [selectedLocation]);

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Customer Routes</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Locations</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">Filter saved customer locations and view the driving route to the shop destination.</p>
          </div>
          <div className="rounded-2xl border border-neonbrand/20 bg-neonbrand/10 px-4 py-3 text-sm text-neonbrand">
            <span className="block text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/75">Shop Destination</span>
            <strong className="mt-1 block max-w-md text-white">{SHOP_LOCATION}</strong>
          </div>
        </div>
      </section>

      <Card>
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(220px,1fr)_auto]">
          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Location Filter</span>
            <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-white outline-none transition focus:border-neonbrand/60">
              <option className="bg-slate-950 text-white" value="all">All Locations</option>
              {commonCustomerLocations.map((location) => (
                <option className="bg-slate-950 text-white" key={location} value={location}>{location}</option>
              ))}
              {savedLocationOptions.length ? (
                <optgroup label="Saved customer locations">
                  {savedLocationOptions.map((location) => (
                    <option className="bg-slate-950 text-white" key={location} value={location}>{location}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Search Customers</span>
            <Field icon={Search} placeholder="Search name, contact, or location" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <a className="inline-flex h-12 items-center justify-center self-end rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-4 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black" href={externalRouteUrl} target="_blank" rel="noreferrer">
            <MapPin size={17} />
            Open Map
          </a>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-white/10 p-5">
            <h2 className="font-display text-xl font-bold text-white">Registered Customer Locations</h2>
            <p className="mt-1 text-sm text-white/45">{filteredCustomers.length} customer records match this filter.</p>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {filteredCustomers.length ? filteredCustomers.map((customer) => (
              <button key={customer.id} type="button" onClick={() => customer.location ? setSelectedLocation(customer.location) : null} className="grid w-full gap-2 border-b border-white/7 px-5 py-4 text-left transition hover:bg-white/[0.045]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-white">{customer.username}</strong>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-bold text-white/55">{registrationStatusLabel(customer.status)}</span>
                </div>
                <p className="break-words text-sm text-white/58">{customer.location || "Location not provided"}</p>
              </button>
            )) : <div className="p-5"><EmptyState title="No matching locations" subtitle="Saved customer locations from registration and profile records will appear here." /></div>}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="grid gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-white">Route Map</h2>
                <p className="mt-1 text-sm text-white/50">
                  {hasSelectedOrigin ? `${selectedOrigin} to ${SHOP_LOCATION}` : "Select a customer location to calculate a driving route."}
                </p>
              </div>
              <div className="grid gap-2 text-xs font-bold text-white/60">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-300" /> Customer Location</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-neonbrand" /> Shop Destination</span>
              </div>
            </div>
            {!hasSelectedOrigin ? (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm font-semibold text-amber-100">Location not provided.</div>
            ) : null}
            {routeError ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm font-semibold text-rose-100">Unable to calculate route. Please check the customer location.</div>
            ) : null}
          </div>
          <iframe className="h-[520px] w-full border-0 grayscale-[0.1] hue-rotate-[55deg]" src={activeMapUrl} loading="lazy" title={hasSelectedOrigin ? "Customer route to Tela to Pera Thrift Shop" : "Tela to Pera Thrift Shop destination map"} onError={() => setRouteError(true)} />
        </Card>
      </div>
    </div>
  );
}

function AdminNotifications({ rows, loading = false, users, rejectingUserIds = [], selectedRegistration, setSelectedRegistration, approveUser, onChange, onNotificationRead }) {
  const lockedRegistrationStatuses = new Set(["approved", "rejected"]);

  function isRegistrationNotification(row) {
    return ["approval", "customer_registration", "registration"].includes(row.type) && row.title === "New customer registration";
  }

  function canDecideRegistration(registration) {
    return registration && !lockedRegistrationStatuses.has(registration.status);
  }

  const adminNotificationTypes = new Set(["approval", "customer_registration", "registration", "feedback", "message", "order", "order_cancelled", "payment", "inventory", "refund", "return"]);
  const adminRows = rows
    .filter((row) => adminNotificationTypes.has(row.type))
    .filter((row, index, source) => {
      if (!isRegistrationNotification(row)) return true;
      const key = String(row.customerId || row.registration_id || row.user_id || row.email || row.phone || row.id);
      return source.findIndex((candidate) => String(candidate.customerId || candidate.registration_id || candidate.user_id || candidate.email || candidate.phone || candidate.id) === key && isRegistrationNotification(candidate)) === index;
    });

  function registrationFromNotification(row) {
    if (!isRegistrationNotification(row)) return null;
    const matchedUser = users.find((user) => Number(user.id) === Number(row.customerId || row.registration_id || row.user_id));
    const registrationId = Number(row.customerId || row.registration_id || row.user_id || matchedUser?.id || 0);
    if (!registrationId) return null;
    return {
      id: registrationId,
      username: row.username || row.registration_username || matchedUser?.username || "",
      email: row.email || row.registration_email || matchedUser?.email || "",
      phone_number: row.phone || row.registration_phone || matchedUser?.phone_number || "",
      location: row.location || row.registration_location || matchedUser?.location || "",
      status: row.status || row.registration_status || matchedUser?.status || "",
      created_at: row.registration_created_at || matchedUser?.created_at || row.created_at
    };
  }

  async function decide(status) {
    if (!canDecideRegistration(selectedRegistration)) return;
    if (status === "rejected") setSelectedRegistration(null);
    await approveUser(selectedRegistration.id, status);
    if (status !== "rejected") setSelectedRegistration(null);
  }

  async function decideRegistration(registration, status) {
    if (!canDecideRegistration(registration)) return;
    await approveUser(registration.id, status);
  }

  async function openAdminNotification(row) {
    await api.patch(`/notifications/${row.id}/read`).catch(() => {});
    clearGetCache("/notifications");
    onNotificationRead?.(row.id);
    window.dispatchEvent(new CustomEvent("retela:notification-read", { detail: { id: row.id, type: row.type } }));
    onChange?.(adminNotificationTarget(row));
  }

  return (
    <>
      <div className="grid gap-4">
        {loading ? (
          <Card><p className="text-sm font-semibold text-slate-500">Loading admin notifications...</p></Card>
        ) : adminRows.length ? adminRows.map((row) => {
          const registration = isRegistrationNotification(row) ? registrationFromNotification(row) : null;
          const canDecide = canDecideRegistration(registration);
          return (
            <Card key={row.id} className={registration && rejectingUserIds.includes(registration.id) ? "trash-vanish" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" onClick={() => openAdminNotification(row)} className="min-w-0 flex-1 text-left">
                  <span className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${row.is_read ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>{row.type}</span>
                    <span className="text-xs font-semibold text-slate-400">{formatAdminDate(row.created_at)}</span>
                    {!row.is_read ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-label="Unread notification" /> : null}
                  </span>
                  <strong>{row.title}</strong>
                  <p className="mt-1 break-words text-sm text-slate-500">{row.message || row.body}</p>
                </button>
                {registration ? <Button onClick={() => setSelectedRegistration(registration)}><Check size={17} /> View Form</Button> : null}
              </div>
              {registration ? (
                <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 sm:grid-cols-2">
                  <Detail label="Username" value={registration.username} />
                  <Detail label="Email" value={registration.email} />
                  <Detail label="Phone" value={registration.phone_number} />
                  <Detail label="Location" value={registration.location} />
                  <Detail label="Status" value={registrationStatusLabel(registration.status)} />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {canDecide ? (
                      <>
                        <Button type="button" onClick={() => decideRegistration(registration, "approved")}><Check size={17} /> Approve</Button>
                        <Button type="button" variant="secondary" onClick={() => decideRegistration(registration, "rejected")}><Trash2 size={17} /> Decline</Button>
                      </>
                    ) : (
                      <span className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/60">Decision final: {registrationStatusLabel(registration.status)}</span>
                    )}
                  </div>
                </div>
              ) : null}
            </Card>
          );
        }) : <Card><EmptyState title="No admin notifications yet" subtitle="Orders, registrations, messages, feedback, and returns will appear here." /></Card>}
      </div>
      {selectedRegistration ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-lg">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Customer Registration</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-white">{selectedRegistration.username}</h3>
            <div className="mt-4 grid gap-3 text-sm">
              <Detail label="Email" value={selectedRegistration.email} />
              <Detail label="Phone" value={selectedRegistration.phone_number} />
              <Detail label="Location" value={selectedRegistration.location} />
              <Detail label="Status" value={registrationStatusLabel(selectedRegistration.status)} />
              <Detail label="Registered" value={selectedRegistration.created_at} />
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setSelectedRegistration(null)}>Close</Button>
              {canDecideRegistration(selectedRegistration) ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => decide("rejected")}><Trash2 size={17} /> Decline</Button>
                  <Button type="button" onClick={() => decide("approved")}><Check size={17} /> Approve</Button>
                </>
              ) : (
                <span className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/60">Decision final: {registrationStatusLabel(selectedRegistration.status)}</span>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function AdminFeedback({ reviews }) {
  const average = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length : 0;
  return (
    <div className="grid gap-5">
      <section className="admin-feedback-hero relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Customer Experience</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-white">Feedback</h1>
            <p className="mt-2 text-sm text-white/55">Review customer ratings, categories, order references, and uploaded apparel feedback.</p>
          </div>
          <div className="feedback-rating-card rounded-2xl px-4 py-3">
            <span className="feedback-rating-label text-xs font-bold uppercase tracking-[0.16em]">Average Rating</span>
            <strong className="feedback-rating-value mt-1 flex items-center gap-2 text-2xl"><Star className="feedback-rating-star" size={20} fill="currentColor" /> {average.toFixed(1)}</strong>
          </div>
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reviews.length ? reviews.map((review) => (
          <Card key={review.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/65">Order #{review.order_id || "N/A"}</p>
                <h3 className="mt-1 truncate font-display text-lg font-bold text-white">{review.username}</h3>
                <p className="mt-1 text-sm text-white/50">{review.category || "Overall Experience"} | {review.order_products || review.product_name || "Order feedback"}</p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">{review.rating}/5</span>
            </div>
            {review.image_url ? <img src={assetUrl(review.image_url)} className="mt-4 h-40 w-full rounded-2xl object-cover" alt="Customer feedback" /> : null}
            <p className="mt-4 text-sm leading-6 text-white/58">{review.comment}</p>
          </Card>
        )) : <Card className="feedback-empty-card md:col-span-2 xl:col-span-3"><EmptyState title="No customer feedback yet" subtitle="Feedback from completed orders will appear here." /></Card>}
      </div>
    </div>
  );
}

function AdminReturns({ rows, decideReturn }) {
  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Return Verification</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-white">Returns</h1>
          <p className="mt-2 text-sm text-white/55">Approve, reject, review, or refund return requests after checking customer proof.</p>
        </div>
      </section>
      <div className="grid gap-4">
        {rows.length ? rows.map((row) => (
          <Card key={row.id}>
            <div className="grid gap-4 lg:grid-cols-[90px_minmax(0,1fr)_auto] lg:items-start">
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06]">
                <ProductImage src={row.product_image} className="h-full w-full object-cover" alt={row.product_names || "Return product"} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-xl font-bold text-white">Order #{row.order_id}</h3>
                  <ReturnBadge status={row.status} />
                </div>
                <p className="mt-1 text-sm text-white/52">{row.username} | {row.product_names || "Order items"} | PHP {row.total_amount}</p>
                <p className="mt-3 text-sm leading-6 text-white/62"><strong>{row.reason_category || "Other"}:</strong> {row.reason}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-neonbrand/65">{row.refund_type || "Refund"}</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button type="button" onClick={() => decideReturn(row.id, "under_review")} className="rounded-xl border border-sky-300/25 bg-sky-300/10 px-3 py-2 text-xs font-bold text-sky-200">Review</button>
                <button type="button" onClick={() => decideReturn(row.id, "approved")} className="rounded-xl border border-neonbrand/25 bg-neonbrand/10 px-3 py-2 text-xs font-bold text-neonbrand">Approve</button>
                <button type="button" onClick={() => decideReturn(row.id, "refunded")} className="rounded-xl border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-xs font-bold text-violet-200">Refunded</button>
                <button type="button" onClick={() => decideReturn(row.id, "rejected")} className="rounded-xl border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-200">Reject</button>
              </div>
            </div>
          </Card>
        )) : <Card><EmptyState title="No return requests" subtitle="Customer return and refund requests will appear here." /></Card>}
      </div>
    </div>
  );
}

function ReturnBadge({ status }) {
  const styles = {
    pending: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    under_review: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    approved: "border-neonbrand/25 bg-neonbrand/10 text-neonbrand",
    rejected: "border-rose-300/25 bg-rose-300/10 text-rose-200",
    refunded: "border-violet-300/25 bg-violet-300/10 text-violet-200"
  };
  const label = status === "under_review" ? "Under Review" : status ? status.charAt(0).toUpperCase() + status.slice(1) : "Pending";
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${styles[status] || styles.pending}`}>{label}</span>;
}

function ActiveDot({ active }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" : "bg-slate-300"}`} aria-hidden="true" />;
}

function PresenceDot({ status }) {
  const styles = {
    active: "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]",
    away: "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.75)]",
    offline: "bg-slate-400"
  };
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles[status] || styles.offline}`} aria-hidden="true" />;
}

function presenceLabel(status) {
  if (status === "active") return "Active";
  if (status === "away") return "Away";
  return "Offline";
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <span className="block text-xs font-bold uppercase tracking-[0.16em] text-white/40">{label}</span>
      <strong className="mt-1 block break-words text-white/80">{value || "Not provided"}</strong>
    </div>
  );
}

function Messages() {
  const [conversations, setConversations] = useState([]);
  const [approvedCustomers, setApprovedCustomers] = useState([]);
  const [selectedChat, setSelectedChat] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);

  const selectedConversation = conversations.find((conversation) => chatKey(conversation) === selectedChat)
    || approvedCustomers.find((customer) => chatKey(customer) === selectedChat);

  async function loadConversations() {
    const [conversationRes, customerRes] = await Promise.all([api.get("/messages/conversations"), api.get("/messages/customers/approved")]);
    setConversations(conversationRes.data);
    setApprovedCustomers(customerRes.data);
    if (!selectedChat && (conversationRes.data[0] || customerRes.data[0])) setSelectedChat(chatKey(conversationRes.data[0] || customerRes.data[0]));
  }

  async function loadMessages(conversation) {
    if (!conversation?.id) {
      setMessages([]);
      return;
    }
    const { data } = await api.get(`/messages/${conversation.id}`);
    setMessages(data);
  }

  useEffect(() => {
    loadConversations().catch(() => {});
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { loadMessages(selectedConversation).catch(() => {}); }, [selectedChat, selectedConversation?.id]);

  async function sendMessage() {
    if (!selectedConversation || !text.trim()) return;
    const payload = selectedConversation.id
      ? { conversation_id: Number(selectedConversation.id), body: text, mode: "admin" }
      : { customer_id: Number(selectedConversation.customer_id), body: text, mode: "admin" };
    const { data } = await api.post("/messages", payload);
    setText("");
    setSelectedChat(String(data.conversation_id));
    await loadConversations();
    await loadMessages({ ...selectedConversation, id: data.conversation_id });
  }

  async function setTakeover(active) {
    if (!selectedConversation?.id) return;
    await api.patch(`/messages/${selectedConversation.id}/takeover`, { active });
    await loadConversations();
    await loadMessages(selectedConversation);
  }

  async function removeApprovedCustomer(customerId) {
    await api.delete(`/users/${customerId}`);
    if (selectedChat === `customer-${customerId}` || Number(selectedConversation?.customer_id) === Number(customerId)) {
      setSelectedChat("");
      setMessages([]);
    }
    await loadConversations();
  }

  return (
    <Card className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-h-96 rounded-2xl bg-slate-50 p-3">
        <h3 className="px-2 py-2 font-display text-lg font-bold">Messages</h3>
        <div className="mt-2 grid max-h-[520px] gap-2 overflow-auto">
          {conversations.map((conversation) => (
            <div key={chatKey(conversation)} className={`flex min-w-0 items-center gap-2 rounded-xl p-2 transition ${selectedChat === chatKey(conversation) ? "bg-bluebrand text-white shadow-lg" : "bg-white text-slate-700 hover:bg-blue-50"}`}>
              <button onClick={() => setSelectedChat(chatKey(conversation))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/80 text-sm font-bold text-bluebrand">
                  {(conversation.username || "C").slice(0, 1).toUpperCase()}
                  <span className="absolute bottom-0 right-0"><ActiveDot active={conversation.is_online} /></span>
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{conversation.username || `Customer #${conversation.customer_id}`}</strong>
                  <span className={`block truncate text-xs ${selectedChat === chatKey(conversation) ? "text-white/80" : "text-slate-500"}`}>{presenceLabel(conversation.presence_status)}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-4 rounded-2xl bg-blue-50 p-3">
          <p className="px-1 text-xs font-bold uppercase text-bluebrand">Approved Customers</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {approvedCustomers.map((customer) => (
              <span key={chatKey(customer)} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1 text-sm font-bold ${selectedChat === chatKey(customer) ? "bg-bluebrand text-white" : "bg-white text-bluebrand"}`}>
                <button type="button" onClick={() => setSelectedChat(chatKey(customer))} className="inline-flex items-center gap-2 rounded-full px-2 py-1">
                  <PresenceDot status={customer.presence_status} />{customer.username}
                </button>
                <button type="button" onClick={() => removeApprovedCustomer(customer.customer_id)} className={`grid h-7 w-7 place-items-center rounded-full transition ${selectedChat === chatKey(customer) ? "bg-white/15 text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100"}`} aria-label={`Remove ${customer.username}`}>
                  <Trash2 size={14} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-display text-xl font-bold">{selectedConversation?.username || "Select customer"}</h3>
            <p className="text-sm text-slate-500">{selectedConversation ? presenceLabel(selectedConversation.presence_status) : "Click a customer to start chatting"}</p>
          </div>
          {selectedConversation?.id ? (
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-2 text-xs font-bold ${selectedConversation.admin_takeover ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-bluebrand"}`}>{selectedConversation.admin_takeover ? "Chat handled by Admin" : "AI controlling chat"}</span>
              <Button type="button" variant={selectedConversation.admin_takeover ? "secondary" : "primary"} onClick={() => setTakeover(!selectedConversation.admin_takeover)}>
                {selectedConversation.admin_takeover ? "Release to AI" : "Take Over Chat"}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="mt-4 grid h-96 content-start gap-3 overflow-auto rounded-2xl bg-slate-50 p-4">
          {messages.length ? messages.map((m) => <p key={m.id} className={`max-w-[80%] break-words rounded-2xl p-3 text-sm ${m.sender_type === "admin" ? "ml-auto bg-bluebrand text-white" : "bg-white text-slate-600"}`}>{m.body}</p>) : <p className="text-sm text-slate-500">No messages yet.</p>}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row"><Field icon={MessageSquare} placeholder="Reply to selected customer" value={text} onChange={(e) => setText(e.target.value)} /><Button disabled={!selectedConversation || !text.trim()} onClick={sendMessage}><Send size={17} /> Send</Button></div>
      </div>
    </Card>
  );
}

function chatKey(conversation) {
  return conversation.id ? String(conversation.id) : `customer-${conversation.customer_id}`;
}

function AdminProfile({ profile, setProfile, profilePhoto, setProfilePhoto, saveProfile, profileSaving = false, showToast }) {
  const [editing, setEditing] = useState(false);
  const [draftProfile, setDraftProfile] = useState(profile || {});
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");

  useEffect(() => {
    if (!editing) setDraftProfile(profile || {});
  }, [editing, profile]);

  useEffect(() => {
    if (!profilePhoto) {
      setPhotoPreviewUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(profilePhoto);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  if (!profile) return <Card><p className="text-sm text-slate-500">Loading profile...</p></Card>;

  const current = editing ? draftProfile : profile;
  const displayName = current.display_name || current.username || "RETELA Admin";
  const username = current.username || "admin";
  const photoUrl = photoPreviewUrl || assetUrl(profile.profile_photo_url);

  function updateDraft(key, value) {
    setDraftProfile((draft) => ({ ...draft, [key]: value }));
  }

  function startEditing() {
    setDraftProfile(profile || {});
    setProfilePhoto(null);
    setEditing(true);
  }

  function cancelEditing() {
    setDraftProfile(profile || {});
    setProfilePhoto(null);
    setEditing(false);
  }

  async function submitProfile(event) {
    event.preventDefault();
    const nextUsername = String(draftProfile.username || "").trim();
    if (!nextUsername) {
      showToast?.("Username is required.", "error", "top-right");
      return;
    }
    if (nextUsername.length < 3 || nextUsername.length > 80) {
      showToast?.("Username must be 3 to 80 characters.", "error", "top-right");
      return;
    }
    try {
      const saved = await saveProfile(event, { ...draftProfile, username: nextUsername }, profilePhoto);
      if (saved) {
        setProfile(saved);
        setEditing(false);
      }
    } catch {
      // saveProfile owns the toast message; keep edit mode open for correction.
    }
  }

  return (
    <motion.div className="admin-profile-page" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <section className="admin-profile-hero">
        <div className="admin-profile-avatar-wrap">
          {photoUrl ? (
            <img src={photoUrl} className="admin-profile-avatar" alt={displayName} />
          ) : (
            <div className="admin-profile-avatar admin-profile-avatar-fallback">{customerInitials(current)}</div>
          )}
        </div>
        <div className="admin-profile-identity">
          <p className="admin-profile-eyebrow">Admin Profile</p>
          <h2>{displayName}</h2>
          <div className="admin-profile-meta-row">
            <span>@{username}</span>
            <span className="admin-profile-role-badge">Admin</span>
          </div>
        </div>
        <div className="admin-profile-actions">
          {!editing ? (
            <button type="button" className="admin-profile-edit-button" onClick={startEditing}>
              <Edit3 size={16} /> Edit Profile
            </button>
          ) : (
            <>
              <button type="button" className="admin-profile-cancel-button" disabled={profileSaving} onClick={cancelEditing}>
                <X size={16} /> Cancel
              </button>
              <button type="submit" form="retela-admin-profile-form" className="admin-profile-save-button" disabled={profileSaving}>
                {profileSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Profile
              </button>
            </>
          )}
        </div>
      </section>

      <form id="retela-admin-profile-form" onSubmit={submitProfile} className="admin-profile-card">
        <div className="admin-profile-section-heading">
          <h3>Profile Information</h3>
          {editing ? (
            <label className="admin-profile-photo-button">
              <Upload size={16} />
              {profilePhoto ? profilePhoto.name : "Change Photo"}
              <input className="hidden" type="file" accept="image/*" onChange={(event) => setProfilePhoto(event.target.files?.[0] || null)} />
            </label>
          ) : null}
        </div>

        <div className="admin-profile-grid">
          <ProfileField label="Display Name" value={current.display_name || "RETELA Admin"} editing={editing} onChange={(value) => updateDraft("display_name", value)} placeholder="RETELA Admin" />
          <ProfileField label="Username" value={current.username || ""} editing={editing} onChange={(value) => updateDraft("username", value)} placeholder="Username" prefix={!editing ? "@" : ""} required />
          <ProfileField label="Email" value={current.email || ""} editing={editing} onChange={(value) => updateDraft("email", value)} placeholder="Email address" type="email" />
          <ProfileField label="Phone Number" value={current.phone_number || ""} editing={editing} onChange={(value) => updateDraft("phone_number", value)} placeholder="Phone number" empty="Not set" />
          <ProfileField label="Shop Location" value={current.location || ""} editing={editing} onChange={(value) => updateDraft("location", value)} placeholder="Shop location" empty="Not set" wide />
          <ProfileField label="About the Shop" value={current.shop_description || ""} editing={editing} onChange={(value) => updateDraft("shop_description", value)} placeholder="About the shop" empty="No shop description added." textarea wide />
        </div>
      </form>

      <ChangePasswordForm onSuccess={(message) => showToast?.(message || "Password changed successfully.", "success", "top-right")} onError={(message) => showToast?.(message || "Could not change password.", "error", "top-right")} />
    </motion.div>
  );
}

function ProfileField({ label, value, editing, onChange, placeholder, empty = "Not set", prefix = "", type = "text", textarea = false, wide = false, required = false }) {
  const displayValue = String(value || "").trim();
  return (
    <label className={`admin-profile-field ${wide ? "is-wide" : ""}`}>
      <span>{label}</span>
      {editing ? (
        textarea ? (
          <textarea className="admin-profile-input admin-profile-textarea" value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        ) : (
          <input className="admin-profile-input" type={type} required={required} minLength={required ? 3 : undefined} maxLength={label === "Username" ? 80 : undefined} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        )
      ) : (
        <strong className={displayValue ? "" : "is-empty"}>{displayValue ? `${prefix}${displayValue}` : empty}</strong>
      )}
    </label>
  );
}
