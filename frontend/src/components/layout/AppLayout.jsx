import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, MessageCircle, Moon, ShoppingCart, Sun, UserCircle } from "lucide-react";
import { api, cachedGet } from "../../api/client";
import { acquireSocket, releaseSocket } from "../../api/socket";
import { logoFromSettings, RETELA_LOGO_URL } from "../../config/branding";
import { useAuth } from "../../context/AuthContext";
import { applyUserTheme, emitUserThemeChange, readUserTheme, saveUserTheme } from "../../utils/userTheme";
import Sidebar from "./Sidebar";

function savedLogoUrl() {
  const cached = localStorage.getItem("retela_logo_url");
  return cached && !cached.includes("scontent.") ? cached : RETELA_LOGO_URL;
}

export default function AppLayout({ children, active, onChange }) {
  const { token, user } = useAuth();
  const profileName = user?.display_name || user?.username;
  const [toast, setToast] = useState(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [now, setNow] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("retela_sidebar_collapsed") === "true");
  const [logoUrl, setLogoUrl] = useState(savedLogoUrl);
  const [darkMode, setDarkMode] = useState(false);
  const [socket, setSocket] = useState(null);
  const lastActivityEmitRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return undefined;
    }
    const nextSocket = acquireSocket(token);
    setSocket(nextSocket);
    return () => releaseSocket(nextSocket);
  }, [token]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleNewRegistration = (payload) => {
      if (user?.role !== "admin") return;
      setNotificationCount((count) => count + 1);
      setToast(payload);
      window.dispatchEvent(new CustomEvent("retela:notification-new", { detail: payload }));
    };
    const handleNewNotification = (payload) => {
      if (user?.role === "admin" && !["customer_registration", "message", "feedback", "order", "inventory", "refund"].includes(payload?.type)) return;
      if (user?.role === "customer" && !["order", "broadcast"].includes(payload?.type)) return;
      if (payload?.type === "message" && user?.role === "admin") {
        setMessageCount((count) => count + 1);
      } else {
        setNotificationCount((count) => count + 1);
      }
      setToast(payload);
      window.dispatchEvent(new CustomEvent("retela:notification-new", { detail: payload }));
      if (["order", "inventory", "new_product"].includes(payload?.type)) {
        window.dispatchEvent(new CustomEvent("retela:data-change", { detail: payload }));
      }
    };
    const handleNewOrder = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "order", payload } }));
    };
    const handleNewProduct = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "product", payload } }));
    };
    const handleProductUpdate = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "inventory", payload } }));
    };
    const handleInventoryUpdate = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: payload }));
    };
    const handleShippingUpdate = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:shipping-change", { detail: payload }));
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "shipping", payload } }));
    };
    const handleUserStatus = (payload) => {
      window.dispatchEvent(new CustomEvent("retela:user-status", { detail: payload }));
    };
    socket.on("new-registration", handleNewRegistration);
    socket.on("notification:new", handleNewNotification);
    socket.on("order:new", handleNewOrder);
    socket.on("product:new", handleNewProduct);
    socket.on("product:update", handleProductUpdate);
    socket.on("inventory:update", handleInventoryUpdate);
    socket.on("shipping:update", handleShippingUpdate);
    socket.on("user:status", handleUserStatus);
    return () => {
      socket.off("new-registration", handleNewRegistration);
      socket.off("notification:new", handleNewNotification);
      socket.off("order:new", handleNewOrder);
      socket.off("product:new", handleNewProduct);
      socket.off("product:update", handleProductUpdate);
      socket.off("inventory:update", handleInventoryUpdate);
      socket.off("shipping:update", handleShippingUpdate);
      socket.off("user:status", handleUserStatus);
    };
  }, [socket, user?.role]);

  useEffect(() => {
    if (!socket || !user?.id) return undefined;
    const markActivity = (force = false) => {
      const nowMs = Date.now();
      if (!force && nowMs - lastActivityEmitRef.current < 15000) return;
      lastActivityEmitRef.current = nowMs;
      socket.emit("user:activity");
    };
    const handleActivity = () => markActivity();
    const timer = setInterval(markActivity, 60000);
    const events = ["click", "keydown", "mousemove", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    markActivity(true);
    return () => {
      clearInterval(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
    };
  }, [socket, user?.id]);

  useEffect(() => {
    if (!token) {
      setNotificationCount(0);
      setMessageCount(0);
      return;
    }
    let cancelled = false;
    cachedGet("/notifications", {}, { cacheMs: 8000, retries: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        const unread = data.filter((row) => !row.is_read);
        if (user?.role === "admin") {
          setMessageCount(unread.filter((row) => row.type === "message").length);
          setNotificationCount(unread.filter((row) => row.type !== "message").length);
        } else {
          setMessageCount(0);
          setNotificationCount(unread.length);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setNotificationCount(0);
        setMessageCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.role]);

  useEffect(() => {
    function handleNotificationRead() {
      setNotificationCount((count) => Math.max(0, count - 1));
    }
    window.addEventListener("retela:notification-read", handleNotificationRead);
    return () => window.removeEventListener("retela:notification-read", handleNotificationRead);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("retela_sidebar_collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    function applyAppearanceSettings(event) {
      if (typeof event.detail?.sidebarCollapse === "boolean") {
        setSidebarCollapsed(event.detail.sidebarCollapse);
      }
    }
    window.addEventListener("retela:appearance-settings", applyAppearanceSettings);
    return () => window.removeEventListener("retela:appearance-settings", applyAppearanceSettings);
  }, []);

  useEffect(() => {
    if (!user?.id || !user?.role) return;
    const nextTheme = readUserTheme(user);
    setDarkMode(nextTheme === "dark");
    applyUserTheme(nextTheme);
  }, [user?.id, user?.role]);

  useEffect(() => {
    function applyCurrentUserTheme(event) {
      if (event.detail?.userId !== user?.id || event.detail?.role !== user?.role) return;
      const nextTheme = event.detail.theme === "dark" ? "dark" : "light";
      saveUserTheme(user, nextTheme);
      setDarkMode(nextTheme === "dark");
      applyUserTheme(nextTheme);
    }
    window.addEventListener("retela:user-theme", applyCurrentUserTheme);
    return () => window.removeEventListener("retela:user-theme", applyCurrentUserTheme);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    cachedGet("/settings/public", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (cancelled) return;
        const nextLogo = logoFromSettings(data);
        setLogoUrl(nextLogo);
        localStorage.setItem("retela_logo_url", nextLogo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function applyBranding(event) {
      const nextLogo = logoFromSettings(event.detail);
      setLogoUrl(nextLogo);
      localStorage.setItem("retela_logo_url", nextLogo);
    }
    window.addEventListener("retela:branding-settings", applyBranding);
    return () => window.removeEventListener("retela:branding-settings", applyBranding);
  }, []);

  async function openNotifications() {
    onChange("Notifications");
    if (user?.role === "customer") return;
    if (!notificationCount) return;
    setNotificationCount(0);
    await api.patch("/notifications/read-all").catch(() => {});
  }

  async function openMessages() {
    if (user?.role === "customer") {
      onChange("Notifications");
      setMessageCount(0);
      await api.patch("/notifications/read-type/message").catch(() => {});
      return;
    }
    onChange("Messages");
    if (!messageCount) return;
    setMessageCount(0);
    await api.patch("/notifications/read-type/message").catch(() => {});
  }

  async function openToastTarget() {
    const target = toastTarget(toast?.type, user?.role);
    setToast(null);
    onChange(target);
    if (user?.role === "customer") return;
    await api.patch("/notifications/read-all").catch(() => {});
  }

  function toggleCustomerTheme() {
    const nextTheme = darkMode ? "light" : "dark";
    saveUserTheme(user, nextTheme);
    setDarkMode(nextTheme === "dark");
    applyUserTheme(nextTheme);
    emitUserThemeChange(user, nextTheme);
  }

  return (
    <div className={`premium-shell min-h-screen overflow-x-hidden text-slate-900 transition-colors duration-300 ${darkMode ? "retela-dark-shell" : ""}`}>
      <Sidebar active={active} collapsed={sidebarCollapsed} onChange={onChange} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} logoUrl={logoUrl} />
      <main className={`min-w-0 transition-[margin] duration-500 ${sidebarCollapsed ? "lg:ml-28" : "lg:ml-80"}`}>
        <header className="sticky top-0 z-20 px-3 py-3 pl-20 sm:px-5 lg:px-8 lg:pl-0 lg:pr-8">
          <div className="premium-topbar flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-[22px] border border-slate-200 bg-white px-3 py-3 shadow-lg shadow-slate-200/70 sm:gap-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <img src={logoUrl} className="h-10 w-10 shrink-0 rounded-xl border border-emerald-100 object-cover" alt="RETELA logo" />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 sm:text-xs sm:tracking-[0.22em]">Tela to Pera Thrift Shop</p>
                <h2 className="break-words font-display text-[clamp(1.05rem,4.8vw,1.5rem)] font-bold leading-tight text-slate-950">{active}</h2>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 sm:flex">
              <CalendarDays size={16} className="text-emerald-700" />
              {now.toLocaleDateString()} {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            {user?.role === "admin" ? (
              <IconButtonWithBadge count={messageCount} label="Messages" onClick={openMessages}>
                <MessageCircle size={18} />
              </IconButtonWithBadge>
            ) : null}
            {user?.role === "customer" ? (
              <button type="button" onClick={() => onChange("Cart")} className="relative grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:h-10 sm:w-10" aria-label="Open cart">
                <ShoppingCart size={18} />
              </button>
            ) : null}
            {user?.role !== "staff" ? (
              <button type="button" onClick={openNotifications} className="relative grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:h-10 sm:w-10" aria-label={`Notifications${notificationCount ? `, ${notificationCount} unread` : ""}`}>
                <Bell size={18} />
                {notificationCount ? (
                  <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-950/40">
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            {user?.role === "customer" ? (
              <button type="button" onClick={toggleCustomerTheme} className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:h-10 sm:w-10" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={darkMode}>
                {darkMode ? <Moon size={18} /> : <Sun size={18} />}
              </button>
            ) : null}
            {user?.role !== "staff" ? (
              <button type="button" onClick={() => onChange("Profile")} className="flex min-h-11 max-w-[44vw] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:min-h-10 sm:max-w-[170px]">
                <UserCircle size={18} className="shrink-0 text-emerald-700" />
                <span className="truncate text-sm font-semibold">{profileName}</span>
              </button>
            ) : null}
          </div>
          </div>
        </header>
        <div className="retela-page-content min-w-0 p-3 pt-2 sm:p-5 sm:pt-2 lg:p-8 lg:pt-3">{children}</div>
      </main>
      {toast ? (
        <div className="fixed inset-x-4 bottom-5 z-50 max-w-sm rounded-[20px] border border-emerald-100 bg-white p-4 text-slate-900 shadow-xl shadow-slate-200/80 sm:left-auto sm:right-5">
          <strong>{toast.title}</strong>
          <p className="mt-1 text-sm text-slate-600">{toast.body}</p>
          {toast.product?.image_url ? <img src={toast.product.image_url} className="mt-3 h-28 w-full rounded-xl object-cover" alt="" /> : null}
          <button className="mt-3 text-sm font-bold text-emerald-700" onClick={openToastTarget}>View now...</button>
        </div>
      ) : null}
    </div>
  );
}

function toastTarget(type, role) {
  if (type === "message") return role === "admin" ? "Messages" : "Notifications";
  if (type === "order") return "Orders";
  if (type === "inventory") return "Inventory";
  if (type === "new_product") return "Shop";
  if (type === "broadcast") return "Notifications";
  if (type === "approval") return "Notifications";
  if (type === "feedback") return "Notifications";
  return "Notifications";
}

function IconButtonWithBadge({ count, label, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="relative grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:h-10 sm:w-10" aria-label={`${label}${count ? `, ${count} unread` : ""}`}>
      {children}
      {count ? (
        <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-950/40">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
