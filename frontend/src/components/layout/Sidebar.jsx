import { BarChart3, Barcode, Bell, Bot, Home, Info, LayoutDashboard, LogOut, MapPin, Megaphone, Menu, MessageCircle, Package, ReceiptText, RotateCcw, Settings, ShoppingBag, ShoppingCart, Star, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RETELA_LOGO_URL } from "../../config/branding";
import { useAuth } from "../../context/AuthContext";

const adminItems = [
  ["Dashboard", LayoutDashboard], ["Conversations", MessageCircle], ["Customers", Users], ["Orders", ReceiptText],
  ["POS", Barcode], ["Apparel", Package], ["Inventory", ShoppingBag], ["Locations", MapPin], ["Analytics", BarChart3], ["Automations", Bot],
  ["Broadcasts", Megaphone], ["Feedback", Star], ["Returns", RotateCcw], ["Settings", Settings]
];

const staffItems = [["POS", Barcode]];

const customerItems = [
  ["Home", Home], ["Shop Apparel", Package], ["Cart", ShoppingCart], ["Orders", ReceiptText], ["Notifications", Bell],
  ["Feedback", Star], ["Returns", RotateCcw]
];

const customerBottomItems = [["About", Info]];

const routeMap = {
  Conversations: "Messages",
  Apparel: "Apparel",
  "Shop Apparel": "Shop",
  Analytics: "Sales Analytics"
};

const activeAliases = {
  Conversations: ["Messages"],
  Apparel: ["Apparel"],
  "Shop Apparel": ["Shop"],
  Analytics: ["Sales", "Sales Analytics", "Reports"]
};

export default function Sidebar({ active, collapsed, onChange, onToggleCollapsed, logoUrl = RETELA_LOGO_URL }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAdminRole = user?.role === "admin" || user?.role === "staff";
  const items = user?.role === "admin" ? adminItems : user?.role === "staff" ? staffItems : customerItems;
  const bottomItems = user?.role === "customer" ? customerBottomItems : [];
  const isAdmin = isAdminRole;
  const desktopCollapsed = collapsed;

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") closeSidebar();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSidebar, sidebarOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    function closeForDesktop(event) {
      if (event.matches) closeSidebar();
    }

    closeForDesktop(desktopQuery);
    desktopQuery.addEventListener?.("change", closeForDesktop);
    return () => {
      desktopQuery.removeEventListener?.("change", closeForDesktop);
    };
  }, [closeSidebar]);

  function selectItem(label) {
    onChange(routeMap[label] || label);
    if (window.matchMedia("(max-width: 1023px)").matches) closeSidebar();
  }

  function toggleMobileSidebar() {
    setSidebarOpen((current) => !current);
  }

  function handleSidebarHeaderAction() {
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) {
      onToggleCollapsed();
      return;
    }
    if (window.matchMedia("(max-width: 1023px)").matches) closeSidebar();
  }

  function handleLogout() {
    closeSidebar();
    logout();
  }

  return (
    <>
      <button className={`retela-mobile-menu-button ${sidebarOpen ? "is-open" : ""}`} onClick={toggleMobileSidebar} aria-label={sidebarOpen ? "Close menu" : "Open menu"} aria-controls="retela-sidebar" aria-expanded={sidebarOpen}>
        <Menu size={20} />
      </button>
      <aside
        id="retela-sidebar"
        className={`premium-sidebar retela-sidebar-panel flex flex-col border shadow-xl ${desktopCollapsed ? "retela-sidebar-desktop-collapsed lg:p-3" : "retela-sidebar-desktop-expanded"} ${sidebarOpen ? "retela-sidebar-mobile-open" : "retela-sidebar-mobile-closed"}`}
        role={sidebarOpen ? "dialog" : "navigation"}
        aria-modal={sidebarOpen ? "true" : undefined}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={`retela-sidebar-brand-card ${isAdmin ? "admin-sidebar-brand" : ""} flex items-center gap-3 overflow-hidden rounded-[20px] border border-[#14532D]/30 bg-[#14532D] text-white shadow-md shadow-emerald-950/20 ${desktopCollapsed ? "p-2 lg:flex-col lg:justify-center" : "p-4"}`}>
          <div className={`retela-sidebar-brand-main flex min-w-0 flex-1 items-center gap-3 ${desktopCollapsed ? "lg:flex-none lg:justify-center" : ""}`}>
            <img src={logoUrl} className="retela-sidebar-logo h-12 w-12 rounded-2xl border border-white/25 bg-white object-cover shadow-sm" alt="RETELA SYSTEM logo" />
            <div className={`retela-sidebar-brand-copy min-w-0 ${desktopCollapsed ? "lg:hidden" : ""}`}>
              <h1 className="retela-sidebar-title truncate font-display text-xl font-bold tracking-wide text-white">RETELA SYSTEM</h1>
              <p className="retela-sidebar-subtitle mt-0.5 truncate text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-100">{isAdmin ? "Admin Portal" : "Customer Portal"}</p>
            </div>
          </div>
          <button className="retela-sidebar-close-button admin-sidebar-hamburger grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/15 text-white shadow-md shadow-emerald-950/20 transition duration-200 hover:scale-105 hover:bg-white/25 active:scale-95" onClick={handleSidebarHeaderAction} aria-label="Collapse navigation menu">
            <Menu size={18} />
          </button>
        </div>
        <nav className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
          {items.map(([label, Icon]) => (
            <button key={label} title={desktopCollapsed ? label : undefined} onClick={() => selectItem(label)} className={`sidebar-nav-item group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-bold transition duration-300 ${active === label || activeAliases[label]?.includes(active) ? "sidebar-nav-item-active shadow-sm" : ""} ${desktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
              <Icon size={19} className="sidebar-nav-icon shrink-0 transition-colors duration-300" />
              <span className={`flex-1 ${desktopCollapsed ? "lg:hidden" : ""}`}>{label}</span>
            </button>
          ))}
          {bottomItems.length ? (
            <div className="mt-2 border-t border-white/10 pt-2">
              {bottomItems.map(([label, Icon]) => (
                <button key={label} title={desktopCollapsed ? label : undefined} onClick={() => selectItem(label)} className={`sidebar-nav-item group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-bold transition duration-300 ${active === label || activeAliases[label]?.includes(active) ? "sidebar-nav-item-active shadow-sm" : ""} ${desktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
                  <Icon size={19} className="sidebar-nav-icon shrink-0 transition-colors duration-300" />
                  <span className={`flex-1 ${desktopCollapsed ? "lg:hidden" : ""}`}>{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </nav>
        <button onClick={handleLogout} title={desktopCollapsed ? "Logout" : undefined} className={`sidebar-logout mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition duration-300 hover:-translate-y-0.5 ${desktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <LogOut size={19} /> <span className={desktopCollapsed ? "lg:hidden" : ""}>Logout</span>
        </button>
      </aside>
      {sidebarOpen ? <button type="button" aria-label="Close menu overlay" className="retela-sidebar-overlay" onClick={closeSidebar} /> : null}
    </>
  );
}
