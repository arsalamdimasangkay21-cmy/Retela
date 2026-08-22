import { useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Banknote, Camera, CheckCircle2, Minus, Plus, Printer, QrCode, ReceiptText, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { api, API_URL } from "../api/client";
import ProductImage from "../components/ProductImage";

const assetUrl = (url) => !url ? "" : url.startsWith("http") ? url : `${API_URL.replace(/\/api$/, "")}${url}`;
const money = (value) => `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PosPage() {
  const [barcode, setBarcode] = useState("");
  const [lastProduct, setLastProduct] = useState(null);
  const [selectedSearchProduct, setSelectedSearchProduct] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const [cart, setCart] = useState([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [gcashReference, setGcashReference] = useState("");
  const [settings, setSettings] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const searchBoxRef = useRef(null);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0), [cart]);
  const totalQuantity = useMemo(() => cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [cart]);
  const change = paymentMethod === "cash" ? Math.max(0, Number(cashReceived || 0) - subtotal) : 0;
  const canCheckout = cart.length > 0
    && cart.every((item) => item.quantity > 0 && item.quantity <= Number(item.stock || 0))
    && (paymentMethod === "gcash" ? gcashReference.trim() : Number(cashReceived || 0) >= subtotal);

  useEffect(() => {
    api.get("/pos/settings")
      .then(({ data }) => setSettings(data))
      .catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    function handleInventoryChange() {
      refreshCartStock().catch(() => {});
    }
    window.addEventListener("retela:data-change", handleInventoryChange);
    return () => window.removeEventListener("retela:data-change", handleInventoryChange);
  }, [cart]);

  useEffect(() => {
    const query = barcode.trim();
    setHighlightedSuggestion(0);
    if (!query) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return undefined;
    }
    if (selectedSearchProduct && query.toLowerCase() === String(selectedSearchProduct.sku || "").toLowerCase()) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true);
      api.get("/pos/search", { params: { q: query, limit: 8 }, signal: controller.signal })
        .then(({ data }) => {
          setSuggestions(data || []);
          setSuggestionsOpen(true);
        })
        .catch((error) => {
          if (error?.name !== "CanceledError" && error?.code !== "ERR_CANCELED") setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggestionsLoading(false);
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [barcode, selectedSearchProduct]);

  useEffect(() => {
    function closeSuggestions(event) {
      if (!searchBoxRef.current?.contains(event.target)) setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", closeSuggestions);
    document.addEventListener("touchstart", closeSuggestions, { passive: true });
    return () => {
      document.removeEventListener("mousedown", closeSuggestions);
      document.removeEventListener("touchstart", closeSuggestions);
    };
  }, []);

  function showMessage(text, tone = "info") {
    setMessage({ text, tone });
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(null), 2800);
  }

  function normalizeProduct(product) {
    return {
      id: Number(product.id),
      sku: product.sku,
      name: product.name,
      brand: product.brand,
      category: product.category,
      size: product.size,
      price: Number(product.price || 0),
      stock: Number(product.stock || 0),
      image_url: product.image_url,
      status: product.status
    };
  }

  function addProductToCart(product) {
    const normalized = normalizeProduct(product);
    if (normalized.stock <= 0) {
      showMessage("This apparel item is out of stock.", "error");
      return;
    }
    setCart((items) => {
      const existing = items.find((item) => item.id === normalized.id);
      if (!existing) return [{ ...normalized, quantity: 1 }, ...items];
      if (existing.quantity + 1 > normalized.stock) {
        showMessage("Cannot add more than available stock.", "error");
        return items;
      }
      return items.map((item) => item.id === normalized.id ? { ...item, ...normalized, quantity: item.quantity + 1 } : item);
    });
    setLastProduct(normalized);
    showMessage(`${normalized.name} added to cart.`, "success");
  }

  function selectSuggestion(product) {
    const normalized = normalizeProduct(product);
    setBarcode(normalized.sku || normalized.name);
    setSelectedSearchProduct(normalized);
    setLastProduct(normalized);
    setSuggestionsOpen(false);
  }

  function handleSearchChange(event) {
    setBarcode(event.target.value);
    setSelectedSearchProduct(null);
    setSuggestionsOpen(true);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      return;
    }
    if (!suggestionsOpen || !barcode.trim()) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion((index) => Math.min(index + 1, Math.max(0, suggestions.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && suggestions[highlightedSuggestion]) {
      event.preventDefault();
      selectSuggestion(suggestions[highlightedSuggestion]);
    }
  }

  async function scanBarcode(value = barcode) {
    const code = String(value || "").trim();
    if (!code) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/pos/barcode/${encodeURIComponent(code)}`);
      addProductToCart(data);
      setSelectedSearchProduct(null);
      setBarcode("");
      setSuggestionsOpen(false);
    } catch (error) {
      showMessage(error?.response?.data?.message || "No product found for this barcode.", "error");
    } finally {
      setBusy(false);
    }
  }

  function submitSearch() {
    if (selectedSearchProduct && barcode.trim().toLowerCase() === String(selectedSearchProduct.sku || "").toLowerCase()) {
      addProductToCart(selectedSearchProduct);
      setBarcode("");
      setSelectedSearchProduct(null);
      setSuggestionsOpen(false);
      return;
    }
    scanBarcode();
  }

  async function refreshCartStock() {
    if (!cart.length) return;
    const refreshed = await Promise.all(cart.map((item) => api.get(`/pos/barcode/${encodeURIComponent(item.sku)}`).then(({ data }) => data).catch(() => null)));
    setCart((items) => items.map((item) => {
      const latest = refreshed.find((product) => Number(product?.id) === item.id);
      if (!latest) return item;
      const stock = Number(latest.stock || 0);
      return { ...item, stock, status: latest.status, quantity: Math.min(item.quantity, stock) };
    }).filter((item) => item.quantity > 0));
  }

  function updateQuantity(id, nextQuantity) {
    setCart((items) => items.map((item) => {
      if (item.id !== id) return item;
      const quantity = Math.max(1, Math.min(Number(nextQuantity || 1), Number(item.stock || 0)));
      return { ...item, quantity };
    }));
  }

  async function checkout() {
    if (!canCheckout) return;
    setBusy(true);
    try {
      const { data } = await api.post("/pos/checkout", {
        payment_method: paymentMethod,
        cash_received: paymentMethod === "cash" ? Number(cashReceived || 0) : undefined,
        gcash_reference_number: paymentMethod === "gcash" ? gcashReference.trim() : undefined,
        items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity }))
      });
      setReceipt(data);
      setCart([]);
      setLastProduct(null);
      setCashReceived("");
      setGcashReference("");
      showMessage("POS transaction completed.", "success");
    } catch (error) {
      showMessage(error?.response?.data?.message || "Unable to complete checkout.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="retela-pos-page grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
      <section className="grid gap-5">
        <div className="retela-pos-card rounded-[26px] border border-emerald-100 bg-white p-5 shadow-xl shadow-slate-200/70">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">In-store checkout</p>
              <h1 className="mt-2 font-display text-3xl font-bold text-slate-950">Point of Sale</h1>
            </div>
            <button type="button" onClick={() => setScannerOpen(true)} className="inline-flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-700 active:scale-[0.99]">
              <Camera size={24} />
              Scan Barcode
            </button>
          </div>
          <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
            <div ref={searchBoxRef} className="relative flex-1">
              <label className="relative block">
                <Barcode className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  value={barcode}
                  onChange={handleSearchChange}
                  onFocus={() => barcode.trim() && setSuggestionsOpen(true)}
                  onKeyDown={handleSearchKeyDown}
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm font-bold text-slate-900 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  placeholder="Search product name, SKU, barcode, or category"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen}
                />
              </label>
              {suggestionsOpen && barcode.trim() ? (
                <AutocompleteDropdown
                  query={barcode}
                  suggestions={suggestions}
                  loading={suggestionsLoading}
                  highlightedIndex={highlightedSuggestion}
                  onHover={setHighlightedSuggestion}
                  onSelect={selectSuggestion}
                />
              ) : null}
            </div>
            <button type="submit" disabled={busy || !barcode.trim()} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-950 px-6 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
              <Search size={18} />
              Add Item
            </button>
          </form>
        </div>

        {lastProduct ? <ProductPreview product={lastProduct} /> : <EmptyScanState />}

        <div className="retela-pos-card rounded-[26px] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-950">POS Cart</h2>
              <p className="text-sm text-slate-500">{totalQuantity} item{totalQuantity === 1 ? "" : "s"} ready for checkout</p>
            </div>
            <ShoppingCart className="text-emerald-700" size={24} />
          </div>
          <div className="grid gap-3">
            {cart.length ? cart.map((item) => (
              <CartLine key={item.id} item={item} onQuantity={updateQuantity} onRemove={(id) => setCart((items) => items.filter((entry) => entry.id !== id))} />
            )) : (
              <div className="retela-pos-empty-cart rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-600">Cart is empty.</div>
            )}
          </div>
        </div>
      </section>

      <aside className="grid content-start gap-5">
        <PaymentPanel
          method={paymentMethod}
          setMethod={setPaymentMethod}
          subtotal={subtotal}
          quantity={totalQuantity}
          cashReceived={cashReceived}
          setCashReceived={setCashReceived}
          change={change}
          gcashReference={gcashReference}
          setGcashReference={setGcashReference}
          settings={settings}
          canCheckout={canCheckout}
          busy={busy}
          onCheckout={checkout}
        />
      </aside>

      {scannerOpen ? <ScannerModal onClose={() => setScannerOpen(false)} onDetected={(value) => { setScannerOpen(false); scanBarcode(value); }} /> : null}
      {receipt ? <ReceiptModal receipt={receipt} settings={settings} onClose={() => setReceipt(null)} /> : null}
      {message ? <Toast message={message} onClose={() => setMessage(null)} /> : null}
    </div>
  );
}

function ProductPreview({ product }) {
  return (
    <article className="retela-pos-card grid gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60 md:grid-cols-[160px_minmax(0,1fr)]">
      <ProductImage product={product} className="h-40 w-full rounded-2xl object-cover md:w-40" alt={product.name} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{product.sku}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${product.stock > 0 ? "bg-slate-100 text-slate-700" : "bg-rose-50 text-rose-700"}`}>{product.stock} in stock</span>
        </div>
        <h2 className="mt-3 truncate font-display text-2xl font-bold text-slate-950">{product.name}</h2>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <Detail label="Category" value={product.category} />
          <Detail label="Size" value={product.size} />
          <Detail label="Price" value={money(product.price)} strong />
        </div>
      </div>
    </article>
  );
}

function EmptyScanState() {
  return (
    <div className="retela-pos-empty-state rounded-[26px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-lg shadow-slate-200/50">
      <Barcode className="mx-auto text-slate-500" size={42} />
      <p className="mt-3 text-sm font-bold text-slate-600">Scan a barcode to display product details.</p>
    </div>
  );
}

function AutocompleteDropdown({ query, suggestions, loading, highlightedIndex, onHover, onSelect }) {
  return (
    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/60">
      {loading ? (
        <div className="p-4 text-sm font-bold text-slate-500">Searching products...</div>
      ) : suggestions.length ? (
        <div className="max-h-[430px] overflow-y-auto py-1">
          {suggestions.map((product, index) => {
            const active = index === highlightedIndex;
            return (
              <button
                key={product.id}
                type="button"
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(product)}
                className={`grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition ${active ? "bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
              >
                <ProductImage product={product} className="h-12 w-12 rounded-xl object-cover" alt={product.name} />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-black text-emerald-700"><HighlightText text={product.sku} query={query} /></span>
                    <span className="min-w-0 truncate text-sm font-black text-slate-950"><HighlightText text={product.name} query={query} /></span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                    <span><HighlightText text={product.category} query={query} /></span>
                    <span>Size {product.size || "N/A"}</span>
                    <span className={Number(product.stock || 0) > 0 ? "text-slate-500" : "text-rose-600"}>{Number(product.stock || 0)} stock</span>
                  </div>
                </div>
                <strong className="shrink-0 text-right text-sm text-slate-950">{money(product.price)}</strong>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="p-4 text-sm font-bold text-slate-500">No products found</div>
      )}
    </div>
  );
}

function HighlightText({ text, query }) {
  const value = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return value;
  const index = value.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-yellow-100 px-0.5 font-black text-slate-950">{value.slice(index, index + needle.length)}</mark>
      {value.slice(index + needle.length)}
    </>
  );
}

function Detail({ label, value, strong }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <span className="block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <strong className={`mt-1 block truncate ${strong ? "text-emerald-700" : "text-slate-800"}`}>{value || "N/A"}</strong>
    </div>
  );
}

function CartLine({ item, onQuantity, onRemove }) {
  const insufficient = item.quantity > item.stock;
  return (
    <article className={`grid gap-3 rounded-2xl border p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center ${insufficient ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <ProductImage product={item} className="h-16 w-16 rounded-xl object-cover" alt={item.name} />
      <div className="min-w-0">
        <strong className="block truncate text-slate-950">{item.name}</strong>
        <span className="mt-1 block text-xs font-semibold text-slate-500">{item.category} / {item.size} / Stock: {item.stock}</span>
        <span className="mt-1 block text-sm font-black text-emerald-700">{money(item.price)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50">
          <button type="button" onClick={() => onQuantity(item.id, item.quantity - 1)} className="grid h-10 w-10 place-items-center text-slate-600 hover:text-emerald-700" aria-label="Decrease quantity"><Minus size={16} /></button>
          <input value={item.quantity} onChange={(event) => onQuantity(item.id, event.target.value)} className="h-10 w-12 bg-transparent text-center text-sm font-black outline-none" />
          <button type="button" onClick={() => onQuantity(item.id, item.quantity + 1)} className="grid h-10 w-10 place-items-center text-slate-600 hover:text-emerald-700" aria-label="Increase quantity"><Plus size={16} /></button>
        </div>
        <strong className="w-24 text-right text-sm text-slate-950">{money(item.price * item.quantity)}</strong>
        <button type="button" onClick={() => onRemove(item.id)} className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-600 transition hover:bg-rose-100" aria-label="Remove item"><Trash2 size={17} /></button>
      </div>
    </article>
  );
}

function PaymentPanel({ method, setMethod, subtotal, quantity, cashReceived, setCashReceived, change, gcashReference, setGcashReference, settings, canCheckout, busy, onCheckout }) {
  return (
    <div className="retela-pos-card retela-pos-payment-card sticky top-28 rounded-[26px] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/70">
      <h2 className="font-display text-xl font-bold text-slate-950">Payment</h2>
      <div className="retela-pos-payment-tabs mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button type="button" onClick={() => setMethod("cash")} className={`retela-pos-payment-option inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${method === "cash" ? "bg-white text-emerald-700 shadow" : "text-slate-600"}`}><Banknote size={18} /> Cash</button>
        <button type="button" onClick={() => setMethod("gcash")} className={`retela-pos-payment-option inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${method === "gcash" ? "bg-white text-sky-700 shadow" : "text-slate-600"}`}><QrCode size={18} /> GCash</button>
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <Summary label="Quantity" value={quantity.toLocaleString()} />
        <Summary label="Subtotal" value={money(subtotal)} />
        <Summary label="Total Amount" value={money(subtotal)} strong />
      </div>

      {method === "cash" ? (
        <div className="mt-5 grid gap-3">
          <label className="text-sm font-bold text-slate-700">Cash Received</label>
          <input type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} className="h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg font-black text-slate-950 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
          <div className="retela-pos-change rounded-2xl bg-emerald-50 p-4">
            <span className="block text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Change</span>
            <strong className="mt-1 block text-2xl text-emerald-800">{money(change)}</strong>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <div className="grid place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-4">
            {settings?.gcashQrUrl ? <img src={assetUrl(settings.gcashQrUrl)} alt="Store GCash QR Code" className="max-h-72 w-full rounded-xl object-contain" /> : <div className="grid h-56 w-full place-items-center rounded-xl border border-dashed border-slate-300 text-center text-sm font-bold text-slate-400">GCash QR Code not configured</div>}
            {settings?.gcashNumber ? <p className="mt-3 text-sm font-black text-slate-700">GCash: {settings.gcashNumber}</p> : null}
          </div>
          <label className="text-sm font-bold text-slate-700">GCash Reference Number</label>
          <input value={gcashReference} onChange={(event) => setGcashReference(event.target.value)} className="h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Enter verified reference number" />
        </div>
      )}

      <button type="button" disabled={!canCheckout || busy} onClick={onCheckout} className="mt-5 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
        <CheckCircle2 size={19} />
        {method === "gcash" ? "Payment Received" : "Complete Transaction"}
      </button>
    </div>
  );
}

function Summary({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-slate-500">{label}</span>
      <strong className={strong ? "text-xl text-slate-950" : "text-sm text-slate-800"}>{value}</strong>
    </div>
  );
}

function ScannerModal({ onClose, onDetected }) {
  const regionId = useRef(`retela-pos-scanner-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function startScanner() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId.current);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          (decodedText) => {
            if (!decodedText) return;
            onDetected(decodedText);
          }
        );
      } catch (scannerError) {
        setError(scannerError?.message || "Camera scanner could not start. Check camera permission or use manual barcode entry.");
      }
    }
    startScanner();
    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {});
      else {
        try {
          scanner?.clear?.();
        } catch {
          // Scanner cleanup can throw if the camera never fully initialized.
        }
      }
    };
  }, [onDetected]);

  return (
    <div className="retela-modal-backdrop z-[140] bg-slate-950/70">
      <div className="retela-modal-card modal-md">
        <div className="retela-modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-950">Camera Scanner</h2>
            <p className="text-sm text-slate-500">Point the camera at the product barcode.</p>
          </div>
          <button type="button" onClick={onClose} className="retela-modal-close" aria-label="Close scanner"><X size={18} /></button>
        </div>
        <div className="retela-modal-body">
          <div id={regionId.current} className="min-h-[300px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-950" />
          {error ? <p className="mt-3 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ReceiptModal({ receipt, settings, onClose }) {
  function printReceipt() {
    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(receiptHtml(receipt, settings));
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  }

  return (
    <div className="retela-modal-backdrop z-[150] bg-slate-950/60">
      <div className="retela-modal-card modal-sm">
        <div className="retela-modal-header">
          <div>
            <ReceiptText className="text-emerald-700" size={32} />
            <h2 className="mt-2 font-display text-2xl font-bold text-slate-950">Receipt</h2>
            <p className="text-sm font-semibold text-slate-500">{receipt.order.transaction_number}</p>
          </div>
          <button type="button" onClick={onClose} className="retela-modal-close" aria-label="Close receipt"><X size={18} /></button>
        </div>
        <div className="retela-modal-body">
          <ReceiptBody receipt={receipt} />
        </div>
        <div className="retela-modal-footer">
          <button type="button" onClick={printReceipt} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white"><Printer size={18} /> Print</button>
          <button type="button" onClick={onClose} className="h-12 rounded-2xl border border-slate-200 text-sm font-black text-slate-700">Done</button>
        </div>
      </div>
    </div>
  );
}

function ReceiptBody({ receipt }) {
  const order = receipt.order;
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 p-4">
      <div className="grid gap-2 text-sm">
        <Summary label="Transaction No." value={order.transaction_number} />
        <Summary label="Date / Time" value={new Date(order.date_time).toLocaleString()} />
      </div>
      <div className="my-4 border-t border-dashed border-slate-200" />
      <div className="grid gap-2">
        {receipt.items.map((item) => (
          <div key={item.product_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
            <span className="min-w-0"><strong className="block truncate">{item.name}</strong><span className="text-xs text-slate-500">{item.category} / {item.size} x{item.quantity}</span></span>
            <strong>{money(item.subtotal)}</strong>
          </div>
        ))}
      </div>
      <div className="my-4 border-t border-dashed border-slate-200" />
      <Summary label="Total Amount" value={money(order.total_amount)} strong />
      <Summary label="Payment Method" value={order.payment_method === "gcash" ? "GCash" : "Cash"} />
      {order.payment_method === "cash" ? (
        <>
          <Summary label="Cash Received" value={money(order.cash_received)} />
          <Summary label="Change" value={money(order.change_amount)} />
        </>
      ) : <Summary label="GCash Reference" value={order.gcash_reference_number} />}
    </div>
  );
}

function receiptHtml(receipt, settings) {
  const order = receipt.order;
  const lines = receipt.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}<br><small>${escapeHtml(item.category)} / ${escapeHtml(item.size)}</small></td>
      <td>${item.quantity}</td>
      <td>${escapeHtml(money(item.price))}</td>
      <td>${escapeHtml(money(item.subtotal))}</td>
    </tr>
  `).join("");
  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(order.transaction_number)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; color: #111827; }
          main { width: 320px; margin: 0 auto; padding: 16px; }
          h1 { margin: 0; font-size: 18px; text-align: center; }
          p { margin: 4px 0; font-size: 12px; text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border-bottom: 1px dashed #d1d5db; padding: 6px 0; font-size: 11px; text-align: right; vertical-align: top; }
          th:first-child, td:first-child { text-align: left; }
          small { color: #64748b; }
          .summary { margin-top: 12px; border-top: 1px dashed #9ca3af; padding-top: 8px; font-size: 12px; }
          .row { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; }
        </style>
      </head>
      <body>
        <main>
          <h1>${escapeHtml(settings?.shopName || "RETELA")}</h1>
          <p>${escapeHtml(order.transaction_number)}</p>
          <p>${escapeHtml(new Date(order.date_time).toLocaleString())}</p>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>${lines}</tbody>
          </table>
          <section class="summary">
            <div class="row"><strong>Total</strong><strong>${escapeHtml(money(order.total_amount))}</strong></div>
            <div class="row"><span>Payment</span><span>${order.payment_method === "gcash" ? "GCash" : "Cash"}</span></div>
            ${order.payment_method === "cash" ? `<div class="row"><span>Cash Received</span><span>${escapeHtml(money(order.cash_received))}</span></div><div class="row"><span>Change</span><span>${escapeHtml(money(order.change_amount))}</span></div>` : `<div class="row"><span>GCash Ref</span><span>${escapeHtml(order.gcash_reference_number)}</span></div>`}
          </section>
        </main>
      </body>
    </html>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function Toast({ message, onClose }) {
  return (
    <div className={`fixed bottom-5 right-5 z-[160] max-w-sm rounded-2xl border bg-white p-4 text-sm font-bold shadow-xl ${message.tone === "error" ? "border-rose-100 text-rose-700" : message.tone === "success" ? "border-emerald-100 text-emerald-700" : "border-slate-100 text-slate-700"}`}>
      <button type="button" onClick={onClose} className="float-right ml-3 text-slate-400" aria-label="Dismiss"><X size={16} /></button>
      {message.text}
    </div>
  );
}
