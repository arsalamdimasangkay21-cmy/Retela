import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend } from "chart.js";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Activity, Archive, Barcode, Bot, Check, ChevronLeft, ChevronRight, Download, Edit3, Eye, FileSpreadsheet, Loader2, MapPin, Megaphone, MessageSquare, MoreHorizontal, PackageCheck, PackagePlus, Plus, Printer, ReceiptText, RotateCcw, Save, Search, Send, Shirt, ShoppingBag, SlidersHorizontal, Sparkles, Star, Tags, Trash2, TrendingUp, Upload, WalletCards, X, Zap } from "lucide-react";
import { api, API_URL } from "../api/client";
import { createApparelOption, fetchApparelOptions } from "../api/apparelOptions";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import CustomerDocumentsModal from "../components/CustomerDocumentsModal";
import { Button, Card, Field, StatCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
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

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend, chartGlowPlugin);

const assetUrl = (url) => !url ? "" : url.startsWith("http") ? url : `${API_URL.replace(/\/api$/, "")}${url}`;
const fallbackApparelOptions = {
  brands: ["Nike", "Adidas", "Levi's", "Champion", "Uniqlo", "H&M", "Puma", "Lacoste", "Guess", "Other"],
  categories: ["T-Shirts", "Jackets", "Caps", "Other"],
  types: ["Men", "Women", "Kids", "Vintage", "Oversized", "Streetwear", "Sportswear", "Formal", "Casual", "Unisex", "Other"],
  sizes: ["XS", "S", "M", "L", "XL", "XXL", "Free Size", "Other"],
  conditions: ["Like New", "Excellent", "Very Good", "Good", "Fair", "Other"]
};
const productColors = ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Pink", "Purple", "Orange", "Other"];
const blankProduct = { name: "", brand: "Other", category: "T-Shirts", gender: "Other", size: "Free Size", color: "Other", price: "", stock: "1", condition: "Good", description: "", image_url: "" };
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

function optionNames(rows = [], fallback = []) {
  const names = [...fallback, ...rows.map((row) => row?.name || row)].map((value) => String(value || "").trim()).filter(Boolean);
  return names.filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}

function optionExists(options = [], name) {
  const normalized = String(name || "").trim().toLowerCase();
  return options.find((value) => String(value || "").trim().toLowerCase() === normalized) || "";
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
  const [returns, setReturns] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [form, setForm] = useState(blankProduct);
  const [productImage, setProductImage] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false);
  const [filters, setFilters] = useState({ search: "", category: "all", brand: "all", stock: "all", size: "all", condition: "all" });
  const [profile, setProfile] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [rejectingUserIds, setRejectingUserIds] = useState([]);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [selectedDocumentCustomerId, setSelectedDocumentCustomerId] = useState(null);
  const [productToast, setProductToast] = useState(null);
  const [apparelOptions, setApparelOptions] = useState({ brands: [], categories: [], types: [], sizes: [], conditions: [] });

  const optionValues = useMemo(() => ({
    brands: optionNames(apparelOptions.brands, fallbackApparelOptions.brands),
    categories: optionNames(apparelOptions.categories, fallbackApparelOptions.categories),
    types: optionNames(apparelOptions.types, fallbackApparelOptions.types),
    sizes: optionNames(apparelOptions.sizes, fallbackApparelOptions.sizes),
    conditions: optionNames(apparelOptions.conditions, fallbackApparelOptions.conditions)
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

  function showProductToast(message, tone = "success") {
    setProductToast({ message, tone });
    window.clearTimeout(showProductToast.timer);
    showProductToast.timer = window.setTimeout(() => setProductToast(null), 2800);
  }

  async function load() {
    const [reportRes, productRes, inventoryRes, orderRes, userRes, notificationRes, returnRes, reviewRes, profileRes] = await Promise.all([
      api.get("/reports/summary"),
      api.get("/products"),
      api.get("/products/inventory"),
      api.get("/orders"),
      api.get("/users"),
      api.get("/notifications"),
      api.get("/returns"),
      api.get("/reviews"),
      api.get("/users/me")
    ]);
    setSummary(reportRes.data);
    setProducts(productRes.data);
    setInventoryProducts(inventoryRes.data);
    setOrders(orderRes.data);
    setUsers(userRes.data);
    setNotifications(notificationRes.data);
    setReturns(returnRes.data);
    setReviews(reviewRes.data);
    setProfile(profileRes.data);
  }

  async function loadApparelOptions() {
    const options = await fetchApparelOptions();
    setApparelOptions(options);
    return options;
  }

  useEffect(() => {
    load().catch(() => {});
    loadApparelOptions().catch(() => {});
    const timer = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function refreshAdminNotifications() {
      load().catch(() => {});
    }
    window.addEventListener("retela:data-change", refreshAdminNotifications);
    window.addEventListener("retela:notification-new", refreshAdminNotifications);
    window.addEventListener("retela:user-status", refreshAdminNotifications);
    return () => {
      window.removeEventListener("retela:data-change", refreshAdminNotifications);
      window.removeEventListener("retela:notification-new", refreshAdminNotifications);
      window.removeEventListener("retela:user-status", refreshAdminNotifications);
    };
  }, []);

  async function saveProduct(event, resolvedForm = form) {
    event.preventDefault();
    const payload = new FormData();
    Object.entries(resolvedForm).forEach(([key, value]) => payload.append(key, value ?? ""));
    if (productImage) payload.append("image", productImage);
    let response;
    if (editingProductId) {
      response = await api.put(`/products/${editingProductId}`, payload, { headers: { "Content-Type": "multipart/form-data" } });
    } else {
      response = await api.post("/products", payload, { headers: { "Content-Type": "multipart/form-data" } });
    }
    setForm(blankProduct);
    setProductImage(null);
    setEditingProductId(null);
    setInventoryModalOpen(false);
    await Promise.all([load(), loadApparelOptions()]);
    showProductToast(response?.data?.message || (editingProductId ? "Apparel item updated successfully." : "Apparel item saved successfully."));
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
      image_url: product.image_url || ""
    });
    setInventoryModalOpen(true);
  }

  async function deleteProduct(id) {
    if (String(id).startsWith("sample-")) return;
    await api.delete(`/products/${id}`);
    await load();
    showProductToast("Apparel item moved to Trash Bin.");
  }

  async function updateStock(id, change) {
    if (String(id).startsWith("sample-")) return;
    await api.patch(`/products/${id}/stock`, { delta: change });
    await load();
    showProductToast(change > 0 ? "Apparel item restocked successfully." : "Stock updated successfully.");
  }

  async function updateOrder(id, status) {
    await api.patch(`/orders/${id}/status`, { status });
    await load();
  }

  async function approveUser(id, status) {
    try {
      if (status === "rejected") {
        setRejectingUserIds((ids) => [...ids, id]);
        await new Promise((resolve) => setTimeout(resolve, 760));
      }
      await api.patch(`/users/${id}/status`, { status });
      await load();
    } finally {
      setRejectingUserIds((ids) => ids.filter((userId) => userId !== id));
    }
  }

  async function removeCustomer(id) {
    setRejectingUserIds((ids) => [...ids, id]);
    await api.delete(`/users/${id}`);
    await load();
    setRejectingUserIds((ids) => ids.filter((userId) => userId !== id));
  }

  async function decideReturn(id, status) {
    await api.patch(`/returns/${id}/decision`, { status });
    await load();
  }

  async function saveProfile(event) {
    event.preventDefault();
    const payload = new FormData();
    Object.entries(profile).forEach(([key, value]) => payload.append(key, value ?? ""));
    if (profilePhoto) payload.append("profilePhoto", profilePhoto);
    const { data } = await api.patch("/users/me", payload, { headers: { "Content-Type": "multipart/form-data" } });
    localStorage.setItem("retela_user", JSON.stringify({ ...user, ...data }));
    setUser({ ...user, ...data });
    setProfile(data);
    setProfilePhoto(null);
  }

  if (active === "Dashboard") {
    return <FuturisticDashboard summary={summary} products={inventoryProducts} orders={orders} users={users} notifications={notifications} onChange={onChange} />;
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
        />
        {productToast ? <AdminToast toast={productToast} onClose={() => setProductToast(null)} /> : null}
      </>
    );
  }

  if (active === "Inventory") {
    return (
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
        optionValues={optionValues}
        refreshApparelOptions={loadApparelOptions}
        showProductToast={showProductToast}
        productToast={productToast}
        onDismissToast={() => setProductToast(null)}
      />
    );
  }

  if (active === "Orders") {
    return <OrderManagement rows={orders} updateOrder={updateOrder} />;
  }

  if (active === "POS") {
    return <PosPage />;
  }

  if (active === "Customers") {
    const visibleCustomers = users.filter((row) => row.status !== "rejected");
    const approvedCustomers = visibleCustomers.filter((row) => row.status === "approved");
    return (
      <div className="grid gap-4">
        <Card>
          <h3 className="font-display text-lg font-bold">Listed Customers</h3>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
            {approvedCustomers.map((customer) => (
              <span key={customer.id} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-sm font-bold text-bluebrand">
                <PresenceDot status={customer.presence_status} />{customer.username} - {presenceLabel(customer.presence_status)}
                <button type="button" onClick={() => removeCustomer(customer.id)} className="grid h-7 w-7 place-items-center rounded-full bg-rose-50 text-rose-600 transition hover:bg-rose-100" aria-label={`Remove ${customer.username}`}>
                  <Trash2 size={14} />
                </button>
              </span>
            ))}
          </div>
        </Card>
        <TableCard rows={visibleCustomers} columns={["id", "username", "display_name", "email", "phone_number", "location", "status", "birthday", "gender"]} rowClassName={(row) => rejectingUserIds.includes(row.id) ? "trash-vanish" : ""} actions={(row) => <><span className={`rounded-lg px-3 py-2 text-xs font-bold ${row.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{row.status === "pending_otp" ? "Awaiting email OTP" : registrationStatusLabel(row.status)}</span><button onClick={() => setSelectedDocumentCustomerId(row.id)} title="View Verification Documents" className="grid h-9 w-9 place-items-center rounded-lg bg-[#3b82f6] text-white shadow transition hover:scale-[1.02] hover:bg-blue-600" aria-label={`View verification documents for ${row.username}`}><Eye size={17} /></button><button onClick={() => removeCustomer(row.id)} className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-600 shadow" aria-label={`Remove ${row.username}`}><Trash2 size={17} /></button></>} />
        <CustomerDocumentsModal customerId={selectedDocumentCustomerId} open={Boolean(selectedDocumentCustomerId)} onClose={() => setSelectedDocumentCustomerId(null)} />
      </div>
    );
  }

  if (active === "Reports" || active === "Sales Analytics" || active === "Sales") {
    return <SalesAnalytics summary={summary} />;
  }

  if (active === "Automations") return <AutomationsPage />;
  if (active === "Broadcasts") return <BroadcastsPage />;
  if (active === "Purchases") return <Card><h3 className="font-display text-xl font-bold">Purchases</h3><p className="mt-2 text-sm text-slate-500">Purchase tracking can be connected to supplier records when this module is ready.</p></Card>;

  if (active === "Notifications") return <AdminNotifications rows={notifications} users={users} rejectingUserIds={rejectingUserIds} selectedRegistration={selectedRegistration} setSelectedRegistration={setSelectedRegistration} approveUser={approveUser} onChange={onChange} />;
  if (active === "Feedback") return <AdminFeedback reviews={reviews} />;
  if (active === "Returns") return <AdminReturns rows={returns} decideReturn={decideReturn} />;
  if (active === "Archive") return <ArchivePage onChanged={load} />;
  if (active === "Trash Bin") return <TrashBinPage onChanged={load} />;
  if (active === "Messages") return <AdminConversationsPage />;
  if (active === "Locations") return <AdminLocations users={users} />;
  if (active === "Profile") return <AdminProfile profile={profile} setProfile={setProfile} profilePhoto={profilePhoto} setProfilePhoto={setProfilePhoto} saveProfile={saveProfile} />;
  if (active === "Settings") return <AdminSettingsPage onChange={onChange} />;
  return <TableCard rows={returns} actions={(row) => <><button onClick={() => decideReturn(row.id, "approved")} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Approve</button><button onClick={() => decideReturn(row.id, "rejected")} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Reject</button></>} />;
}

function ArchivePage({ onChanged }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function loadArchive() {
    const { data } = await api.get("/messages/archive");
    setConversations(data);
  }

  useEffect(() => {
    loadArchive().catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function restoreConversation(id) {
    setBusyId(`restore-${id}`);
    try {
      await api.patch(`/messages/${id}/restore`);
      await loadArchive();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function trashConversation(id) {
    setBusyId(`trash-${id}`);
    try {
      await api.patch(`/messages/${id}/trash`);
      await loadArchive();
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

  async function loadTrash() {
    const [apparelRes, conversationRes, broadcastRes] = await Promise.all([
      api.get("/products/archived"),
      api.get("/messages/trash"),
      api.get("/broadcasts/trash")
    ]);
    setApparel(apparelRes.data);
    setConversations(conversationRes.data);
    setBroadcasts(broadcastRes.data);
  }

  useEffect(() => {
    loadTrash().catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function restoreApparel(id) {
    setBusyId(`apparel-restore-${id}`);
    try {
      await api.patch(`/products/${id}/restore`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteApparel(id) {
    if (!window.confirm("Permanently delete this apparel item? This cannot be undone.")) return;
    setBusyId(`apparel-delete-${id}`);
    try {
      await api.delete(`/products/${id}/permanent`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function restoreConversation(id) {
    setBusyId(`conversation-restore-${id}`);
    try {
      await api.patch(`/messages/${id}/restore`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteConversation(id) {
    if (!window.confirm("Permanently delete this conversation? This cannot be undone.")) return;
    setBusyId(`conversation-delete-${id}`);
    try {
      await api.delete(`/messages/${id}/permanent`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function restoreBroadcast(id) {
    setBusyId(`broadcast-restore-${id}`);
    try {
      await api.patch(`/broadcasts/${id}/restore`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
  }

  async function deleteBroadcast(id) {
    if (!window.confirm("Permanently delete this broadcast? This cannot be undone.")) return;
    setBusyId(`broadcast-delete-${id}`);
    try {
      await api.delete(`/broadcasts/${id}/permanent`);
      await loadTrash();
      await onChanged?.();
    } finally {
      setBusyId("");
    }
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
  onUpdateStock,
  modalOpen,
  onCloseModal,
  editingProductId,
  form,
  setForm,
  productImage,
  setProductImage,
  saveProduct,
  optionValues,
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
          <InventorySelect label="Category" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })} options={["all", ...optionValues.categories.filter((value) => value !== "Other")]} />
          <InventorySelect label="Size" value={filters.size} onChange={(value) => setFilters({ ...filters, size: value })} options={["all", ...optionValues.sizes.filter((value) => value !== "Other")]} />
          <InventorySelect label="Condition" value={filters.condition} onChange={(value) => setFilters({ ...filters, condition: value })} options={["all", ...optionValues.conditions.filter((value) => value !== "Other")]} />
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
                          {product.image_url ? <img src={assetUrl(product.image_url)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt={product.name} /> : <div className="grid h-full w-full place-items-center text-[10px] font-bold text-white/35">No Image</div>}
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
                        <div className="flex flex-wrap items-center gap-2">
                          <InventoryActionButton tone="edit" icon={Edit3} onClick={() => onEdit(product)}>
                            Edit
                          </InventoryActionButton>
                          <InventoryActionButton tone="more" icon={MoreHorizontal} onClick={() => onUpdateStock(product.id, Number(product.stock) <= 0 ? 1 : -1)}>
                            More
                          </InventoryActionButton>
                          <InventoryActionButton tone="delete" icon={Trash2} onClick={() => onDelete(product.id)}>
                            Delete
                          </InventoryActionButton>
                        </div>
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
                      {product.image_url ? <img src={assetUrl(product.image_url)} className="h-full w-full object-cover" alt={product.name} /> : <div className="grid h-full place-items-center text-[10px] font-bold text-white/35">No Image</div>}
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <InventoryActionButton tone="edit" icon={Edit3} onClick={() => onEdit(product)}>Edit</InventoryActionButton>
                    <InventoryActionButton tone="more" icon={MoreHorizontal} onClick={() => onUpdateStock(product.id, Number(product.stock) <= 0 ? 1 : -1)}>More</InventoryActionButton>
                    <InventoryActionButton tone="delete" icon={Trash2} onClick={() => onDelete(product.id)}>Delete</InventoryActionButton>
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
          optionValues={optionValues}
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

function InventoryActionButton({ tone, icon: Icon, children, onClick }) {
  const styles = {
    edit: "border-[#60A5FA] bg-[#DBEAFE] text-[#1D4ED8] hover:border-[#2563EB]",
    more: "border-[#D1D5DB] bg-[#F3F4F6] text-[#374151] hover:border-[#9CA3AF]",
    delete: "border-[#F87171] bg-[#FEE2E2] text-[#B91C1C] hover:border-[#DC2626]"
  };
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border px-4 py-2 text-sm font-semibold shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${styles[tone] || styles.more}`}>
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

function BarcodeScannerPanel({ title, value, onChange, product, onPrint }) {
  const hasQuery = Boolean(String(value || "").trim());
  return (
    <Card className="border-neonbrand/15 bg-neonbrand/[0.055]">
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
            <button type="button" onClick={() => onChange("")} className="rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
              Clear
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
            <EmptyState
              title={hasQuery ? "No matching product found" : "Ready to scan"}
              subtitle={hasQuery ? "Check the barcode/SKU and try again." : "Matching product details will appear here immediately."}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function AdminToast({ toast, onClose }) {
  const success = toast?.tone !== "error";
  return (
    <div className={`fixed bottom-5 right-5 z-[170] flex max-w-sm items-start gap-3 rounded-[24px] border p-4 text-white shadow-2xl backdrop-blur-2xl ${success ? "border-neonbrand/25 bg-black/85" : "border-rose-300/25 bg-rose-950/85"}`}>
      {success ? <Check size={20} className="mt-0.5 shrink-0 text-neonbrand" /> : <Trash2 size={20} className="mt-0.5 shrink-0 text-rose-200" />}
      <p className="min-w-0 flex-1 text-sm leading-6 text-white/72">{toast?.message}</p>
      <button type="button" onClick={onClose} className="shrink-0 rounded-full px-2 text-white/45 hover:bg-white/10 hover:text-white">x</button>
    </div>
  );
}

function ProductEditorModal({ editingProductId, form, setForm, productImage, setProductImage, saveProduct, optionValues, refreshApparelOptions, showProductToast, onClose }) {
  const inputClass = "rounded-2xl border border-slate-300 bg-white/90 p-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-[#22C55E] focus:ring-4 focus:ring-[#DCFCE7]";
  const secondaryButtonClass = "inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-[#F3F4F6] active:scale-95";
  const primaryButtonClass = "inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#16A34A] via-[#22C55E] to-[#15803D] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-700/20 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-700/25 active:translate-y-0 active:scale-95";
  const [optionModal, setOptionModal] = useState(null);
  const [otherValues, setOtherValues] = useState({ category: "", gender: "", size: "", condition: "" });
  const [otherErrors, setOtherErrors] = useState({});
  const [brandName, setBrandName] = useState("");
  const [brandError, setBrandError] = useState("");
  const brandOptions = optionNames([form.brand], optionValues.brands);

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
    const configs = [
      { kind: "categories", formKey: "category", label: "category", message: "Category added successfully." },
      { kind: "types", formKey: "gender", label: "type", message: "Type added successfully." },
      { kind: "sizes", formKey: "size", label: "size", message: "Size added successfully." },
      { kind: "conditions", formKey: "condition", label: "condition", message: "Condition added successfully." }
    ];
    const nextForm = { ...baseForm };
    const nextErrors = {};

    for (const config of configs) {
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

  async function resolveBrand() {
    if (form.brand !== "Other") return { ...form };
    const trimmedName = brandName.trim();
    if (!trimmedName) {
      setBrandError("Please enter a brand name.");
      return null;
    }
    const existing = optionExists(optionValues.brands, trimmedName);
    if (existing) {
      const nextForm = { ...form, brand: existing };
      setForm(nextForm);
      return nextForm;
    }
    let selectedBrand = "";
    try {
      const created = await createApparelOption("brands", trimmedName);
      selectedBrand = created.name;
      showProductToast("Brand added successfully.");
    } catch (error) {
      if (error?.response?.status !== 409) throw error;
    }
    const refreshed = await refreshApparelOptions();
    selectedBrand = selectedBrand || optionExists(optionNames(refreshed.brands, fallbackApparelOptions.brands), trimmedName) || trimmedName;
    const nextForm = { ...form, brand: selectedBrand };
    setForm(nextForm);
    return nextForm;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const brandResolvedForm = await resolveBrand();
    if (!brandResolvedForm) return;
    const resolvedForm = await resolveOtherOptions(brandResolvedForm);
    if (!resolvedForm) return;
    const finalForm = { ...brandResolvedForm, ...resolvedForm };
    setForm(finalForm);
    await saveProduct(event, finalForm);
  }

  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-[rgba(0,0,0,0.25)] p-4 backdrop-blur-[10px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <motion.section
        className="w-full max-w-2xl rounded-[24px] border border-white/40 bg-white/[0.92] p-5 text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl sm:p-6"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Apparel Item</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-slate-950">{editingProductId ? "Edit Apparel Item" : "Add Apparel Item"}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-[#F3F4F6] hover:text-slate-950">Close</button>
        </div>
        <form onSubmit={handleSubmit} className="mt-5 grid gap-3 md:grid-cols-2">
          <input className={inputClass} placeholder="Apparel Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid gap-1">
              <select className={inputClass} value={form.brand} onChange={(e) => {
                const value = e.target.value;
                setForm({ ...form, brand: value });
                setBrandError("");
                if (value !== "Other") setBrandName("");
              }}>
                {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              {form.brand === "Other" ? (
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-slate-700">Brand Name</span>
                  <input
                    className={inputClass}
                    placeholder="Enter new brand name"
                    value={brandName}
                    onChange={(event) => {
                      setBrandName(event.target.value);
                      setBrandError("");
                    }}
                    required
                  />
                  {brandError ? <span className="text-xs font-bold text-rose-600">{brandError}</span> : null}
                </label>
              ) : null}
            </div>
            <OptionSelectWithAdd
              label="Category"
              value={form.category}
              options={optionValues.categories}
              inputClass={inputClass}
              onChange={(value) => {
                setForm({ ...form, category: value });
                setOtherErrors((errors) => ({ ...errors, category: "" }));
              }}
              onAdd={() => setOptionModal({ kind: "categories", formKey: "category", title: "Add New Category", label: "Category Name", saveLabel: "Save Category", duplicateMessage: "This category already exists.", successMessage: "Category added successfully.", examples: ["Hoodies", "Pants", "Shoes", "Sweaters"] })}
            />
            <OptionSelectWithAdd
              label="Type"
              value={form.gender}
              options={optionValues.types}
              inputClass={inputClass}
              onChange={(value) => {
                setForm({ ...form, gender: value });
                setOtherErrors((errors) => ({ ...errors, gender: "" }));
              }}
              onAdd={() => setOptionModal({ kind: "types", formKey: "gender", title: "Add Apparel Type", label: "Type Name", saveLabel: "Save Type", duplicateMessage: "This type already exists.", successMessage: "Type added successfully.", examples: ["Men", "Women", "Kids", "Vintage", "Oversized", "Streetwear", "Sportswear", "Formal", "Casual"] })}
            />
            {form.category === "Other" ? (
              <OtherOptionInput
                label="Specify Category"
                placeholder="Enter new category"
                value={otherValues.category}
                error={otherErrors.category}
                inputClass={inputClass}
                onChange={(value) => {
                  setOtherValues((current) => ({ ...current, category: value }));
                  setOtherErrors((errors) => ({ ...errors, category: "" }));
                }}
              />
            ) : null}
            {form.gender === "Other" ? (
              <OtherOptionInput
                label="Specify Type"
                placeholder="Enter new type"
                value={otherValues.gender}
                error={otherErrors.gender}
                inputClass={inputClass}
                onChange={(value) => {
                  setOtherValues((current) => ({ ...current, gender: value }));
                  setOtherErrors((errors) => ({ ...errors, gender: "" }));
                }}
              />
            ) : null}
            <OptionSelect
              value={form.size}
              options={optionValues.sizes}
              inputClass={inputClass}
              onChange={(value) => {
                setForm({ ...form, size: value });
                setOtherErrors((errors) => ({ ...errors, size: "" }));
              }}
            />
            <select className={inputClass} value={form.color || "Other"} onChange={(e) => setForm({ ...form, color: e.target.value })}>
              {productColors.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            {form.size === "Other" ? (
              <OtherOptionInput
                label="Specify Size"
                placeholder="3XL, 4XL, Petite, Tall, Custom"
                value={otherValues.size}
                error={otherErrors.size}
                inputClass={inputClass}
                onChange={(value) => {
                  setOtherValues((current) => ({ ...current, size: value }));
                  setOtherErrors((errors) => ({ ...errors, size: "" }));
                }}
              />
            ) : null}
            <input className={inputClass} placeholder="Price" type="number" min="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <input className={inputClass} placeholder="Stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          <OptionSelect
            value={form.condition}
            options={optionValues.conditions}
            inputClass={inputClass}
            onChange={(value) => {
              setForm({ ...form, condition: value });
              setOtherErrors((errors) => ({ ...errors, condition: "" }));
            }}
          />
          {form.condition === "Other" ? (
            <OtherOptionInput
              label="Specify Condition"
              placeholder="Like New, Brand New, Vintage, Collector's Item"
              value={otherValues.condition}
              error={otherErrors.condition}
              inputClass={inputClass}
              onChange={(value) => {
                setOtherValues((current) => ({ ...current, condition: value }));
                setOtherErrors((errors) => ({ ...errors, condition: "" }));
              }}
            />
          ) : null}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-500/45 bg-emerald-50 p-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100">
            <Upload size={17} />
            {productImage ? productImage.name : "Browse apparel image"}
            <input className="hidden" type="file" accept="image/*" onChange={(e) => setProductImage(e.target.files?.[0] || null)} />
          </label>
          <textarea className={`${inputClass} min-h-28 resize-y md:col-span-2`} placeholder="Apparel description, fit notes, flaws, fabric, or styling details" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex flex-col-reverse gap-3 border-t border-slate-200/80 pt-4 md:col-span-2 sm:flex-row sm:justify-end">
            <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancel</button>
            <button type="submit" className={primaryButtonClass}>{editingProductId ? <Save size={17} /> : <PackagePlus size={17} />} {editingProductId ? "Save Apparel Item" : "Add Apparel Item"}</button>
          </div>
        </form>
        {optionModal ? (
          <ApparelOptionModal
            config={optionModal}
            inputClass={inputClass}
            secondaryButtonClass={secondaryButtonClass}
            primaryButtonClass={primaryButtonClass}
            options={optionValues[optionModal.kind]}
            onClose={() => setOptionModal(null)}
            onSave={async (name) => {
              const createdName = await createAndSelectOption(optionModal.kind, optionModal.formKey, name, optionModal.successMessage);
              setOptionModal(null);
              return createdName;
            }}
          />
        ) : null}
      </motion.section>
    </motion.div>
  );
}

function OptionSelect({ value, options, inputClass, onChange }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function OptionSelectWithAdd({ label, value, options, inputClass, onChange, onAdd }) {
  return (
    <div className="flex gap-2">
      <select className={`${inputClass} min-w-0 flex-1`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <button type="button" onClick={onAdd} className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-emerald-500 bg-white/80 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-50 active:scale-95">
        + Add {label}
      </button>
    </div>
  );
}

function OtherOptionInput({ label, placeholder, value, error, inputClass, onChange }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <input className={inputClass} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required />
      {error ? <span className="text-xs font-bold text-rose-600">{error}</span> : null}
    </label>
  );
}

function ApparelOptionModal({ config, inputClass, secondaryButtonClass, primaryButtonClass, options, onClose, onSave }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(`${config.label} is required.`);
      return;
    }
    if (optionExists(options, trimmedName)) {
      setError(config.duplicateMessage);
      return;
    }

    try {
      setSaving(true);
      await onSave(trimmedName);
    } catch (error) {
      if (error?.response?.status === 409) {
        setError(config.duplicateMessage);
      } else {
        setError(error?.response?.data?.message || "Unable to save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/25 p-4 backdrop-blur-[6px]">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-[24px] border border-white/40 bg-white/[0.96] p-5 text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 pb-4">
          <h3 className="font-display text-xl font-bold text-slate-950">{config.title}</h3>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-[#F3F4F6] hover:text-slate-950">Close</button>
        </div>
        <label className="mt-5 grid gap-2">
          <span className="text-sm font-bold text-slate-700">{config.label} *</span>
          <input className={inputClass} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder={config.examples?.[0] || "Enter name"} autoFocus />
        </label>
        {config.examples?.length ? <p className="mt-2 text-xs font-semibold text-slate-500">Examples: {config.examples.join(", ")}</p> : null}
        {error ? <p className="mt-2 text-sm font-bold text-rose-600">{error}</p> : null}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={primaryButtonClass} disabled={saving}>{saving ? "Saving..." : config.saveLabel}</button>
        </div>
      </form>
    </div>
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

function FuturisticDashboard({ summary, products, orders, users, notifications, onChange }) {
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
    <motion.div className="grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
      <section className="relative overflow-hidden rounded-2xl border border-[#DDEFE5] bg-white p-6 shadow-sm sm:p-8">
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#DDEFE5] bg-[#DCFCE7] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#14532D]">
            <Sparkles size={15} /> RETELA
          </span>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-[#111827] sm:text-5xl">Commerce Admin Dashboard</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-500">Sales, customers, conversations, inventory signals, and daily ecommerce operations.</p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card, index) => <CommerceStatCard key={card.title} index={index} {...card} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <ChartPanel title="Sales Overview" subtitle="Monthly database revenue trend" hasData={Boolean(salesTrendRows.length)}>
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
        <ChartPanel title="Top Channels" subtitle="Operational activity mix" hasData={orders.length || notifications.length}>
          <Doughnut data={channelData} options={{ ...chartMotion, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { color: "#111827", boxWidth: 12, padding: 16 } } } }} />
        </ChartPanel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <SignalWidget title="Recent Activity" icon={Activity} items={orders.slice(0, 3).map((order) => `Order #${order.id} is ${order.status}`)} empty="No recent orders yet." />
        <SignalWidget title="AI Performance" icon={Bot} items={[`${aiConversations} message notifications`, `${notifications.filter((row) => row.type === "feedback").length} feedback events`, "Assistant uses live inventory only"]} />
        <SignalWidget title="Inventory Overview" icon={PackageCheck} items={[`${products.length} apparel items`, `${stockTotal} total stock`, `${lowStockProducts.length} low stock alerts`]} />
        <SignalWidget title="System Status" icon={Zap} items={["API connected", "Realtime notifications enabled", "Inventory source: database"]} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Low Stock Alerts</h2>
            <p className="mt-1 text-sm text-white/45">Only real inventory records are shown here.</p>
          </div>
          <button type="button" onClick={() => onChange("Inventory")} className="rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-4 py-2 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">View Inventory</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {lowStockProducts.length ? lowStockProducts.slice(0, 3).map((product) => (
            <div key={product.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <strong className="block truncate text-white">{product.name}</strong>
              <p className="mt-1 text-sm text-white/45">{product.category || "Apparel"} · {product.stock} left</p>
            </div>
          )) : <p className="text-sm text-white/50 md:col-span-3">No low-stock apparel right now.</p>}
        </div>
      </Card>
    </motion.div>
  );
}

function CommerceStatCard({ title, value, hint, icon: Icon, action, index }) {
  return (
    <motion.button type="button" onClick={action} className="group rounded-[26px] border border-white/10 bg-white/[0.06] p-5 text-left shadow-2xl shadow-black/25 backdrop-blur-2xl transition duration-300 hover:border-neonbrand/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4, scale: 1.015 }} transition={{ duration: 0.35, delay: index * 0.04 }}>
      <span className="grid h-11 w-11 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)]">
        <Icon size={21} />
      </span>
      <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-white/42">{title}</p>
      <strong className="mt-2 block truncate font-display text-2xl font-bold text-white">{value}</strong>
      <span className="mt-2 block text-xs text-white/45">{hint}</span>
    </motion.button>
  );
}

function ChartPanel({ title, subtitle, hasData, children }) {
  return (
    <Card className="chart-3d-card">
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
    <Card>
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
    endDate: appliedDateOptions.endDate || ""
  }), [reportOptions, appliedDateOptions]);
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
  const paymentColors = { cash: "#22C55E", cod: "#16A34A", gcash: "#38BDF8", debit: "#F59E0B", credit: "#F472B6", maya: "#84CC16" };
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
    image: assetUrl(product.image_url)
  }));
  const cards = [
    { title: "Total Sales", value: money(totalSales), change: "Live", caption: "database revenue", icon: TrendingUp },
    { title: "Total Orders", value: totalOrders.toLocaleString(), change: "Live", caption: "database orders", icon: ReceiptText },
    { title: "Average Order Value", value: money(averageOrder), change: "Live", caption: "per reportable order", icon: WalletCards },
    { title: "Items Sold", value: itemsSold.toLocaleString(), change: "Live", caption: "database quantities", icon: ShoppingBag },
    { title: "Average Rating", value: averageRating.toFixed(1), change: `${reviewCount} reviews`, caption: "customer feedback", icon: Star }
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
      ...glowingLineStyle
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
        labels: { color: "#111827", boxWidth: 12, usePointStyle: true, pointStyle: "circle" }
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
    api.get("/products/inventory")
      .then(({ data }) => setBarcodeProducts(data))
      .catch(() => setBarcodeProducts([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setAnalyticsLoading(true);
    setAnalyticsError("");
    api.get("/reports/summary", { params: reportOptionsParams({ ...defaultReportOptions, ...appliedDateOptions }) })
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
  }, [appliedDateOptions.dateRange, appliedDateOptions.startDate, appliedDateOptions.endDate]);

  useEffect(() => {
    setReportOptions((current) => ({
      ...current,
      dateRange: appliedDateOptions.dateRange,
      startDate: appliedDateOptions.startDate || "",
      endDate: appliedDateOptions.endDate || ""
    }));
  }, [appliedDateOptions]);

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
      endDate: appliedDateOptions.endDate || ""
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
    <motion.div className="grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_50%_30%,rgba(56,255,136,0.2),transparent_55%)] lg:block" />
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">RETELA SYSTEM - Tela to Pera Thrift Shop</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Apparel Analytics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58 sm:text-base">Track apparel sales, inventory trends, low stock, and revenue.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <select value={reportRange} onChange={(event) => handleDateRangeChange(event.target.value)} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white outline-none">
              {reportRanges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
            {reportRange === "custom" ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="date" value={customRange.startDate} onChange={(event) => setCustomRange((current) => ({ ...current, startDate: event.target.value }))} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white outline-none" aria-label="Start Date" />
                <input type="date" value={customRange.endDate} onChange={(event) => setCustomRange((current) => ({ ...current, endDate: event.target.value }))} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white outline-none" aria-label="End Date" />
                <button type="button" disabled={!customRangeReady || analyticsLoading} onClick={applyCustomDateRange} className="inline-flex items-center justify-center rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-5 py-3 text-sm font-bold text-neonbrand transition hover:border-neonbrand/60 disabled:cursor-not-allowed disabled:opacity-60">Apply</button>
              </div>
            ) : null}
            <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("pdf")} className="gradient-btn inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">
              <Download size={17} />
              Export PDF
            </button>
            <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("excel")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/25 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:border-neonbrand/60 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-60">
              <FileSpreadsheet size={17} />
              Export Excel
            </button>
            <button type="button" disabled={exportDisabled} onClick={() => openReportOptions("print")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/25 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:border-neonbrand/60 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-60">
              <Printer size={17} />
              Print Report
            </button>
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

      <div className="analytics-stats-grid grid gap-4 overflow-x-auto pb-2">
        {cards.map((card, index) => <SalesMetricCard key={card.title} index={index} {...card} />)}
      </div>

      <Card>
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

      <BarcodeScannerPanel
        title="Sales Barcode Scanner"
        value={salesBarcodeQuery}
        onChange={setSalesBarcodeQuery}
        product={scannedSalesProduct}
        onPrint={printProductBarcode}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div ref={salesChartRef}>
        <Card className="chart-3d-card">
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
          <div className="chart-stage mt-6 h-[360px]">
            {trendRows.length ? <Line data={chartData} options={chartOptions} /> : <EmptyState title="No sales yet" subtitle="Live orders from the database will populate the sales trend." />}
          </div>
        </Card>
        </div>
        <div ref={paymentChartRef}>
          <AnalyticsDonutCard title="Revenue Overview" data={paymentMethodData} icon={Tags} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-white">Top Selling Apparel</h2>
              <p className="mt-1 text-sm text-white/45">Best-performing thrift pieces by revenue.</p>
            </div>
            <Shirt className="text-neonbrand" size={22} />
          </div>
          <div className="grid gap-3">
            {topProducts.length ? topProducts.map((product, index) => (
              <motion.article key={product.name} className="flex min-w-0 items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition hover:border-neonbrand/25 hover:bg-neonbrand/[0.055]" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, delay: index * 0.04 }}>
                {product.image ? <img src={product.image} alt={product.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-[10px] font-bold text-white/35">No Image</div>}
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

        <div className="grid gap-5">
          <Card>
            <h2 className="font-display text-xl font-bold text-white">Monthly Sales</h2>
            <p className="mt-1 text-sm text-white/45">Live sales grouped by month.</p>
            <div className="mt-4 grid gap-3">
              {monthlySales.length ? monthlySales.slice(-6).map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
                  <span className="text-sm font-semibold text-white/72">{item.label}</span>
                  <strong className="text-sm text-neonbrand">{money(item.total)}</strong>
                </div>
              )) : <EmptyState title="No monthly sales yet" subtitle="Live orders will appear here by month." />}
            </div>
          </Card>
          <Card>
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

function SalesMetricCard({ title, value, change, caption, icon: Icon, index }) {
  return (
    <motion.article className="metric-card group rounded-[26px] border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/25 backdrop-blur-2xl transition duration-300 hover:border-neonbrand/30 hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_34px_rgba(56,255,136,0.08)]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4, scale: 1.015 }} transition={{ duration: 0.35, delay: index * 0.05 }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">{title}</p>
          <strong className="metric-value mt-4 block font-display font-bold text-white">{value}</strong>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-neonbrand/20 bg-neonbrand/10 px-2.5 py-1 text-xs font-bold text-neonbrand">{change}</span>
            <span className="text-xs text-white/42">{caption}</span>
          </div>
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)] transition group-hover:scale-110">
          <Icon size={23} />
        </span>
      </div>
    </motion.article>
  );
}

function AnalyticsDonutCard({ title, data, icon: Icon, compact }) {
  const hasSales = data.some((item) => Number(item.value || 0) > 0);
  const chart = {
    labels: data.map((item) => item.label),
    datasets: [{
      data: data.map((item) => item.value),
      backgroundColor: data.map((item) => item.color),
      hoverBackgroundColor: data.map((item) => item.color),
      borderColor: "rgba(5,5,5,0.9)",
      borderWidth: 5,
      hoverOffset: 14,
      spacing: 4
    }]
  };
  return (
    <Card className="chart-3d-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/45">Revenue distribution by segment.</p>
        </div>
        <Icon className="text-neonbrand" size={22} />
      </div>
      <div className={`chart-stage mx-auto mt-4 ${compact ? "h-48" : "h-64"} max-w-sm`}>
        {hasSales ? <Doughnut data={chart} options={{ ...chartMotion, cutout: "68%", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(5,5,5,0.92)", callbacks: { label: (context) => `${context.label}: ${context.parsed}%` } } } }} /> : <EmptyState title="No payment sales yet" subtitle="Orders from the database will populate this chart." />}
      </div>
      <div className="mt-4 grid gap-3">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-white/72"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>
            <span className="shrink-0 text-right text-sm font-bold text-white">{item.value}% <span className="ml-2 text-white/42">{money(item.revenue)}</span></span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SummaryRow({ label, value, positive, strong }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
      <span className={`${strong ? "font-bold text-white" : "text-white/62"}`}>{label}</span>
      <strong className={`${positive ? "text-neonbrand" : "text-rose-300"} ${strong ? "text-lg" : "text-sm"}`}>{value}</strong>
    </div>
  );
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function productSku(product) {
  return product?.sku || `RETELA-${String(Number(product?.id || 0)).padStart(6, "0")}`;
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

function OrderManagement({ rows, updateOrder }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrderId, setLoadingOrderId] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFilters, setOrderFilters] = useState({ status: "all", payment: "all", fulfillment: "all", date: "all" });

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

  const visible = rows.map((row, index) => ({
    id: row.id,
    order_no: `Order #${row.id}`,
    list_no: rows.length - index,
    customer: row.username || "Walk-in Customer",
    status: orderStatusLabel(row.status),
    status_key: row.status,
    total: `PHP ${row.total_amount}`,
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

  function updateOrderFilter(key, value) {
    setOrderFilters((filters) => ({ ...filters, [key]: value }));
  }

  function clearOrderFilters() {
    setOrderSearch("");
    setOrderFilters({ status: "all", payment: "all", fulfillment: "all", date: "all" });
  }

  useEffect(() => {
    if (!selectedOrderId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedOrderId]);

  async function saveTracking() {
    if (!selectedOrder?.order?.id) return;
    await api.patch(`/orders/${selectedOrder.order.id}/tracking`, { tracking_number: trackingNumber });
    setReloadToken((value) => value + 1);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Order Management</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-white">Orders</h3>
          </div>
          <p className="rounded-full bg-[#DCFCE7] px-4 py-2 text-sm font-bold text-[#14532D]">Showing {visible.length} of {rows.length} orders</p>
        </div>
      </Card>
      <section className="rounded-[18px] border border-[#DDEFE5] bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.4fr)_repeat(4,minmax(150px,1fr))_auto]">
          <Field icon={Search} placeholder="Search customer, order ID, payment, or tracking" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} />
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
      <TableCard rows={visible} columns={["order_no", "list_no", "customer", "status", "total", "payment", "fulfillment", "items", "tracking"]} rowClassName={() => "transition hover:bg-neonbrand/5"} actions={(row) => <button onClick={() => setSelectedOrderId(row.id)} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-bluebrand shadow transition hover:scale-[1.02]"><Eye size={16} /> View Details</button>} />
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
            onClose={() => setSelectedOrderId(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
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

function OrderDetailsModal({ loading, selectedOrder, trackingNumber, setTrackingNumber, saveTracking, updateOrder, onStatusChanged, onClose }) {
  const source = selectedOrder?.order;

  async function updateStatus(status) {
    if (!source?.id) return;
    await updateOrder(source.id, status);
    onStatusChanged();
  }

  return (
    <motion.div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="mx-4 my-6 w-full max-w-2xl overflow-hidden rounded-[28px] border border-green-400/20 bg-white/5 shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_55px_rgba(56,255,136,0.14)] backdrop-blur-xl" initial={{ opacity: 0, scale: 0.94, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 18 }} transition={{ duration: 0.22, ease: "easeOut" }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="max-h-[86vh] overflow-y-auto p-5 sm:p-6">
          {loading ? (
            <div className="grid gap-4">
              <div className="skeleton h-8 w-1/2 rounded-2xl" />
              <div className="skeleton h-24 rounded-3xl" />
              <div className="skeleton h-40 rounded-3xl" />
            </div>
          ) : source ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">{source.order_channel === "pos" ? "POS Transaction" : "Customer Order"}</p>
                  <h3 className="mt-2 font-display text-2xl font-bold text-white">Order #{source.id}</h3>
                  <p className="mt-1 text-sm text-white/55">{source.username || "Walk-in Customer"} | {new Date(source.created_at).toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-3 py-2 text-xs font-bold ${orderBadgeClass(source.status)}`}>{orderStatusLabel(source.status)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Detail label="Total" value={`PHP ${source.total_amount}`} />
                <Detail label="Items" value={selectedOrder.items.length} />
                <Detail label="Payment" value={paymentLabel(source.payment_method)} />
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
                <span className="block text-xs font-bold uppercase tracking-[0.16em] text-white/40">Tracking Number</span>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-neonbrand/60" placeholder="Enter tracking number" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                  <button type="button" onClick={saveTracking} className="rounded-xl bg-neonbrand px-4 py-2 text-sm font-bold text-black transition hover:scale-[1.02]">Save</button>
                </div>
              </div>
              <div className="grid gap-3">
                {selectedOrder.items.map((item) => (
                  <div key={`${item.product_id}-${item.quantity}`} className="flex gap-3 rounded-3xl border border-white/10 bg-white/[0.055] p-3 transition hover:border-neonbrand/25">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/10">
                      {item.image_url ? <img src={assetUrl(item.image_url)} className="h-full w-full object-cover" alt={item.name} /> : <div className="grid h-full w-full place-items-center text-[11px] text-white/40">No image</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-white">{item.name}</strong>
                      <p className="mt-1 truncate text-sm text-white/50">{item.brand || "Other Brands"} | {item.category} | {item.size}</p>
                      <p className="mt-2 text-sm font-bold text-neonbrand">Qty {item.quantity} x PHP {item.price}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <button disabled={!["pending", "paid"].includes(source.status)} onClick={() => updateStatus(source.status === "paid" ? "processing" : "approved")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow ${["pending", "paid"].includes(source.status) ? orderButtonClass("approved") : "bg-slate-100 text-slate-400"}`}>Accept</button>
                <button disabled={!["pending", "approved", "processing", "ready"].includes(source.status)} onClick={() => updateStatus("cancelled")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow ${["pending", "approved", "processing", "ready"].includes(source.status) ? orderButtonClass("cancelled") : "bg-slate-100 text-slate-400"}`}>Reject</button>
                <button disabled={!["pending", "approved", "processing"].includes(source.status)} onClick={() => updateStatus("ready")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow ${["pending", "approved", "processing"].includes(source.status) ? orderButtonClass("ready") : "bg-slate-100 text-slate-400"}`}>Out for Delivery</button>
                <button disabled={source.status === "completed"} onClick={() => updateStatus("completed")} className={`rounded-xl px-4 py-2 text-xs font-bold shadow ${source.status !== "completed" ? orderButtonClass("completed") : "bg-slate-100 text-slate-400"}`}>Completed</button>
                <button type="button" onClick={onClose} className="ml-auto rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-bold text-white/70 transition hover:text-neonbrand">Close</button>
              </div>
            </div>
          ) : <p className="text-white/60">Order details are not available.</p>}
        </div>
      </motion.div>
    </motion.div>
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

function formatCell(key, value) {
  if (key === "is_online") {
    return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${value ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><ActiveDot active={value} />{value ? "Online" : "Offline"}</span>;
  }
  return String(value ?? "");
}

function orderButtonClass(status) {
  const styles = {
    approved: "bg-emerald-50 text-emerald-700",
    processing: "bg-blue-50 text-bluebrand",
    ready: "bg-amber-50 text-amber-700",
    completed: "bg-slate-900 text-white",
    cancelled: "bg-rose-50 text-rose-700"
  };
  return styles[status] || "bg-white text-bluebrand";
}

function orderBadgeClass(status) {
  const styles = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    processing: "bg-blue-50 text-bluebrand",
    ready: "bg-amber-50 text-amber-700",
    completed: "bg-slate-900 text-white",
    cancelled: "bg-rose-50 text-rose-700"
  };
  return styles[status] || "bg-white text-bluebrand";
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

function ProductGallery({ products, filters, setFilters, optionValues, onAdd, onEdit, onDelete }) {
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
            {optionValues.categories.filter((category) => category !== "Other").map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })}>
            <option value="all">All brands</option>
            {optionValues.brands.filter((brand) => brand !== "Other").map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })}>
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="available">Available</option>
            <option value="high">High stock</option>
          </select>
          <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.condition} onChange={(e) => setFilters({ ...filters, condition: e.target.value })}>
            <option value="all">All condition</option>
            {optionValues.conditions.filter((condition) => condition !== "Other").map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          </select>
        </div>
        {products.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {products.map((p) => (
            <motion.article key={p.id} className="min-w-0 rounded-[20px] border border-white/10 bg-white/[0.07] p-2.5 shadow-xl shadow-black/18 backdrop-blur-2xl transition duration-300 hover:-translate-y-0.5 hover:border-neonbrand/30 hover:shadow-[0_18px_55px_rgba(0,0,0,0.3),0_0_28px_rgba(56,255,136,0.08)]" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
              {p.image_url ? <img src={assetUrl(p.image_url)} className="h-36 w-full rounded-xl object-cover" alt={p.name} /> : <div className="grid h-36 place-items-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-400">No image</div>}
              <div className="mt-3 min-w-0">
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
                <button type="button" onClick={() => onDelete?.(p.id)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/72 transition hover:border-rose-400/40 hover:text-rose-300">
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </motion.article>
          ))}
        </div> : <EmptyState title="No apparel items added yet." subtitle="Use Add Apparel Item to create the first thrift item when inventory is ready." />}
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

function AdminNotifications({ rows, users, rejectingUserIds = [], selectedRegistration, setSelectedRegistration, approveUser, onChange }) {
  const lockedRegistrationStatuses = new Set(["approved", "rejected"]);

  function isRegistrationNotification(row) {
    return ["approval", "customer_registration"].includes(row.type) && row.title === "New customer registration";
  }

  function canDecideRegistration(registration) {
    return registration && !lockedRegistrationStatuses.has(registration.status);
  }

  const adminRows = rows
    .filter((row) => row.type === "approval" || row.type === "customer_registration" || row.type === "feedback" || row.type === "message")
    .filter((row) => !isRegistrationNotification(row))
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
    if (row.type === "message") onChange?.("Messages");
    else if (row.type === "order") onChange?.("Orders");
    else if (row.type === "inventory") onChange?.("Inventory");
    else if (row.type === "approval" || row.type === "customer_registration") onChange?.("Customers");
    else onChange?.("Notifications");
  }

  return (
    <>
      <div className="grid gap-4">
        {adminRows.length ? adminRows.map((row) => {
          const registration = isRegistrationNotification(row) ? registrationFromNotification(row) : null;
          const canDecide = canDecideRegistration(registration);
          return (
            <Card key={row.id} className={registration && rejectingUserIds.includes(registration.id) ? "trash-vanish" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" onClick={() => openAdminNotification(row)} className="min-w-0 flex-1 text-left">
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
        }) : <Card><EmptyState title="No admin notifications yet" subtitle="Feedback, registrations, and messages will appear here." /></Card>}
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
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neonbrand/75">Customer Experience</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-white">Feedback</h1>
            <p className="mt-2 text-sm text-white/55">Review customer ratings, categories, order references, and uploaded apparel feedback.</p>
          </div>
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-amber-100">
            <span className="text-xs font-bold uppercase tracking-[0.16em]">Average Rating</span>
            <strong className="mt-1 flex items-center gap-2 text-2xl"><Star size={20} fill="currentColor" /> {average.toFixed(1)}</strong>
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
        )) : <Card className="md:col-span-2 xl:col-span-3"><EmptyState title="No customer feedback yet" subtitle="Feedback from completed orders will appear here." /></Card>}
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
                {row.product_image ? <img src={assetUrl(row.product_image)} className="h-full w-full object-cover" alt={row.product_names || "Return product"} /> : <div className="grid h-full place-items-center text-white/35"><RotateCcw size={24} /></div>}
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

function AdminProfile({ profile, setProfile, profilePhoto, setProfilePhoto, saveProfile }) {
  if (!profile) return <Card><p className="text-sm text-slate-500">Loading profile...</p></Card>;
  return (
    <Card>
      <h3 className="font-display text-xl font-bold">Admin Profile</h3>
      <form onSubmit={saveProfile} className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2 flex flex-wrap items-center gap-4">
          {profile.profile_photo_url ? <img src={assetUrl(profile.profile_photo_url)} className="h-20 w-20 rounded-full object-cover" alt={profile.display_name || profile.username || "Profile"} /> : <div className="grid h-20 w-20 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-400">Photo</div>}
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-bluebrand bg-blue-50 px-4 py-3 text-sm font-semibold text-bluebrand">
            <Upload size={17} />
            {profilePhoto ? profilePhoto.name : "Browse profile photo"}
            <input className="hidden" type="file" accept="image/*" onChange={(e) => setProfilePhoto(e.target.files?.[0] || null)} />
          </label>
        </div>
        <Field placeholder="Admin display name" value={profile.display_name || ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
        <Field placeholder="Login username" value={profile.username || ""} readOnly title="Login username is fixed for admin accounts." />
        <Field placeholder="Email" type="email" value={profile.email || ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
        <Field placeholder="Phone number" value={profile.phone_number || ""} onChange={(e) => setProfile({ ...profile, phone_number: e.target.value })} />
        <Field placeholder="Shop location" value={profile.location || ""} onChange={(e) => setProfile({ ...profile, location: e.target.value })} />
        <textarea className="min-h-28 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-bluebrand md:col-span-2" placeholder="About the shop" value={profile.shop_description || ""} onChange={(e) => setProfile({ ...profile, shop_description: e.target.value })} />
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 md:col-span-2"><ReceiptText size={18} /> Orders can be reviewed from Order Management.</div>
        <Button type="submit" className="md:w-fit"><Save size={17} /> Save Profile</Button>
      </form>
      <ChangePasswordForm />
    </Card>
  );
}
