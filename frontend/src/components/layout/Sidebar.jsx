import { BarChart3, Barcode, Bell, Bot, Home, Info, LayoutDashboard, LogOut, MapPin, Megaphone, Menu, MessageCircle, Package, ReceiptText, RotateCcw, Settings, ShoppingBag, ShoppingCart, Star, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const isAdminRole = user?.role === "admin" || user?.role === "staff";
  const items = user?.role === "admin" ? adminItems : user?.role === "staff" ? staffItems : customerItems;
  const bottomItems = user?.role === "customer" ? customerBottomItems : [];
  const isAdmin = isAdminRole;
  const desktopCollapsed = collapsed;

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function selectItem(label) {
    onChange(routeMap[label] || label);
    setOpen(false);
  }

  return (
    <>
      <button className={`fixed left-4 top-4 z-50 grid h-11 w-11 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-900 shadow-lg shadow-slate-200/80 transition lg:hidden ${open ? "pointer-events-none opacity-0" : "opacity-100"}`} onClick={() => setOpen(true)} aria-label="Open menu" aria-controls="retela-sidebar" aria-expanded={open}>
        <Menu size={20} />
      </button>
      <aside id="retela-sidebar" className={`premium-sidebar fixed inset-y-4 left-4 z-40 flex w-[82vw] max-w-[320px] flex-col overflow-hidden rounded-[24px] border p-4 shadow-xl transition-[width,transform,opacity,padding,background-color,border-color,color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${desktopCollapsed ? "lg:w-20 lg:p-3" : "lg:w-72"} ${open ? "translate-x-0 opacity-100" : "-translate-x-[calc(100%+2rem)] opacity-0 lg:translate-x-0 lg:opacity-100"}`} aria-hidden={!open ? undefined : false}>
        <div className={`flex items-center gap-3 overflow-hidden rounded-[20px] border border-[#14532D]/30 bg-[#14532D] text-white shadow-md shadow-emerald-950/20 ${desktopCollapsed ? "p-2 lg:flex-col lg:justify-center" : "p-4"}`}>
          <div className={`flex min-w-0 flex-1 items-center gap-3 ${desktopCollapsed ? "lg:flex-none lg:justify-center" : ""}`}>
            <img src={logoUrl} className="h-12 w-12 rounded-2xl border border-white/25 bg-white object-cover shadow-sm" alt="RETELA SYSTEM logo" />
            <div className={`min-w-0 ${desktopCollapsed ? "lg:hidden" : ""}`}>
              <h1 className="truncate font-display text-xl font-bold tracking-wide text-white">{isAdmin ? "RETELA" : "RETELA SYSTEM"}</h1>
              <p className="mt-0.5 truncate text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-100">{isAdmin ? "Commerce System" : "Customer Portal"}</p>
            </div>
          </div>
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/15 text-white shadow-md shadow-emerald-950/20 transition duration-200 hover:scale-105 hover:bg-white/25 active:scale-95" onClick={() => {
            if (window.innerWidth >= 1024) onToggleCollapsed();
            else setOpen(false);
          }} aria-label={open ? "Close menu" : "Collapse menu"}>
            {open ? <X size={18} /> : <Menu size={18} />}
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
        <button onClick={logout} title={desktopCollapsed ? "Logout" : undefined} className={`sidebar-logout mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition duration-300 hover:-translate-y-0.5 ${desktopCollapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <LogOut size={19} /> <span className={desktopCollapsed ? "lg:hidden" : ""}>Logout</span>
        </button>
      </aside>
      {open ? <button aria-label="Close menu" className="fixed inset-0 z-30 bg-slate-950/55 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}
    </>
  );
}
