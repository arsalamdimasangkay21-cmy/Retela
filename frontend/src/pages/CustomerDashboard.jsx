import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, BadgeCheck, Bell, Bot, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, CreditCard, Edit3, Eye, EyeOff, FileImage, Globe2, Loader2, Mail, MapPin, Megaphone, MessageCircle, Minus, PackageCheck, Phone, Plus, RotateCcw, Save, Search, Send, ShieldCheck, ShoppingCart, Star, Tag, Trash2, Upload, User, Users, WalletCards, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { A11y, Autoplay, EffectFade, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-fade";
import "swiper/css/navigation";
import "swiper/css/pagination";
import { api, API_URL, cachedGet, clearGetCache } from "../api/client";
import { fetchFeaturedApparel } from "../api/customer";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { Button, Card, Field } from "../components/ui";
import { resolveAssetUrl } from "../config/branding";
import { useAuth } from "../context/AuthContext";
import { emitUserThemeChange, readUserTheme, saveUserTheme } from "../utils/userTheme";

const assetUrl = (url) => resolveAssetUrl(url) || (!url ? "" : `${API_URL.replace(/\/api$/, "")}${url}`);
const productCategories = ["T-Shirts", "Jackets", "Caps"];
const productBrands = ["Nike", "Adidas", "Levi's", "Champion", "Uniqlo", "H&M", "Puma", "Lacoste", "Guess", "Other"];
const productSizes = ["XS", "S", "M", "L", "XL", "XXL", "Free Size"];
const feedbackCategories = ["Apparel Quality", "Delivery", "Customer Service", "Payment", "Overall Experience"];
const returnReasons = ["Wrong item received", "Damaged apparel", "Size issue", "Defective item", "Missing item", "Other"];
const refundTypes = ["Replacement", "Refund", "Store Credit"];
const returnFlow = ["pending", "under_review", "approved", "rejected", "refunded"];
const onlinePaymentMethods = ["gcash", "debit", "credit", "maya"];
const defaultReturnShippingFee = 50;
const defaultCustomerFilters = { search: "", brand: "all", category: "all", size: "all", stock: "all", minPrice: "", maxPrice: "", sortBy: "latest" };
const paymentNumberLabels = {
  gcash: "GCash mobile number",
  debit: "Billing mobile number",
  credit: "Billing mobile number",
  maya: "Maya mobile number"
};
const paymentNumberHelp = {
  gcash: "This number is sent to the secure checkout so GCash can open the right payment flow.",
  debit: "Debit card details are entered only on the secure PayMongo card page.",
  credit: "Credit card details are entered only on the secure PayMongo card page.",
  maya: "This number is sent to the secure checkout before opening Maya."
};

function stockStatus(stock) {
  const quantity = Number(stock || 0);
  if (quantity <= 0) return "Out of Stock";
  return "In Stock";
}

function stockBadgeClass(stock) {
  const status = stockStatus(stock);
  if (status === "Out of Stock") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function normalizeCartRows(rows = []) {
  return rows
    .filter((item) => item && item.name)
    .map((item) => ({
      product_id: Number(item.product_id),
      name: item.name,
      brand: item.brand,
      quantity: Number(item.quantity || 1),
      selected: Boolean(item.selected),
      price: Number(item.price || 0),
      stock: Number(item.stock || 0),
      image_url: item.image_url,
      size: item.size,
      category: item.category,
      condition: item.condition
    }));
}

export default function CustomerDashboard({ active, onChange }) {
  const { user, setUser, logout } = useAuth();
  const [products, setProducts] = useState([]);
  const [featuredApparel, setFeaturedApparel] = useState([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedCartIds, setSelectedCartIds] = useState([]);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [checkoutSummaryOpen, setCheckoutSummaryOpen] = useState(false);
  const [promotions, setPromotions] = useState({ shipping: { type: "fixed", fee: 0 }, coupons: [], sales: [] });
  const [cartEditing, setCartEditing] = useState(false);
  const [cartToast, setCartToast] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [paymentDetails, setPaymentDetails] = useState({ gcashNumber: "", debitNumber: "", creditNumber: "", mayaNumber: "" });
  const [paymentError, setPaymentError] = useState("");
  const [redirectingPayment, setRedirectingPayment] = useState(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState("delivery");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [filters, setFilters] = useState(defaultCustomerFilters);
  const [shopProductIdsFilter, setShopProductIdsFilter] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ brands: [], categories: [], sizes: [] });
  const [shopInfo, setShopInfo] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [returnRequests, setReturnRequests] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileInitial, setProfileInitial] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profileToast, setProfileToast] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const filtersRef = useRef(filters);
  const cartRef = useRef(cart);
  const stockRefreshTimerRef = useRef(null);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const visibleProducts = useMemo(() => products.filter((item) => Number(item.stock || 0) > 0), [products]);
  const filteredProducts = useMemo(() => {
    if (!shopProductIdsFilter.length) return visibleProducts;
    const productIds = new Set(shopProductIdsFilter.map(Number));
    return visibleProducts.filter((item) => productIds.has(Number(item.id)));
  }, [visibleProducts, shopProductIdsFilter]);
  function clearFilters() {
    setShopProductIdsFilter([]);
    setFilters(defaultCustomerFilters);
  }

  function updateFilters(nextFilters) {
    setShopProductIdsFilter([]);
    setFilters(nextFilters);
  }

  function openSaleProducts(productIds = []) {
    setShopProductIdsFilter(productIds.map(Number).filter(Boolean));
    setFilters(defaultCustomerFilters);
    onChange("Shop");
  }

  const load = useCallback(async (options = filtersRef.current, { cancelled, force = false } = {}) => {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== "" && value !== "all" && value !== undefined && value !== null) params.set(key, value);
      if (key === "stock" && value === "all") params.set(key, value);
      if (key === "sortBy") params.set(key, value);
    });
    const productParams = Object.fromEntries(params.entries());
    const [productRes, filterRes, orderRes, notificationRes, shopInfoRes, profileRes, reviewRes, returnRes, cartRes, promotionsRes] = await Promise.all([
      cachedGet("/products", { params: productParams }, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/products/filters", {}, { cacheMs: 10000, retries: 1, force }),
      cachedGet("/orders", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/notifications", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/settings/public", {}, { cacheMs: 10000, retries: 1, force }).catch(() => cachedGet("/users/admin/payment-profile", {}, { cacheMs: 10000, retries: 1, force })),
      cachedGet("/users/me", {}, { cacheMs: 10000, retries: 1, force }),
      cachedGet("/reviews", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/returns", {}, { cacheMs: 8000, retries: 1, force }),
      cachedGet("/cart", {}, { cacheMs: 5000, retries: 1, force }),
      cachedGet("/settings/promotions", {}, { cacheMs: 10000, retries: 1, force })
    ]);
    if (cancelled?.()) return;
    setProducts(productRes.data.filter((item) => Number(item.stock || 0) > 0));
    setFilterOptions(filterRes.data);
    setOrders(orderRes.data);
    setNotifications(notificationRes.data);
    setShopInfo(shopInfoRes.data);
    setProfile(profileRes.data);
    setProfileInitial(profileRes.data);
    setReviews(reviewRes.data);
    setReturnRequests(returnRes.data);
    replaceCart(cartRes.data);
    setPromotions(promotionsRes.data);
  }, []);

  function replaceCart(rows) {
    const nextCart = normalizeCartRows(rows);
    setCart(nextCart);
    setSelectedCartIds(nextCart.filter((item) => item.selected).map((item) => Number(item.product_id)));
  }

  const loadFeaturedApparel = useCallback(async ({ cancelled, force = false } = {}) => {
    setFeaturedLoading(true);
    try {
      const { data } = await fetchFeaturedApparel({ force });
      if (!cancelled?.()) setFeaturedApparel(Array.isArray(data) ? data : []);
    } finally {
      if (!cancelled?.()) setFeaturedLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(filters, { cancelled: () => cancelled }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters, load]);

  useEffect(() => {
    let cancelled = false;
    loadFeaturedApparel({ cancelled: () => cancelled }).catch(() => {
      if (!cancelled) setFeaturedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadFeaturedApparel]);

  useEffect(() => {
    function refreshStock(event) {
      if (event.detail?.type === "shipping") return;
      window.clearTimeout(stockRefreshTimerRef.current);
      stockRefreshTimerRef.current = window.setTimeout(() => {
        load(filtersRef.current, { force: true }).catch(() => {});
        loadFeaturedApparel({ force: true }).catch(() => setFeaturedLoading(false));
        if (cartRef.current.length) recheckCartStock({ silent: true }).catch(() => {});
      }, 400);
    }
    window.addEventListener("retela:data-change", refreshStock);
    return () => {
      window.clearTimeout(stockRefreshTimerRef.current);
      window.removeEventListener("retela:data-change", refreshStock);
    };
  }, [load, loadFeaturedApparel]);

  useEffect(() => {
    if (active !== "Cart") return;
    recheckCartStock().catch(() => {});
  }, [active]);

  useEffect(() => {
    if (!profile?.phone_number) return;
    setPaymentDetails((details) => ({
      gcashNumber: details.gcashNumber || profile.phone_number,
      debitNumber: details.debitNumber || profile.phone_number,
      creditNumber: details.creditNumber || profile.phone_number,
      mayaNumber: details.mayaNumber || profile.phone_number
    }));
  }, [profile?.phone_number]);

  function notifyCart(message) {
    setCartToast(message);
    window.clearTimeout(notifyCart.timer);
    notifyCart.timer = window.setTimeout(() => setCartToast(null), 2200);
  }

  async function addToCart(product, successMessage = "Item added to cart") {
    const stock = Number(product.stock || 0);
    if (stock <= 0) {
      notifyCart("This apparel item is out of stock.");
      return;
    }
    try {
      const { data } = await api.post("/cart/items", { product_id: product.id, quantity: 1, selected: true });
      clearGetCache("/cart");
      replaceCart(data);
      notifyCart(successMessage);
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to add this item.");
    }
  }

  async function buyNow(product) {
    const stock = Number(product.stock || 0);
    if (stock <= 0) {
      notifyCart("This apparel item is out of stock.");
      return;
    }
    try {
      await api.post("/cart/items", { product_id: product.id, quantity: 1, selected: true });
      await api.patch("/cart/selection", { selected: false });
      const { data } = await api.patch(`/cart/items/${product.id}`, { selected: true });
      clearGetCache("/cart");
      replaceCart(data);
      onChange("Cart");
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to prepare checkout.");
    }
  }

  async function updateCartQuantity(productId, delta) {
    const current = cart.find((item) => Number(item.product_id) === Number(productId));
    if (!current) return;
    const quantity = Math.max(1, Math.min(Number(current.stock || 1), Number(current.quantity || 1) + delta));
    try {
      const { data } = await api.patch(`/cart/items/${productId}`, { quantity });
      clearGetCache("/cart");
      replaceCart(data);
      notifyCart("Quantity updated");
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to update quantity.");
    }
  }

  async function removeCartItem(productId) {
    try {
      const { data } = await api.delete(`/cart/items/${productId}`);
      clearGetCache("/cart");
      replaceCart(data);
      notifyCart("Item removed");
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to remove item.");
    }
  }

  useEffect(() => {
    setSelectedCartIds((ids) => ids.filter((id) => cart.some((item) => Number(item.product_id) === id)));
  }, [cart]);

  const loadPromotions = useCallback(async ({ cancelled, force = false } = {}) => {
    const { data } = await cachedGet("/settings/promotions", {}, { cacheMs: 10000, retries: 1, force });
    if (cancelled?.()) return;
    setPromotions(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    function refreshShipping() {
      loadPromotions({ cancelled: () => cancelled, force: true })
        .catch(() => {
          if (!cancelled) setPromotions({ shipping: { type: "fixed", fee: 0 }, coupons: [], sales: [] });
        });
    }
    window.addEventListener("retela:shipping-change", refreshShipping);
    return () => {
      cancelled = true;
      window.removeEventListener("retela:shipping-change", refreshShipping);
    };
  }, [loadPromotions]);

  async function toggleCartSelection(productId) {
    const id = Number(productId);
    const selected = !selectedCartIds.includes(id);
    setSelectedCartIds((ids) => selected ? [...ids, id] : ids.filter((value) => value !== id));
    setCouponError("");
    try {
      const { data } = await api.patch(`/cart/items/${id}`, { selected });
      clearGetCache("/cart");
      replaceCart(data);
    } catch {
      setSelectedCartIds((ids) => selected ? ids.filter((value) => value !== id) : [...ids, id]);
    }
  }

  async function setAllCartSelected(selected) {
    setSelectedCartIds(selected ? cart.map((item) => Number(item.product_id)) : []);
    setCouponError("");
    try {
      const { data } = await api.patch("/cart/selection", { selected });
      clearGetCache("/cart");
      replaceCart(data);
    } catch {
      load(filtersRef.current, { force: true }).catch(() => {});
    }
  }

  const selectedCartItems = useMemo(() => cart.filter((item) => selectedCartIds.includes(Number(item.product_id))), [cart, selectedCartIds]);
  const cartPricing = useMemo(() => calculateCartPricing(selectedCartItems, promotions, appliedCoupon, fulfillmentMethod), [selectedCartItems, promotions, appliedCoupon, fulfillmentMethod]);
  const cartTotal = cartPricing.total;

  async function applyCoupon() {
    const code = couponCode.trim();
    setCouponError("");
    setAppliedCoupon(null);
    if (!code) return;
    if (!selectedCartItems.length) {
      setCouponError("Please select at least one item.");
      return;
    }
    try {
      const { data } = await api.post("/settings/coupons/validate", {
        couponCode: code,
        fulfillmentMethod,
        items: selectedCartItems.map(({ product_id, quantity }) => ({ product_id, quantity }))
      });
      setAppliedCoupon(data.coupon);
      setCouponCode(data.coupon?.code || code.toUpperCase());
      notifyCart("Coupon applied.");
    } catch (error) {
      setCouponError(error?.response?.data?.message || "Coupon is invalid or expired.");
    }
  }

  async function recheckCartStock({ silent = false, productIds = null } = {}) {
    const currentCart = cartRef.current;
    if (!currentCart.length) return true;
    const validationSet = Array.isArray(productIds) ? new Set(productIds.map(Number)) : null;
    const { data } = await cachedGet("/products", { params: { stock: "all" } }, { cacheMs: 5000, retries: 1 });
    const inventory = new Map(data.map((item) => [Number(item.id), item]));
    let ok = true;
    let message = "";
    const nextCart = [];
    for (const item of currentCart) {
      const itemId = Number(item.product_id);
      const shouldValidate = !validationSet || validationSet.has(itemId);
      const current = inventory.get(Number(item.product_id));
      const stock = Number(current?.stock || 0);
      if (!current || stock <= 0) {
        if (shouldValidate) {
          ok = false;
          message ||= "This apparel item is no longer available.";
          continue;
        }
        nextCart.push(item);
        continue;
      }
      const nextQuantity = Math.min(Number(item.quantity || 1), stock);
      if (shouldValidate && nextQuantity < Number(item.quantity || 1)) {
        ok = false;
        message ||= `Only ${stock} items remaining in stock.`;
      }
      nextCart.push({
        ...item,
        name: current.name,
        brand: current.brand,
        category: current.category,
        size: current.size,
        condition: current.condition,
        price: Number(current.price || item.price || 0),
        image_url: current.image_url,
        stock,
        quantity: nextQuantity
      });
    }
    setCart(nextCart);
    if (!ok && !silent) notifyCart(message || "Cart stock was updated.");
    return ok;
  }

  function selectPaymentMethod(method) {
    setPaymentMethod(method);
    setPaymentError("");
    if (method !== "cod" && profile?.phone_number) {
      const key = paymentNumberKey(method);
      setPaymentDetails((details) => ({ ...details, [key]: details[key] || profile.phone_number }));
    }
  }

  function updatePaymentNumber(value) {
    setPaymentDetails((details) => ({ ...details, [paymentNumberKey(paymentMethod)]: value }));
    setPaymentError("");
  }

  async function checkout() {
    const stockOk = await recheckCartStock({ productIds: selectedCartIds });
    if (!stockOk) return;
    const billingPhone = paymentMethod === "cod" ? "" : (paymentDetails[paymentNumberKey(paymentMethod)] || "").trim();
    if (paymentMethod !== "cod" && !isValidPaymentNumber(billingPhone)) {
      const message = `Enter a valid ${paymentNumberLabels[paymentMethod].toLowerCase()}.`;
      setPaymentError(message);
      notifyCart(message);
      return;
    }

    setCheckoutLoading(true);
    let didRedirect = false;
    try {
      if (!selectedCartItems.length) {
        notifyCart("Please select at least one item.");
        return;
      }
      const { data } = await api.post("/orders", {
        payment_method: paymentMethod,
        fulfillment_method: fulfillmentMethod,
        coupon_code: appliedCoupon?.code || "",
        items: selectedCartItems.map(({ product_id, quantity }) => ({ product_id, quantity }))
      });
      clearGetCache("/orders");
      clearGetCache("/cart");
      clearGetCache("/products");
      clearGetCache("/notifications");
      const cartRes = await api.get("/cart");
      replaceCart(cartRes.data);
      setCheckoutSummaryOpen(false);
      setAppliedCoupon(null);
      setCouponCode("");
      if (paymentMethod !== "cod") {
        setRedirectingPayment(paymentMethod);
        const checkoutRes = await api.post("/payments/create-gcash-checkout", { orderId: data.id, paymentMethod, billingPhone });
        didRedirect = true;
        window.location.href = checkoutRes.data.checkoutUrl;
        return;
      }
      notifyCart("Checkout submitted.");
      await load(filtersRef.current, { force: true });
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Checkout failed. Please try again.");
    } finally {
      if (!didRedirect) {
        setCheckoutLoading(false);
        setRedirectingPayment(null);
      }
    }
  }

  function openCheckoutSummary() {
    if (!selectedCartItems.length) {
      setCouponError("Please select at least one item.");
      notifyCart("Please select at least one item.");
      return;
    }
    setCheckoutSummaryOpen(true);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const payload = new FormData();
    Object.entries(profile).forEach(([key, value]) => payload.append(key, value ?? ""));
    if (profilePhoto) payload.append("profilePhoto", profilePhoto);
    try {
      const { data } = await api.patch("/users/me", payload, { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/users/me");
      localStorage.setItem("retela_user", JSON.stringify({ ...user, ...data }));
      setUser({ ...user, ...data });
      setProfile(data);
      setProfileInitial(data);
      setProfilePhoto(null);
      setProfileToast({ type: "success", message: "Profile saved successfully." });
    } catch (error) {
      setProfileToast({ type: "error", message: error?.response?.data?.message || "Could not save profile changes." });
    }
  }

  function resetProfile() {
    setProfile(profileInitial);
    setProfilePhoto(null);
    setProfileToast({ type: "success", message: "Profile changes were reset." });
  }

  async function deactivateAccount() {
    if (!window.confirm("Deactivate your account? You will be signed out and will need admin help to restore access.")) return;
    setDeactivating(true);
    try {
      await api.patch("/users/me/deactivate");
      logout();
    } catch (error) {
      setProfileToast({ type: "error", message: error?.response?.data?.message || "Could not deactivate account." });
      setDeactivating(false);
    }
  }

  if (active === "Home") {
    return (
      <div className="grid min-w-0 gap-5">
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <FeaturedApparelHero
            items={featuredApparel}
            loading={featuredLoading}
            onAddToCart={(item) => addToCart(item, "Added to cart successfully.")}
          />
          <FloatingNotificationsWidget onViewAll={() => onChange("Notifications")} />
        </div>
        <Shop products={filteredProducts.slice(0, 6)} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={updateFilters} filterOptions={filterOptions} />
        {cartToast ? <CartToast message={cartToast} /> : null}
      </div>
    );
  }

  if (active === "Shop") {
    return (
      <div className="grid min-w-0 gap-5">
        <Shop products={filteredProducts} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={updateFilters} filterOptions={filterOptions} clearFilters={clearFilters} />
        {cartToast ? <CartToast message={cartToast} /> : null}
      </div>
    );
  }

  if (active === "Cart") {
    return (
      <>
        <CartPage
          cart={cart}
          selectedCartIds={selectedCartIds}
          selectedItems={selectedCartItems}
          pricing={cartPricing}
          couponCode={couponCode}
          setCouponCode={setCouponCode}
          appliedCoupon={appliedCoupon}
          couponError={couponError}
          applyCoupon={applyCoupon}
          promotions={promotions}
          paymentMethod={paymentMethod}
          selectPaymentMethod={selectPaymentMethod}
          paymentDetails={paymentDetails}
          paymentError={paymentError}
          updatePaymentNumber={updatePaymentNumber}
          updateCartQuantity={updateCartQuantity}
          removeCartItem={removeCartItem}
          toggleCartSelection={toggleCartSelection}
          setAllCartSelected={setAllCartSelected}
          openCheckoutSummary={openCheckoutSummary}
          checkoutLoading={checkoutLoading}
          onShop={() => onChange("Shop")}
        />
        {checkoutSummaryOpen ? (
          <CheckoutSummaryModal
            items={selectedCartItems}
            pricing={cartPricing}
            paymentMethod={paymentMethod}
            paymentDetails={paymentDetails}
            paymentError={paymentError}
            updatePaymentNumber={updatePaymentNumber}
            checkout={checkout}
            checkoutLoading={checkoutLoading}
            onClose={() => setCheckoutSummaryOpen(false)}
          />
        ) : null}
        {cartToast ? <CartToast message={cartToast} /> : null}
        {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
      </>
    );
  }

  if (active === "Shop") {
    return (
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Shop products={filteredProducts} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={setFilters} filterOptions={filterOptions} clearFilters={clearFilters} />
        <Card className="sticky top-24 h-fit rounded-[28px] border-neonbrand/15 bg-white/[0.07] shadow-[0_0_45px_rgba(56,255,136,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Glass Cart</p>
              <h3 className="mt-1 font-display text-xl font-bold text-white">Shopping Cart</h3>
            </div>
            <button type="button" onClick={() => setCartEditing((value) => !value)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand">
              <Edit3 size={15} /> Edit Cart
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {cart.length ? cart.map((item) => (
              <div key={item.product_id} className="cart-row flex gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 text-sm shadow-lg transition duration-300 hover:border-neonbrand/20">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
                  {item.image_url ? <img src={assetUrl(item.image_url)} className="h-full w-full object-cover" alt={item.name} /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-white">{item.name}</strong>
                      <span className="mt-1 block text-xs text-white/45">{item.category || "Item"} · {item.size || "Free Size"}</span>
                    </div>
                    <strong className="shrink-0 text-neonbrand">PHP {(item.price * item.quantity).toLocaleString()}</strong>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                      <button type="button" disabled={!cartEditing || item.quantity <= 1} onClick={() => updateCartQuantity(item.product_id, -1)} className="grid h-9 w-9 place-items-center text-white/70 transition hover:text-neonbrand disabled:opacity-35"><Minus size={15} /></button>
                      <span className="min-w-10 text-center font-bold text-white">{item.quantity}</span>
                      <button type="button" disabled={!cartEditing || item.quantity >= Number(item.stock || 1)} onClick={() => updateCartQuantity(item.product_id, 1)} className="grid h-9 w-9 place-items-center text-white/70 transition hover:text-neonbrand disabled:opacity-35"><Plus size={15} /></button>
                    </div>
                    {cartEditing ? <button type="button" onClick={() => removeCartItem(item.product_id)} className="inline-flex items-center gap-1 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/20"><Trash2 size={14} /> Remove</button> : null}
                  </div>
                </div>
              </div>
            )) : <p className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white/50">Your cart is empty.</p>}
            <p className="rounded-2xl border border-white/10 bg-white/[0.045] p-3 text-xs font-semibold text-white/55">Review your cart and check out when ready.</p>
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Payment Method</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[["cod", "COD"], ["gcash", "GCash"], ["debit", "Debit"], ["credit", "Credit"], ["maya", "Maya"]].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => selectPaymentMethod(value)} className={`inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold transition ${paymentMethod === value ? "bg-neonbrand text-black" : "bg-white/[0.06] text-white/65 hover:text-neonbrand"}`}>
                    {value === "debit" ? <CreditCard size={14} /> : <WalletCards size={14} />}{label}
                  </button>
                ))}
              </div>
              {onlinePaymentMethods.includes(paymentMethod) ? (
                <PaymentDetailsPanel
                  method={paymentMethod}
                  value={paymentDetails[paymentNumberKey(paymentMethod)]}
                  error={paymentError}
                  onChange={updatePaymentNumber}
                />
              ) : null}
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Delivery</p>
              <div className="grid grid-cols-2 gap-2">
                {[["delivery", "Delivery"]].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setFulfillmentMethod(value)} className={`rounded-xl px-3 py-2 text-xs font-bold transition ${fulfillmentMethod === value ? "bg-neonbrand text-black" : "bg-white/[0.06] text-white/65 hover:text-neonbrand"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-4">
              <span className="text-sm font-bold text-white/70">Total</span>
              <strong className="font-display text-2xl text-neonbrand">PHP {cartTotal.toLocaleString()}</strong>
            </div>
            <Button disabled={!cart.length || checkoutLoading} onClick={checkout}><ShoppingCart size={17} /> {checkoutLoading ? "Preparing..." : paymentMethod === "cod" ? "Check out" : `Check out with ${paymentLabel(paymentMethod)}`}</Button>
          </div>
        </Card>
        {cartToast ? <CartToast message={cartToast} /> : null}
        {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
      </div>
    );
  }

  if (active === "Orders") return <Orders rows={orders} profile={profile} reviews={reviews} returnRequests={returnRequests} onNavigate={onChange} />;
  if (active === "Notifications") {
    return (
      <Notifications
        rows={notifications}
        onRead={(id) => setNotifications((items) => items.map((item) => Number(item.id) === Number(id) ? { ...item, is_read: true } : item))}
        onShopSale={openSaleProducts}
      />
    );
  }
  if (active === "About") return <AboutShop shop={shopInfo} />;
  if (active === "Feedback") return <Feedback orders={orders} reviews={reviews} onSaved={() => load(filtersRef.current, { force: true })} />;
  if (active === "Returns") return <ReturnForm orders={orders} returnRequests={returnRequests} onSaved={() => load(filtersRef.current, { force: true })} />;
  return (
    <>
      <Profile profile={profile} setProfile={setProfile} profilePhoto={profilePhoto} setProfilePhoto={setProfilePhoto} saveProfile={saveProfile} onReset={resetProfile} onDeactivate={deactivateAccount} deactivating={deactivating} />
      {profileToast ? <PortalToast toast={profileToast} onClose={() => setProfileToast(null)} /> : null}
    </>
  );
}

function FloatingNotificationsWidget({ onViewAll }) {
  const items = [
    {
      icon: ShoppingCart,
      title: "New Sale",
      body: "5 DIOR Essential T-Shirts sold in the last hour.",
      badge: "+5 Sales",
      time: "2m ago",
      tone: "emerald"
    },
    {
      icon: Megaphone,
      title: "Promo",
      body: "Weekend Sale starts tomorrow. 20% OFF selected apparel.",
      badge: "Promo",
      time: "10m ago",
      tone: "sky"
    },
    {
      icon: PackageCheck,
      title: "Order Update",
      body: "Your latest order is being prepared.",
      badge: "Order",
      time: "Today",
      tone: "amber"
    }
  ];
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    sky: "border-sky-100 bg-sky-50 text-sky-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700"
  };

  return (
    <aside className="group h-fit min-h-[220px] rounded-[20px] border border-white/70 bg-white/85 p-4 shadow-[0_20px_55px_rgba(15,23,42,0.12)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(15,23,42,0.16)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700">
            <Bell size={18} />
          </span>
          <h2 className="font-display text-lg font-bold text-slate-950">Notifications</h2>
        </div>
        <button type="button" onClick={onViewAll} className="rounded-full px-2 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50">
          View All
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="flex gap-3 rounded-2xl border border-slate-100 bg-white/88 p-2.5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-emerald-100 hover:shadow-md">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl border ${tones[item.tone]}`}>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-sm text-slate-950">{item.title}</strong>
                  <span className="shrink-0 text-[11px] font-semibold text-slate-400">{item.time}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</p>
                <span className="mt-1.5 inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{item.badge}</span>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function CartPage({
  cart,
  selectedCartIds,
  selectedItems,
  pricing,
  couponCode,
  setCouponCode,
  appliedCoupon,
  couponError,
  applyCoupon,
  promotions,
  paymentMethod,
  selectPaymentMethod,
  updateCartQuantity,
  removeCartItem,
  toggleCartSelection,
  setAllCartSelected,
  openCheckoutSummary,
  checkoutLoading,
  onShop
}) {
  const allSelected = Boolean(cart.length) && selectedCartIds.length === cart.length;
  const selectedCount = selectedItems.length;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Cart</p>
            <h3 className="mt-1 font-display text-2xl font-bold text-slate-950">Selected items</h3>
          </div>
          <Button type="button" variant="secondary" onClick={onShop}>Continue shopping</Button>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-3">
          <button type="button" onClick={() => setAllCartSelected(!allSelected)} className="inline-flex items-center gap-3 text-sm font-bold text-white">
            <SelectionCircle selected={allSelected} />
            Select All
          </button>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-white/60">{selectedCount} selected</span>
        </div>
        <div className="mt-5 grid gap-3">
          {cart.length ? cart.map((item) => {
            const itemSubtotal = Number(item.price || 0) * Number(item.quantity || 0);
            const sale = saleForItem(item, promotions);
            const selected = selectedCartIds.includes(Number(item.product_id));
            return (
              <div key={item.product_id} className={`flex gap-3 rounded-2xl border p-3 text-sm transition ${selected ? "border-neonbrand/30 bg-neonbrand/10" : "border-slate-200 bg-white"}`}>
                <button type="button" onClick={() => toggleCartSelection(item.product_id)} className="mt-7 shrink-0" aria-label={`${selected ? "Unselect" : "Select"} ${item.name}`}>
                  <SelectionCircle selected={selected} />
                </button>
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                  {item.image_url ? <img src={assetUrl(item.image_url)} className="h-full w-full object-cover" alt={item.name} /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-slate-950">{item.name}</strong>
                      <span className="mt-1 block text-xs text-slate-500">{item.category || "Item"} | {item.size || "Free Size"}</span>
                      <span className="mt-1 block text-xs text-slate-500">PHP {Number(item.price || 0).toLocaleString()} each</span>
                      {sale ? <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">On Sale - {sale.discountPercent}% Off</span> : null}
                      <span className="mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-slate-600">
                        {stockStatus(item.stock)}
                      </span>
                    </div>
                    <strong className="shrink-0 text-emerald-700">PHP {itemSubtotal.toLocaleString()}</strong>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50">
                      <button type="button" disabled={item.quantity <= 1} onClick={() => updateCartQuantity(item.product_id, -1)} className="grid h-9 w-9 place-items-center text-slate-600 transition hover:text-emerald-700 disabled:opacity-35"><Minus size={15} /></button>
                      <span className="min-w-10 text-center font-bold text-slate-900">{item.quantity}</span>
                      <button type="button" disabled={item.quantity >= Number(item.stock || 1)} onClick={() => updateCartQuantity(item.product_id, 1)} className="grid h-9 w-9 place-items-center text-slate-600 transition hover:text-emerald-700 disabled:opacity-35"><Plus size={15} /></button>
                    </div>
                    <button type="button" onClick={() => removeCartItem(item.product_id)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100"><Trash2 size={14} /> Remove</button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Your cart is empty.
            </div>
          )}
        </div>
      </Card>

      <Card className="h-fit">
        <h3 className="font-display text-xl font-bold text-slate-950">Checkout</h3>
        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Payment Method</p>
          <div className="grid grid-cols-2 gap-2">
            {[["cod", "COD"], ["gcash", "GCash"], ["debit", "Debit"], ["credit", "Credit"], ["maya", "Maya"]].map(([value, label]) => (
              <button key={value} type="button" onClick={() => selectPaymentMethod(value)} className={`inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold transition ${paymentMethod === value ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:text-emerald-700"}`}>
                {value === "debit" ? <CreditCard size={14} /> : <WalletCards size={14} />}{label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Coupon Code</p>
          <div className="flex gap-2">
            <input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="ENTER CODE" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
            <button type="button" onClick={applyCoupon} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Apply</button>
          </div>
          {appliedCoupon ? <p className="text-xs font-bold text-emerald-700">{appliedCoupon.code} applied{appliedCoupon.freeShipping ? " with free shipping" : ""}.</p> : null}
          {couponError ? <p className="text-xs font-bold text-rose-600">{couponError}</p> : null}
        </div>
        <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <strong className="text-slate-900">{money(pricing.subtotal)}</strong>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Coupon Discount</span>
            <strong className="text-emerald-700">-{money(pricing.couponDiscount)}</strong>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Sales Discount</span>
            <strong className="text-emerald-700">-{money(pricing.saleDiscount)}</strong>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Shipping Fee</span>
            <strong className="text-slate-900">{money(pricing.shippingFee)}</strong>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm font-bold text-slate-700">Total</span>
            <strong className="font-display text-2xl text-emerald-700">{money(pricing.total)}</strong>
          </div>
        </div>
        {!selectedCount ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">Please select at least one item.</p> : null}
        <Button className="mt-4 w-full" disabled={!selectedCount || checkoutLoading} onClick={openCheckoutSummary}>
          <ShoppingCart size={17} /> {checkoutLoading ? "Preparing..." : paymentMethod === "cod" ? "Checkout" : `Checkout with ${paymentLabel(paymentMethod)}`}
        </Button>
      </Card>
    </div>
  );
}

function FeaturedApparelHero({ items, loading, onAddToCart }) {
  const [selectedApparel, setSelectedApparel] = useState(null);
  const availableItems = useMemo(() => items.filter((item) => Number(item.stock || 0) > 0), [items]);

  function openDetails(item) {
    setSelectedApparel(item);
  }

  function closeDetails() {
    setSelectedApparel(null);
  }

  useEffect(() => {
    if (!selectedApparel) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") closeDetails();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedApparel]);

  if (loading) {
    return (
      <Card className="grid min-h-[320px] place-items-center overflow-hidden rounded-[24px]">
        <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-500">
          <Loader2 size={17} className="animate-spin" /> Loading featured apparel
        </p>
      </Card>
    );
  }

  if (!availableItems.length) {
    return (
      <Card className="grid min-h-[230px] place-items-center rounded-[24px]">
        <p className="text-center text-sm font-bold text-slate-500">No featured apparel available.</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="retela-featured-hero overflow-hidden rounded-[24px] p-0">
        <div className="relative">
          <Swiper
            modules={[A11y, Autoplay, EffectFade, Navigation, Pagination]}
            effect="fade"
            fadeEffect={{ crossFade: true }}
            loop={availableItems.length > 1}
            speed={700}
            autoplay={{
              delay: 4000,
              disableOnInteraction: false,
              pauseOnMouseEnter: true
            }}
            navigation={{
              prevEl: ".retela-featured-prev",
              nextEl: ".retela-featured-next"
            }}
            pagination={{
              el: ".retela-featured-pagination",
              clickable: true
            }}
            slidesPerView={1}
            preloadImages={false}
            className="retela-featured-swiper"
          >
            {availableItems.map((item) => {
              const image = item.images?.[0] || item.image_url;
              return (
                <SwiperSlide key={item.id}>
                  <button
                    type="button"
                    className="grid min-h-[370px] w-full cursor-pointer gap-0 text-left lg:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.58fr)]"
                    onClick={() => openDetails(item)}
                  >
                    <div className="min-h-[270px] overflow-hidden bg-slate-950/85 lg:min-h-[420px]">
                      {image ? (
                        <img
                          src={assetUrl(image)}
                          alt={item.name}
                          loading="lazy"
                          className="h-full min-h-[270px] w-full object-contain lg:min-h-[420px]"
                        />
                      ) : (
                        <div className="grid h-full min-h-[270px] place-items-center text-white/35 lg:min-h-[420px]">
                          <FileImage size={42} />
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col justify-center gap-3 bg-white p-4 text-slate-950 sm:p-6 lg:p-7">
                      <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Available</span>
                      <div className="min-w-0">
                        <h3 className="break-words font-display text-2xl font-bold leading-tight sm:text-3xl">{item.name}</h3>
                        <p className="mt-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">{item.brand || "Other"} | {item.category || "Apparel"}</p>
                      </div>
                      <div className="grid gap-2 text-sm text-slate-600">
                        <p><span className="font-bold text-slate-900">Price:</span> {money(item.price)}</p>
                        <p><span className="font-bold text-slate-900">Condition:</span> {item.condition || "Good"}</p>
                        <p className="line-clamp-3 leading-6">{item.description || "No description provided."}</p>
                      </div>
                      <span className="inline-flex w-fit items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-xl transition hover:bg-emerald-700">
                        View Details
                      </span>
                    </div>
                  </button>
                </SwiperSlide>
              );
            })}
          </Swiper>

          <button type="button" className="retela-featured-prev absolute left-3 top-1/2 z-20 inline-flex -translate-y-1/2 items-center gap-1 rounded-2xl border border-white/20 bg-black/55 px-3 py-2 text-xs font-bold text-white backdrop-blur transition hover:bg-black/75" onClick={(event) => event.stopPropagation()}>
            <ChevronLeft size={16} /> Previous
          </button>
          <button type="button" className="retela-featured-next absolute right-3 top-1/2 z-20 inline-flex -translate-y-1/2 items-center gap-1 rounded-2xl border border-white/20 bg-black/55 px-3 py-2 text-xs font-bold text-white backdrop-blur transition hover:bg-black/75" onClick={(event) => event.stopPropagation()}>
            Next <ChevronRight size={16} />
          </button>
          <div className="retela-featured-pagination absolute bottom-4 left-0 right-0 z-20 flex justify-center gap-2" />
        </div>
      </Card>

      {selectedApparel ? (
        <FeaturedApparelDetailsModal
          item={selectedApparel}
          onClose={closeDetails}
          onAddToCart={onAddToCart}
        />
      ) : null}
    </>
  );
}

function FeaturedApparelDetailsModal({ item, onClose, onAddToCart }) {
  const gallery = useMemo(() => {
    const images = item.images?.length ? item.images : [item.image_url];
    return images.map((image) => String(image || "").trim()).filter(Boolean);
  }, [item]);
  const [activeImage, setActiveImage] = useState(gallery[0] || "");
  const stock = Number(item.stock || 0);
  const outOfStock = stock <= 0;

  useEffect(() => {
    setActiveImage(gallery[0] || "");
  }, [gallery]);

  return createPortal(
    <div className="fixed inset-0 z-[220] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <section
        className="max-h-[92vh] w-[96vw] max-w-[1080px] overflow-y-auto rounded-[28px] border border-emerald-100 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="featured-apparel-details-title"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/95 p-5 backdrop-blur">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Apparel Details</p>
            <h3 id="featured-apparel-details-title" className="mt-1 truncate font-display text-2xl font-bold text-slate-950">{item.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700" aria-label="Close details">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="grid gap-3">
            <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-3xl bg-slate-100">
              {activeImage ? (
                <img src={assetUrl(activeImage)} alt={item.name} className="max-h-[62vh] w-full object-contain" />
              ) : (
                <div className="grid min-h-[320px] place-items-center text-slate-400"><FileImage size={42} /></div>
              )}
            </div>
            {gallery.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {gallery.map((image) => (
                  <button
                    type="button"
                    key={image}
                    onClick={() => setActiveImage(image)}
                    className={`h-20 w-20 shrink-0 overflow-hidden rounded-2xl border bg-slate-100 transition ${activeImage === image ? "border-emerald-500 ring-4 ring-emerald-100" : "border-slate-200 hover:border-emerald-200"}`}
                  >
                    <img src={assetUrl(image)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid content-start gap-4">
            <div>
              <h4 className="break-words font-display text-3xl font-bold text-slate-950">{item.name}</h4>
              <p className="mt-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">{item.brand || "Other"} | {item.category || "Apparel"}</p>
            </div>
            <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <DetailRow label="Brand" value={item.brand || "Other"} />
              <DetailRow label="Category" value={item.category || "Apparel"} />
              <DetailRow label="Size" value={item.size || "Free Size"} />
              <DetailRow label="Condition" value={item.condition || "Good"} />
              <DetailRow label="Price" value={money(item.price)} />
              <DetailRow label="Status" value={stockStatus(stock)} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Description</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.description || "No description provided."}</p>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 p-5 backdrop-blur sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
            Close
          </button>
          <Button type="button" disabled={outOfStock} onClick={() => onAddToCart(item)}>
            <ShoppingCart size={17} /> {outOfStock ? "Out of Stock" : "Add to Cart"}
          </Button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function Shop({ products, addToCart, buyNow, filters, setFilters, filterOptions, clearFilters }) {
  const [selectedApparel, setSelectedApparel] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const purchasableProducts = useMemo(() => products.filter((item) => Number(item.stock || 0) > 0), [products]);

  function openDetails(item) {
    setSelectedApparel(item);
    setIsDetailsModalOpen(true);
  }

  function closeDetails() {
    setIsDetailsModalOpen(false);
    setIsPhotoModalOpen(false);
    setSelectedApparel(null);
  }

  function closePhoto() {
    setIsPhotoModalOpen(false);
  }

  useEffect(() => {
    if (!isDetailsModalOpen && !isPhotoModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (isPhotoModalOpen) closePhoto();
      else closeDetails();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDetailsModalOpen, isPhotoModalOpen]);

  useEffect(() => {
    if (!selectedApparel) return;
    const latest = purchasableProducts.find((item) => Number(item.id) === Number(selectedApparel.id));
    if (!latest) {
      setIsDetailsModalOpen(false);
      setIsPhotoModalOpen(false);
      setSelectedApparel(null);
      return;
    }
    if (latest !== selectedApparel) setSelectedApparel(latest);
  }, [purchasableProducts, selectedApparel]);

  return (
    <>
      <Card>
        <div className="mb-4 grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Shop search</p>
              <h3 className="mt-1 font-display text-2xl font-bold text-white">Shop Apparel</h3>
            </div>
            <button type="button" onClick={clearFilters} className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand">
              Clear filters
            </button>
          </div>
          <CustomerFilters filters={filters} setFilters={setFilters} filterOptions={filterOptions} />
          <p className="text-sm text-white/55">{purchasableProducts.length} apparel items found</p>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {purchasableProducts.map((p) => {
            const status = stockStatus(p.stock);
            return (
              <article key={p.id} className="flex h-full min-w-0 flex-col rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="relative">
                  {p.image_url ? <img src={assetUrl(p.image_url)} className="h-48 w-full rounded-xl object-cover" alt={p.name} /> : <div className="grid h-48 place-items-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-400">No image</div>}
                  <span className={`absolute right-3 top-3 rounded-full border px-3 py-1 text-xs font-black ${stockBadgeClass(p.stock)}`}>{status}</span>
                </div>
                <h4 className="mt-3 break-words font-bold text-slate-950">{p.name}</h4>
                <div className="mt-2 grid gap-1 text-sm text-slate-600">
                  <p><span className="font-semibold text-slate-800">Brand:</span> {p.brand || "Other"}</p>
                  <p><span className="font-semibold text-slate-800">Category:</span> {p.category || "T-Shirts"}</p>
                  <p><span className="font-semibold text-slate-800">Size:</span> {p.size || "Free Size"}</p>
                  <p><span className="font-semibold text-slate-800">Price:</span> PHP {Number(p.price || 0).toLocaleString()}</p>
                  <p><span className="font-semibold text-slate-800">Status:</span> {status}</p>
                </div>
                {p.description ? <p className="mt-2 line-clamp-3 break-words text-xs leading-5 text-slate-500">{p.description}</p> : null}
                <div className="mt-auto flex items-stretch justify-between gap-3 pt-4">
                  <button type="button" onClick={() => openDetails(p)} className="flex h-14 min-h-14 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                    <Eye size={15} /> View Details
                  </button>
                  <button type="button" onClick={() => addToCart(p)} className="flex h-14 min-h-14 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xl transition hover:bg-emerald-700">
                    <ShoppingCart size={16} /> Add
                  </button>
                  <button type="button" onClick={() => buyNow(p)} className="flex h-14 min-h-14 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xl transition hover:bg-emerald-700">
                    Buy Now
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </Card>
      {selectedApparel && isDetailsModalOpen ? (
        <ApparelDetailsModal
          item={selectedApparel}
          onClose={closeDetails}
          onViewPhoto={() => setIsPhotoModalOpen(true)}
          onAdd={addToCart}
          onBuyNow={buyNow}
        />
      ) : null}
      {selectedApparel && isPhotoModalOpen ? (
        <ApparelPhotoModal item={selectedApparel} onClose={closePhoto} />
      ) : null}
    </>
  );
}

function CustomerFilters({ filters, setFilters, filterOptions }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Field icon={Search} placeholder="Search apparel, brands, or categories" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
      <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })}>
        <option value="all">Brand</option>
        {productBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
      </select>
      <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
        <option value="all">Category</option>
        {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.size} onChange={(e) => setFilters({ ...filters, size: e.target.value })}>
        <option value="all">Size</option>
        {productSizes.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
      <input className="rounded-xl border border-slate-200 bg-white p-3 text-sm" type="number" min="0" placeholder="Min price" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} />
      <input className="rounded-xl border border-slate-200 bg-white p-3 text-sm" type="number" min="0" placeholder="Max price" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} />
      <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}>
        <option value="latest">Latest</option>
        <option value="lowest_price">Price: Low to High</option>
        <option value="highest_price">Price: High to Low</option>
        <option value="name_asc">Name A-Z</option>
      </select>
      <select className="rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })}>
        <option value="all">All</option>
        <option value="in_stock">In Stock</option>
      </select>
    </div>
  );
}

function ApparelDetailsModal({ item, onClose, onViewPhoto, onAdd, onBuyNow }) {
  const status = stockStatus(item.stock);
  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <section
        className="max-h-[90vh] w-[95vw] max-w-[800px] overflow-y-auto rounded-[28px] border border-emerald-100 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.38)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apparel-details-title"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 p-5 backdrop-blur">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${stockBadgeClass(item.stock)}`}>{status}</span>
            <h3 id="apparel-details-title" className="mt-3 break-words font-display text-2xl font-bold text-slate-950">{item.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700" aria-label="Close details">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 p-5">
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <DetailRow label="Apparel Name" value={item.name} />
            <DetailRow label="Brand" value={item.brand || "Other"} />
            <DetailRow label="Category" value={item.category || "T-Shirts"} />
            <DetailRow label="Size" value={item.size || "Free Size"} />
            <DetailRow label="Condition" value={item.condition || "Good"} />
            <DetailRow label="Status" value={status} />
            <DetailRow label="Price" value={`PHP ${Number(item.price || 0).toLocaleString()}`} />
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Description</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{item.description || "No description provided."}</p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                Close
              </button>
              <button type="button" onClick={onViewPhoto} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">
                <FileImage size={17} /> View Photo
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => onAdd(item)}><ShoppingCart size={17} /> Add to Cart</Button>
              <Button onClick={() => onBuyNow(item)}>Buy Now</Button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ApparelPhotoModal({ item, onClose }) {
  return createPortal(
    <div className="fixed inset-0 z-[210] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <section
        className="w-[95vw] max-w-[800px] rounded-[28px] border border-emerald-100 bg-white p-4 shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Apparel photo"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-bold text-slate-950">Apparel Photo</h3>
          <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
            <X size={16} /> Close
          </button>
        </div>
        <div className="grid min-h-72 place-items-center overflow-hidden rounded-2xl bg-slate-100">
          {item.image_url ? (
            <img src={assetUrl(item.image_url)} className="max-h-[76vh] w-full object-contain" alt={item.name} />
          ) : (
            <p className="p-8 text-center text-sm font-semibold text-slate-500">No image available</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <strong className="text-right text-slate-900">{value}</strong>
    </div>
  );
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function saleForItem(item, promotions) {
  const id = Number(item.product_id || item.id);
  return (promotions?.sales || []).find((sale) => (sale.productIds || []).map(Number).includes(id));
}

function calculateCartPricing(items, promotions, coupon, fulfillmentMethod = "delivery") {
  let subtotal = 0;
  let saleDiscount = 0;
  const itemSummaries = items.map((item) => {
    const lineSubtotal = Number(item.price || 0) * Number(item.quantity || 0);
    const sale = saleForItem(item, promotions);
    const lineSaleDiscount = sale ? lineSubtotal * (Number(sale.discountPercent || 0) / 100) : 0;
    subtotal += lineSubtotal;
    saleDiscount += lineSaleDiscount;
    return { ...item, lineSubtotal, sale, lineSaleDiscount };
  });
  const couponBase = Math.max(0, subtotal - saleDiscount);
  const couponDiscount = coupon ? couponBase * (Number(coupon.discountPercent || 0) / 100) : 0;
  const shippingFee = fulfillmentMethod === "delivery" && promotions?.shipping?.type !== "free" && !coupon?.freeShipping ? Number(promotions?.shipping?.fee || 0) : 0;
  return {
    items: itemSummaries,
    subtotal,
    saleDiscount,
    couponDiscount,
    shippingFee,
    total: Math.max(0, subtotal - saleDiscount - couponDiscount + shippingFee)
  };
}

function SelectionCircle({ selected }) {
  return (
    <span className={`grid h-6 w-6 place-items-center rounded-full border transition ${selected ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"}`}>
      {selected ? <CheckCircle2 size={15} /> : null}
    </span>
  );
}

function CartToast({ message }) {
  return (
    <div className="fade-slide fixed bottom-5 right-5 z-[260] rounded-2xl border border-neonbrand/20 bg-black/85 px-4 py-3 text-sm font-bold text-white shadow-[0_0_45px_rgba(56,255,136,0.18)] backdrop-blur-2xl">
      {message}
    </div>
  );
}

function PaymentDetailsPanel({ method, value, error, onChange }) {
  const Icon = method === "debit" || method === "credit" ? CreditCard : WalletCards;
  return (
    <div className="grid gap-2 rounded-2xl border border-neonbrand/15 bg-neonbrand/5 p-3">
      <label className="grid gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/70">{paymentNumberLabels[method]}</span>
        <span className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2 transition ${error ? "border-rose-300/50 bg-rose-500/10" : "border-white/10 bg-black/25 focus-within:border-neonbrand/50"}`}>
          <Icon size={18} className="shrink-0 text-neonbrand" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/35"
            value={value}
            inputMode="tel"
            placeholder={method === "gcash" || method === "maya" ? "09XXXXXXXXX" : "Billing mobile number"}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
      </label>
      {error ? <p className="text-xs font-semibold text-rose-200">{error}</p> : null}
      <p className="flex items-start gap-2 text-xs leading-5 text-white/50">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-neonbrand" />
        {paymentNumberHelp[method]}
      </p>
    </div>
  );
}

function CheckoutSummaryModal({ items, pricing, paymentMethod, paymentDetails, paymentError, updatePaymentNumber, checkout, checkoutLoading, onClose }) {
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[175] grid place-items-center overflow-y-auto bg-black/45 p-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.section
        className="my-6 w-full max-w-2xl rounded-[28px] border border-neonbrand/25 bg-slate-950/92 p-5 text-white shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_55px_rgba(56,255,136,0.12)] backdrop-blur-2xl sm:p-6"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.96 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">{paymentMethod === "cod" ? "Cash on Delivery" : `Checkout with ${paymentLabel(paymentMethod)}`}</p>
            <h3 className="mt-2 font-display text-2xl font-bold">Checkout Summary</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/65 transition hover:text-neonbrand">Cancel</button>
        </div>

        <div className="mt-5 grid max-h-72 gap-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.product_id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.055] p-3">
              <div className="min-w-0">
                <strong className="block truncate">{item.name}</strong>
                <span className="text-xs text-white/45">Qty {item.quantity} x {money(item.price)}</span>
              </div>
              <strong className="shrink-0 text-neonbrand">{money(Number(item.price || 0) * Number(item.quantity || 0))}</strong>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-2 rounded-2xl border border-white/10 bg-black/25 p-4">
          <SummaryLine label="Subtotal" value={money(pricing.subtotal)} />
          <SummaryLine label="Coupon Discount" value={`-${money(pricing.couponDiscount)}`} highlight />
          <SummaryLine label="Sales Discount" value={`-${money(pricing.saleDiscount)}`} highlight />
          <SummaryLine label="Shipping Fee" value={money(pricing.shippingFee)} />
          <SummaryLine label="Final Total" value={money(pricing.total)} strong />
        </div>

        <div className="mt-5 rounded-2xl border border-neonbrand/15 bg-neonbrand/5 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/75">Selected Payment Method</p>
          <h4 className="mt-1 font-display text-xl font-bold">{paymentMethod === "cod" ? "Cash on Delivery" : `Checkout with ${paymentLabel(paymentMethod)}`}</h4>
          {onlinePaymentMethods.includes(paymentMethod) ? (
            <div className="mt-3">
              <PaymentDetailsPanel
                method={paymentMethod}
                value={paymentDetails[paymentNumberKey(paymentMethod)]}
                error={paymentError}
                onChange={updatePaymentNumber}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={checkoutLoading} className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:text-neonbrand disabled:opacity-60">Cancel</button>
          <Button type="button" onClick={checkout} disabled={checkoutLoading}>
            {checkoutLoading ? <Loader2 size={17} className="animate-spin" /> : <ShoppingCart size={17} />}
            Confirm Checkout
          </Button>
        </div>
      </motion.section>
    </motion.div>,
    document.body
  );
}

function SummaryLine({ label, value, highlight = false, strong = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${strong ? "border-t border-white/10 pt-3" : ""}`}>
      <span className={`${strong ? "font-bold text-white" : "text-sm text-white/58"}`}>{label}</span>
      <strong className={`${highlight ? "text-neonbrand" : "text-white"} ${strong ? "font-display text-2xl text-neonbrand" : "text-sm"}`}>{value}</strong>
    </div>
  );
}

function PaymentLoadingOverlay({ method }) {
  return (
    <motion.div
      className="fixed inset-0 z-[180] grid place-items-center bg-black/78 p-4 backdrop-blur-2xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="w-full max-w-md rounded-[30px] border border-neonbrand/25 bg-white/[0.07] p-6 text-center text-white shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_60px_rgba(56,255,136,0.16)]"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl border border-neonbrand/30 bg-neonbrand/10 text-neonbrand shadow-[0_0_38px_rgba(56,255,136,0.18)]">
          <Loader2 size={30} className="animate-spin" />
        </span>
        <h3 className="mt-5 font-display text-2xl font-bold">Opening {paymentLabel(method)}</h3>
        <p className="mt-2 text-sm leading-6 text-white/58">
          Creating your secure checkout session. You will be redirected to complete payment.
        </p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-neonbrand shadow-[0_0_24px_rgba(56,255,136,0.45)]" />
        </div>
      </motion.div>
    </motion.div>
  );
}

function Notifications({ rows, onRead, onShopSale }) {
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function openNotification(notification) {
    setSelectedNotification({ ...notification, is_read: true });
    if (!notification.is_read) {
      onRead?.(notification.id);
      window.dispatchEvent(new CustomEvent("retela:notification-read", { detail: { id: notification.id } }));
      await api.patch(`/notifications/${notification.id}/read`).catch(() => {});
    }
  }

  function closeNotification() {
    setSelectedNotification(null);
  }

  function handleCopyPromo(code) {
    const promoCode = String(code || "").trim();
    if (!promoCode) return;
    navigator.clipboard?.writeText(promoCode).catch(() => {});
    setToast("Promo code copied.");
  }

  return (
    <>
      <div className="grid gap-4">
        {rows.length ? rows.map((notification) => {
          const unread = !notification.is_read;
          const typeLabel = notificationDisplayType(notification);
          const promoStatus = notificationPromoStatus(notification);
          return (
            <button key={notification.id} type="button" onClick={() => openNotification(notification)} className="group text-left outline-none">
              <Card className={`transition hover:-translate-y-0.5 hover:border-neonbrand/35 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-emerald-950/10 ${unread ? "border-neonbrand/35 bg-neonbrand/10" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${unread ? "bg-neonbrand shadow-[0_0_16px_rgba(56,255,136,0.55)]" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className={`break-words ${unread ? "text-white" : ""}`}>{notification.title}</strong>
                      <span className="rounded-full border border-neonbrand/20 bg-neonbrand/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-neonbrand">{typeLabel}</span>
                      {promoStatus ? <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em] ${promoStatus.expired ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{promoStatus.label}</span> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-slate-500">{notification.body || notification.message}</p>
                    <p className="mt-2 text-xs font-semibold text-white/45">{formatNotificationDate(notification.created_at)}</p>
                  </div>
                </div>
              </Card>
            </button>
          );
        }) : (
          <Card>
            <EmptyState title="No notifications yet" subtitle="Order updates, broadcasts, promos, and system alerts will appear here." />
          </Card>
        )}
      </div>
      {toast ? <CartToast message={toast} /> : null}
      <AnimatePresence>
        {selectedNotification ? (
          <NotificationDetailModal
            notification={selectedNotification}
            onClose={closeNotification}
            onCopyPromo={handleCopyPromo}
            onShopSale={onShopSale}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function notificationDisplayType(notification) {
  const type = notification?.type;
  const promotional = Boolean(notification?.promo_code || Number(notification?.discount_percentage || 0) > 0 || notification?.broadcast?.sale_enabled || type === "new_product");
  if (type === "broadcast" && promotional) return "promo";
  if (type === "broadcast") return "broadcast";
  if (type === "refund") return "return";
  if (type === "message") return "message";
  if (type === "order") return "order";
  return promotional ? "promo" : "system";
}

function notificationPromoStatus(notification) {
  const hasPromo = Boolean(notification?.promo_code || Number(notification?.discount_percentage || 0) > 0 || notification?.broadcast?.sale_enabled);
  if (!hasPromo) return null;
  const now = Date.now();
  const startsAt = notification?.promo_starts_at || notification?.broadcast?.starts_at;
  const endsAt = notification?.promo_ends_at || notification?.broadcast?.ends_at;
  const startsTime = startsAt ? new Date(startsAt).getTime() : null;
  const endsTime = endsAt ? new Date(endsAt).getTime() : null;
  const expired = Boolean(endsTime && !Number.isNaN(endsTime) && endsTime < now);
  const upcoming = Boolean(startsTime && !Number.isNaN(startsTime) && startsTime > now);
  if (expired) return { label: "Expired Promo", expired: true, active: false };
  if (upcoming) return { label: "Scheduled Promo", expired: false, active: false };
  return { label: "Active Promo", expired: false, active: true };
}

function NotificationDetailModal({ notification, onClose, onCopyPromo, onShopSale }) {
  const promoStatus = notificationPromoStatus(notification);
  const displayType = notificationDisplayType(notification);
  const promoCode = notification.promo_code || notification.broadcast?.promo_code || "";
  const discount = Number(notification.discount_percentage || notification.broadcast?.discount_percentage || 0);
  const relatedProducts = Array.isArray(notification.related_products) ? notification.related_products : [];
  const saleProductIds = relatedProducts.length
    ? relatedProducts.map((item) => Number(item.id)).filter(Boolean)
    : (notification.broadcast?.product_ids || []).map(Number).filter(Boolean);
  const promotional = Boolean(promoStatus || promoCode || discount || displayType === "promo");
  const hasBroadcastSaleItems = Boolean(notification.broadcast?.sale_enabled && saleProductIds.length);
  const shopDisabled = Boolean(promoStatus?.expired || promoStatus?.label === "Scheduled Promo");

  function viewPromo() {
    if (shopDisabled) return;
    onClose();
    onShopSale?.(saleProductIds);
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[210] grid place-items-center bg-black/60 p-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
      role="presentation"
    >
      <motion.section
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-neonbrand/20 bg-[#07110d]/95 p-5 text-white shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_65px_rgba(56,255,136,0.12)]"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.96 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-detail-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-neonbrand/25 bg-neonbrand/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-neonbrand">
                {displayType === "promo" ? <Tag size={13} /> : <Megaphone size={13} />}
                {displayType}
              </span>
              {promoStatus ? <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${promoStatus.expired ? "bg-rose-500/15 text-rose-200" : "bg-emerald-400/15 text-emerald-100"}`}>{promoStatus.label}</span> : null}
            </div>
            <h3 id="notification-detail-title" className="mt-3 break-words font-display text-2xl font-bold">{notification.title}</h3>
            <p className="mt-1 text-sm font-semibold text-white/48">{formatNotificationDate(notification.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:border-neonbrand/35 hover:text-neonbrand" aria-label="Close notification">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">Full Message</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/78">{notification.message || notification.body}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NotificationInfo label="Type" value={displayType} />
            <NotificationInfo label="Date and Time" value={formatNotificationDate(notification.created_at)} />
            {discount ? <NotificationInfo label="Discount" value={`${discount}% Off`} /> : null}
            {(notification.promo_starts_at || notification.broadcast?.starts_at) ? <NotificationInfo label="Start Date" value={formatNotificationDate(notification.promo_starts_at || notification.broadcast?.starts_at)} /> : null}
            {(notification.promo_ends_at || notification.broadcast?.ends_at) ? <NotificationInfo label="End Date" value={formatNotificationDate(notification.promo_ends_at || notification.broadcast?.ends_at)} /> : null}
          </div>

          {promoCode ? (
            <div className="rounded-3xl border border-neonbrand/20 bg-neonbrand/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-neonbrand/75">Promo Code</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <strong className="break-all font-display text-2xl text-neonbrand">{promoCode}</strong>
                <button type="button" onClick={() => onCopyPromo(promoCode)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/25 bg-neonbrand px-4 py-3 text-sm font-black text-black transition hover:-translate-y-0.5">
                  <Copy size={16} /> Copy Promo Code
                </button>
              </div>
            </div>
          ) : null}

          {relatedProducts.length ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">Related Products</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {relatedProducts.map((product) => (
                  <div key={product.id} className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-black/18 p-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
                      {product.image_url ? <img src={assetUrl(product.image_url)} alt={product.name} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 text-sm">
                      <strong className="block truncate">{product.name}</strong>
                      <span className="mt-1 block truncate text-xs text-white/48">{product.category || "Item"} | {product.size || "Free Size"}</span>
                      <span className="mt-1 block text-xs font-bold text-neonbrand">{money(product.price)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white/72 transition hover:border-white/20 hover:bg-white/[0.1]">Close</button>
            {promotional ? (
              <button type="button" disabled={shopDisabled} onClick={viewPromo} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neonbrand px-5 py-3 text-sm font-black text-black shadow-[0_0_26px_rgba(56,255,136,0.24)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45">
                <ShoppingCart size={17} /> {hasBroadcastSaleItems ? "View Sale Items" : promoCode ? "View Promo" : "Shop Now"}
              </button>
            ) : null}
          </div>
        </div>
      </motion.section>
    </motion.div>,
    document.body
  );
}

function NotificationInfo({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-white/82">{value || "Not available"}</p>
    </div>
  );
}

function formatNotificationDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Orders({ rows, profile, reviews = [], returnRequests = [], onNavigate }) {
  const flow = ["pending", "awaiting_payment", "paid", "processing", "completed"];
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState(null);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [redirectingPayment, setRedirectingPayment] = useState(null);
  const reviewedOrderIds = useMemo(() => new Set(reviews.map((review) => Number(review.order_id))), [reviews]);
  const returnStateByOrder = useMemo(() => {
    const map = new Map();
    returnRequests.forEach((request) => map.set(Number(request.order_id), request.status));
    return map;
  }, [returnRequests]);

  useEffect(() => {
    if (!paymentMessage) return undefined;
    const timer = window.setTimeout(() => setPaymentMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [paymentMessage]);

  async function payOrder(order, event) {
    event?.stopPropagation();
    if (!order || order.payment_method === "cod") return;
    const billingPhone = profile?.phone_number || order.phone_number || "";
    if (!isValidPaymentNumber(billingPhone)) {
      setPaymentMessage(`Add a valid ${paymentNumberLabels[order.payment_method].toLowerCase()} in your Profile before paying.`);
      return;
    }
    setPayingOrderId(order.id);
    setRedirectingPayment(order.payment_method);
    let didRedirect = false;
    try {
      const { data } = await api.post("/payments/create-gcash-checkout", { orderId: order.id, paymentMethod: order.payment_method, billingPhone });
      didRedirect = true;
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setPaymentMessage(error?.response?.data?.message || "Could not open the payment page.");
    } finally {
      if (!didRedirect) {
        setPayingOrderId(null);
        setRedirectingPayment(null);
      }
    }
  }

  useEffect(() => {
    if (!selectedOrderId) return undefined;
    let alive = true;
    setLoading(true);
    api.get(`/orders/${selectedOrderId}/items`)
      .then(({ data }) => {
        if (alive) setSelectedOrder(data);
      })
      .catch(() => {
        if (alive) setSelectedOrder(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      alive = false;
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedOrderId]);

  function openAction(target, event) {
    event.stopPropagation();
    onNavigate?.(target);
  }

  return (
    <div className="grid gap-4">
      {paymentMessage ? <CartToast message={paymentMessage} /> : null}
      {rows.map((order) => (
        <div key={order.id} role="button" tabIndex={0} onClick={() => setSelectedOrderId(order.id)} onKeyDown={(event) => event.key === "Enter" ? setSelectedOrderId(order.id) : null} className="text-left outline-none">
        <Card className="rounded-[20px] border-slate-100 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_20px_45px_rgba(15,23,42,0.1)]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50 text-sm font-black text-emerald-700">
                {order.first_product_image ? <img src={assetUrl(order.first_product_image)} className="h-full w-full object-cover" alt={order.first_product_name || "Order apparel"} /> : brandInitials(order.brands)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-slate-950">{order.brands || "RETELA Apparel"}</strong>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${order.status === "completed" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-sky-100 bg-sky-50 text-sky-700"}`}>{customerOrderStatus(order.status)}</span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-slate-700">{order.first_product_name || order.product_names || "Apparel order"}</p>
                <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                  <OrderMeta label="Order No." value={orderNumber(order)} />
                  <OrderMeta label="Amount" value={money(order.total_amount)} />
                  <OrderMeta label="Purchased" value={formatDate(order.created_at)} />
                  <OrderMeta label="Delivered" value={order.status === "completed" ? formatDate(order.updated_at || order.created_at) : "Pending"} />
                </div>
                {order.tracking_number ? <p className="mt-2 break-words text-xs font-bold text-emerald-700">Tracking: {order.tracking_number}</p> : null}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:w-[360px]">
              <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedOrderId(order.id); }} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                <Eye size={15} /> View Details
              </button>
              <button type="button" disabled={order.status !== "completed" || reviewedOrderIds.has(Number(order.id))} onClick={(event) => openAction("Feedback", event)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
                <Star size={15} /> Leave Feedback
              </button>
              <button type="button" disabled={!canRequestReturn(order, returnStateByOrder.get(Number(order.id)))} onClick={(event) => openAction("Returns", event)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
                <RotateCcw size={15} /> Request Return
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">{flow.map((s) => <div key={s} className={`h-1.5 rounded-full ${flow.indexOf(s) <= flow.indexOf(order.status) ? "bg-emerald-500" : "bg-slate-200"}`} />)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {order.fulfillment_method === "delivery" ? (
              <a onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.location || "delivery location")}`} target="_blank" rel="noreferrer">
                <MapPin size={15} /> Open tracking map
              </a>
            ) : null}
            {order.payment_method !== "cod" && order.payment_status !== "paid" ? (
              <button type="button" onClick={(event) => payOrder(order, event)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-[0_12px_24px_rgba(22,163,74,0.18)]">
                <WalletCards size={15} /> {payingOrderId === order.id ? "Opening..." : `Pay with ${paymentLabel(order.payment_method)}`}
              </button>
            ) : null}
          </div>
        </Card>
        </div>
      ))}
      <AnimatePresence>
        {selectedOrderId ? <CustomerOrderModal loading={loading} selectedOrder={selectedOrder} displayNumber={rows.length - rows.findIndex((item) => item.id === selectedOrderId)} onPay={payOrder} payingOrderId={payingOrderId} onClose={() => setSelectedOrderId(null)} /> : null}
      </AnimatePresence>
      {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
    </div>
  );
}

function CustomerOrderModal({ loading, selectedOrder, displayNumber, onPay, payingOrderId, onClose }) {
  const order = selectedOrder?.order;
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
          ) : order ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Order Details</p>
                  <h3 className="mt-2 font-display text-2xl font-bold text-white">My Order #{displayNumber}</h3>
                  <p className="mt-1 text-sm text-white/55">Created {new Date(order.created_at).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-bluebrand">{order.status}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Detail label="Total" value={`PHP ${order.total_amount}`} />
                <Detail label="Payment" value={paymentLabel(order.payment_method)} />
              </div>
              <Detail label="Tracking Number" value={order.tracking_number || "Waiting for admin"} />
              <Detail label="Payment Status" value={order.payment_status || "unpaid"} />
              {order.fulfillment_method === "delivery" ? (
                <a className="inline-flex w-fit items-center gap-2 rounded-2xl border border-neonbrand/20 bg-neonbrand/10 px-3 py-2 text-sm font-bold text-neonbrand" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.location || "delivery location")}`} target="_blank" rel="noreferrer">
                  <MapPin size={16} /> Open tracking map
                </a>
              ) : null}
              <div className="grid gap-3">
                {selectedOrder.items.map((item) => (
                  <div key={`${item.product_id}-${item.quantity}`} className="flex gap-3 rounded-3xl border border-white/10 bg-white/[0.055] p-3">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/10">
                      {item.image_url ? <img src={assetUrl(item.image_url)} className="h-full w-full object-cover" alt={item.name} /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-white">{item.name}</strong>
                      <p className="mt-1 truncate text-sm text-white/50">{item.brand || "Other Brands"} | Qty {item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {order.payment_method !== "cod" && order.payment_status !== "paid" ? (
                  <button type="button" onClick={(event) => onPay(order, event)} className="rounded-xl bg-neonbrand px-4 py-2 text-xs font-bold text-black">
                    {payingOrderId === order.id ? "Opening..." : `Pay with ${paymentLabel(order.payment_method)}`}
                  </button>
                ) : null}
                <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-bold text-white/70 transition hover:text-neonbrand">Close</button>
              </div>
            </div>
          ) : <p className="text-white/60">Order details are not available.</p>}
        </div>
      </motion.div>
    </motion.div>
  );
}

function paymentNumberKey(method) {
  if (method === "debit") return "debitNumber";
  if (method === "credit") return "creditNumber";
  if (method === "maya") return "mayaNumber";
  return "gcashNumber";
}

function isValidPaymentNumber(value) {
  return /^[0-9+\-\s()]{7,30}$/.test(String(value || "").trim());
}

function OrderMeta({ label, value }) {
  return (
    <span className="min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <strong className="mt-0.5 block truncate text-slate-800">{value || "Not set"}</strong>
    </span>
  );
}

function paymentLabel(method) {
  if (method === "gcash") return "GCash";
  if (method === "debit") return "Debit Card";
  if (method === "credit") return "Credit Card";
  if (method === "maya") return "Maya";
  return "COD";
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <span className="block text-xs font-bold uppercase tracking-[0.16em] text-white/40">{label}</span>
      <strong className="mt-1 block break-words text-white/80">{value || "Not provided"}</strong>
    </div>
  );
}

function AboutShop({ shop }) {
  const general = shop?.general || {};
  const about = shop?.about || {};
  const stats = shop?.stats || {};
  const description = general.shopDescription || "RETELA AI Ecommerce System is an online thrift shopping platform of Tela to Pera Thrift Shop that helps customers browse affordable ukay-ukay apparel, place orders, and communicate with the shop using AI assistance.";
  const address = about.fullAddress || general.shopAddress || "Tela to Pera Thrift Shop, Philippines";
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;

  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="relative overflow-hidden rounded-[30px] border border-neonbrand/20 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(56,255,136,0.18),transparent_35%),radial-gradient(circle_at_85%_25%,rgba(34,197,94,0.12),transparent_34%)]" />
        <div className="relative max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-neonbrand/75">Tela to Pera Thrift Shop</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">About RETELA</h1>
          <p className="mt-3 text-sm leading-7 text-white/62 sm:text-base">{description}</p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <InfoStat icon={CheckCircle2} label="Orders Completed" value={stats.ordersCompleted || 0} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card className="grid gap-4">
          <AboutSection icon={Globe2} title="Mission" body={about.mission} />
          <AboutSection icon={Star} title="Vision" body={about.vision} />
          <AboutSection icon={RotateCcw} title="Return Policy" body={`${about.returnConditions || ""} ${about.refundProcess || ""}`.trim()} />
          <AboutSection icon={MessageCircle} title="Customer Support" body={about.supportChannels} />
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand"><MapPin size={20} /></span>
              <div>
                <h2 className="font-display text-xl font-bold text-white">Shop Location</h2>
                <p className="mt-1 text-sm text-white/50">{about.landmark || "Store landmark is being updated."}</p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-sm leading-6 text-white/62">{address}</p>
          </div>
          <iframe className="h-72 w-full border-0 grayscale-[0.15] hue-rotate-[65deg]" src={mapSrc} loading="lazy" title="Tela to Pera map" />
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <ContactCard icon={Phone} title="Phone Number" value={general.contactNumber || shop?.phone_number || "Not set"} />
        <ContactCard icon={Mail} title="Email Address" value={general.emailAddress || "Not set"} />
        <ContactCard icon={MessageCircle} title="Messenger Link" value={about.messengerLink || "Not set"} href={about.messengerLink} />
        <ContactCard icon={Globe2} title="Facebook Page" value={about.facebookPage || "Not set"} href={about.facebookPage} />
        <ContactCard icon={Globe2} title="Instagram" value={about.instagramLink || "Not set"} href={about.instagramLink} />
        <ContactCard icon={Clock3} title="Business Hours" value={`${about.businessDays || "Monday to Sunday"} | ${about.openingTime || "9:00 AM"} - ${about.closingTime || "7:00 PM"}`} />
        <ContactCard icon={WalletCards} title="Payment Methods" value={about.paymentMethods || "GCash, COD, Online Payments"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl font-bold text-white">Shipping Information</h2>
          <div className="mt-4 grid gap-3">
            <Detail label="Delivery Areas" value={about.deliveryAreas} />
            <Detail label="Estimated Delivery Time" value={about.estimatedDeliveryTime} />
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-xl font-bold text-white">Meet the Team</h2>
          <div className="mt-4 grid gap-3">
            <Detail label="Owner/Admin Profile" value={about.ownerProfile} />
            <Detail label="Developers" value={about.developers} />
            <Detail label="Thesis Members" value={about.thesisMembers} />
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function Feedback({ orders, reviews, onSaved }) {
  const reviewedOrderIds = new Set(reviews.map((review) => Number(review.order_id)));
  const availableOrders = orders.filter((order) => !reviewedOrderIds.has(Number(order.id)));
  const [form, setForm] = useState({ order_id: "", rating: 0, category: "", comment: "" });
  const [image, setImage] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const selectedOrder = orders.find((order) => Number(order.id) === Number(form.order_id));
  const feedbackBlocked = selectedOrder && selectedOrder.status !== "completed";

  useEffect(() => {
    if (!form.order_id) {
      setOrderDetails(null);
      return undefined;
    }
    let alive = true;
    setLoadingDetails(true);
    api.get(`/orders/${form.order_id}/items`)
      .then(({ data }) => { if (alive) setOrderDetails(data); })
      .catch(() => { if (alive) setOrderDetails(null); })
      .finally(() => { if (alive) setLoadingDetails(false); });
    return () => { alive = false; };
  }, [form.order_id]);

  function showToast(type, message) {
    setToast({ type, message });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3200);
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.order_id || !form.rating || !form.category || form.comment.trim().length < 10) {
      showToast("error", "Select an order, rating, category, and write at least 10 characters.");
      return;
    }
    if (selectedOrder?.status !== "completed") {
      showToast("error", "Cannot leave feedback until delivered.");
      return;
    }
    if (reviewedOrderIds.has(Number(form.order_id))) {
      showToast("error", "Feedback was already submitted for this order.");
      return;
    }
    const payload = new FormData();
    payload.append("order_id", form.order_id);
    payload.append("rating", form.rating);
    payload.append("category", form.category);
    payload.append("comment", form.comment.trim());
    const firstItem = orderDetails?.items?.[0];
    if (firstItem?.product_id) payload.append("product_id", firstItem.product_id);
    if (image) payload.append("image", image);
    setSubmitting(true);
    try {
      await api.post("/reviews", payload, { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/reviews");
      showToast("success", "Feedback submitted successfully.");
      setForm({ order_id: "", rating: 0, category: "", comment: "" });
      setImage(null);
      setOrderDetails(null);
      await onSaved?.();
    } catch (error) {
      showToast("error", error?.response?.data?.message || "Could not submit feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Card className="rounded-[20px] bg-white p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Customer Experience</p>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-950">Feedback</h1>
            <p className="mt-2 text-sm text-slate-500">Share your experience only after selecting a verified delivered purchase.</p>
          </div>
          <Star className="shrink-0 text-emerald-600" size={26} />
        </div>

        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Verified Purchase</span>
            <select className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" value={form.order_id} onChange={(event) => setForm({ ...form, order_id: event.target.value })}>
              <option value="">Select purchase</option>
              {availableOrders.map((order) => <option key={order.id} value={order.id}>{orderNumber(order)} - {order.first_product_name || order.product_names || "Apparel"} - {money(order.total_amount)}</option>)}
            </select>
          </label>

          {selectedOrder ? (
            <VerifiedPurchaseCard order={selectedOrder} details={orderDetails} loading={loadingDetails} mode="feedback" />
          ) : (
            <EmptyPanel light title="No verified purchase selected" text={availableOrders.length ? "Choose a delivered order to preview brand and apparel details." : "No purchases are available for feedback."} />
          )}
          {feedbackBlocked ? <ValidationMessage message="Cannot leave feedback until delivered." /> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Feedback Category</span>
              <select className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                <option value="">Select category</option>
                {feedbackCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <div className="grid gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rating</span>
              <StarRating value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Comment</span>
            <textarea className="min-h-32 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" maxLength={600} placeholder="Share your experience with this verified purchase." value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
            <span className="text-right text-xs font-semibold text-slate-400">{form.comment.length}/600</span>
          </label>

          <FileDrop label="Image Upload" file={image} onChange={setImage} light />
          <Button type="submit" disabled={submitting || !availableOrders.length || feedbackBlocked || !selectedOrder}><Send size={17} /> {submitting ? "Submitting..." : "Submit Feedback"}</Button>
        </form>
      </Card>

      <Card className="rounded-[20px] bg-white p-5">
        <h2 className="font-display text-xl font-bold text-slate-950">Previous Feedback</h2>
        <div className="mt-4 grid max-h-[760px] gap-3 overflow-auto pr-1">
          {reviews.length ? reviews.map((review) => <FeedbackHistoryCard key={review.id} review={review} />) : <EmptyPanel light title="No feedback yet" text="Your submitted feedback history will appear here." />}
        </div>
      </Card>
      {toast ? <PortalToast toast={toast} onClose={() => setToast(null)} /> : null}
    </motion.div>
  );
}

function ReturnForm({ orders, returnRequests, onSaved }) {
  const availableOrders = orders;
  const [form, setForm] = useState({ order_id: "", reason_category: "", refund_type: "", description: "" });
  const [images, setImages] = useState([]);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const selectedOrder = orders.find((order) => Number(order.id) === Number(form.order_id));
  const selectedReturn = returnRequests.find((row) => Number(row.order_id) === Number(form.order_id));
  const validation = getReturnValidation(selectedOrder, selectedReturn);
  const shippingFee = selectedOrder ? defaultReturnShippingFee : 0;
  const estimatedRefund = Math.max(0, Number(selectedOrder?.total_amount || 0) - shippingFee);

  useEffect(() => {
    if (!form.order_id) {
      setOrderDetails(null);
      return undefined;
    }
    let alive = true;
    setLoadingDetails(true);
    api.get(`/orders/${form.order_id}/items`)
      .then(({ data }) => { if (alive) setOrderDetails(data); })
      .catch(() => { if (alive) setOrderDetails(null); })
      .finally(() => { if (alive) setLoadingDetails(false); });
    return () => { alive = false; };
  }, [form.order_id]);

  function showToast(type, message) {
    setToast({ type, message });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3200);
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.order_id || !form.reason_category || !form.refund_type || form.description.trim().length < 10) {
      showToast("error", "Complete the order, reason, refund type, and description fields.");
      return;
    }
    if (!validation.valid) {
      showToast("error", validation.message);
      return;
    }
    const payload = new FormData();
    payload.append("order_id", form.order_id);
    payload.append("reason_category", form.reason_category);
    payload.append("refund_type", form.refund_type);
    payload.append("description", form.description.trim());
    payload.append("shipping_fee", String(shippingFee));
    images.forEach((image) => payload.append("images", image));
    setSubmitting(true);
    try {
      await api.post("/returns", payload, { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/returns");
      clearGetCache("/orders");
      showToast("success", "Return request submitted successfully.");
      setForm({ order_id: "", reason_category: "", refund_type: "", description: "" });
      setImages([]);
      setOrderDetails(null);
      await onSaved?.();
    } catch (error) {
      showToast("error", error?.response?.data?.message || "Could not submit return request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Card className="rounded-[20px] bg-white p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Returns and Refunds</p>
            <h1 className="mt-2 font-display text-2xl font-bold text-slate-950">Request Return</h1>
            <p className="mt-2 text-sm text-slate-500">Submit proof and request a replacement, refund, or store credit for eligible delivered orders.</p>
          </div>
          <RotateCcw className="shrink-0 text-emerald-600" size={26} />
        </div>

        <ReturnPolicyNotice />

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Order Selection</span>
            <select className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" value={form.order_id} onChange={(event) => setForm({ ...form, order_id: event.target.value })}>
              <option value="">Select purchase</option>
              {availableOrders.map((order) => <option key={order.id} value={order.id}>{orderNumber(order)} - {order.first_product_name || order.product_names || "Apparel"} - {money(order.total_amount)}</option>)}
            </select>
          </label>

          {selectedOrder ? (
            <>
              <VerifiedPurchaseCard order={selectedOrder} details={orderDetails} loading={loadingDetails} mode="return" validation={validation} />
              {!validation.valid ? <ValidationMessage message={validation.message} /> : null}
            </>
          ) : (
            <EmptyPanel light title="No order selected" text={availableOrders.length ? "Choose a purchase to check return eligibility." : "No purchases are available for return."} />
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <SelectBox label="Return Reason" value={form.reason_category} options={returnReasons} onChange={(value) => setForm({ ...form, reason_category: value })} light />
            <SelectBox label="Refund Type" value={form.refund_type} options={refundTypes} onChange={(value) => setForm({ ...form, refund_type: value })} light />
          </div>

          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Description</span>
            <textarea className="min-h-32 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" maxLength={800} placeholder="Please explain the issue with your order." value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            <span className="text-right text-xs font-semibold text-slate-400">{form.description.length}/800</span>
          </label>

          <MultiFileDrop files={images} onChange={setImages} light />
          {selectedOrder ? (
            <ReturnSummaryCard
              order={selectedOrder}
              details={orderDetails}
              refundType={form.refund_type}
              reason={form.reason_category}
              shippingFee={shippingFee}
              estimatedRefund={estimatedRefund}
            />
          ) : null}
          <Button type="submit" disabled={submitting || !selectedOrder || !validation.valid}><RotateCcw size={17} /> {submitting ? "Submitting..." : "Request Return"}</Button>
        </form>
      </Card>

      <div className="grid gap-5">
        <Card className="rounded-[20px] bg-white p-5">
          <h2 className="font-display text-xl font-bold text-slate-950">Return Status Tracker</h2>
          <ReturnStatusTracker status={selectedReturn?.status || "pending"} />
        </Card>
        <Card className="rounded-[20px] bg-white p-5">
          <h2 className="font-display text-xl font-bold text-slate-950">Previous Return Requests</h2>
          <div className="mt-4 grid max-h-[560px] gap-3 overflow-auto pr-1">
            {returnRequests.length ? returnRequests.map((request) => <ReturnHistoryCard key={request.id} request={request} />) : <EmptyPanel light title="No return requests" text="Your return and refund history will appear here." />}
          </div>
        </Card>
      </div>
      {toast ? <PortalToast toast={toast} onClose={() => setToast(null)} /> : null}
    </motion.div>
  );
}

function InfoStat({ icon: Icon, label, value }) {
  return (
    <Card className="group">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">{label}</p>
          <strong className="mt-3 block font-display text-3xl font-bold text-white">{Number(value || 0).toLocaleString()}</strong>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-neonbrand/20 bg-neonbrand/10 text-neonbrand shadow-[0_0_30px_rgba(56,255,136,0.12)] transition group-hover:scale-105">
          <Icon size={23} />
        </span>
      </div>
    </Card>
  );
}

function AboutSection({ icon: Icon, title, body }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center gap-3">
        <Icon size={19} className="text-neonbrand" />
        <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/58">{body || "This section is being updated by the shop admin."}</p>
    </section>
  );
}

function ContactCard({ icon: Icon, title, value, href }) {
  const body = (
    <Card className="h-full transition hover:border-neonbrand/30">
      <Icon size={22} className="text-neonbrand" />
      <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-white/40">{title}</p>
      <strong className="mt-2 block break-words text-white/78">{value || "Not set"}</strong>
    </Card>
  );
  if (!href || href === "Not set") return body;
  return <a href={href} target="_blank" rel="noreferrer">{body}</a>;
}

function EmptyPanel({ title, text, light = false }) {
  return (
    <div className={`grid min-h-32 place-items-center rounded-2xl border border-dashed p-5 text-center ${light ? "border-emerald-200 bg-emerald-50/40" : "border-neonbrand/20 bg-black/20"}`}>
      <div>
        <SparkleMark light={light} />
        <h3 className={`mt-3 font-display text-lg font-bold ${light ? "text-slate-950" : "text-white"}`}>{title}</h3>
        <p className={`mt-1 text-sm ${light ? "text-slate-500" : "text-white/48"}`}>{text}</p>
      </div>
    </div>
  );
}

function SparkleMark({ light = false }) {
  return <span className={`mx-auto grid h-11 w-11 place-items-center rounded-2xl border ${light ? "border-emerald-100 bg-white text-emerald-700" : "border-neonbrand/20 bg-neonbrand/10 text-neonbrand"}`}><Star size={19} /></span>;
}

function VerifiedPurchaseCard({ order, details, loading, mode = "feedback", validation }) {
  const firstItem = details?.items?.[0];
  const brand = firstItem?.brand || order.brands || "RETELA";
  const product = firstItem?.name || order.first_product_name || order.product_names || "Apparel";
  const delivered = order.status === "completed";
  const heading = mode === "return" ? "Verified Purchase" : delivered ? "Verified Purchase" : "Purchase Selected";
  return (
    <section className="rounded-[20px] border border-emerald-100 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`grid h-9 w-9 place-items-center rounded-2xl border ${delivered ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
            {delivered ? <BadgeCheck size={18} /> : <AlertCircle size={18} />}
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-slate-950">{heading}</h3>
            <p className="text-xs font-semibold text-slate-500">{delivered ? "Linked to brand, apparel, and order number." : "Cannot leave feedback until delivered."}</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${delivered ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700"}`}>
          {delivered ? "Verified" : "Not Delivered"}
        </span>
      </div>
      {loading ? (
        <div className="mt-4 grid gap-2">
          <div className="skeleton h-10 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <PurchaseDetail label="Brand" value={brand} />
          <PurchaseDetail label="Product" value={product} />
          <PurchaseDetail label="Order No." value={orderNumber(order)} />
          <PurchaseDetail label="Amount" value={money(order.total_amount)} />
          <PurchaseDetail label="Purchased" value={formatDate(order.created_at)} />
          <PurchaseDetail label="Delivered" value={delivered ? formatDate(order.updated_at || order.created_at) : "Pending delivery"} />
          {mode === "return" ? <PurchaseDetail label="Return Eligibility" value={validation?.valid ? "Within 7-Day Return Window" : validation?.message || "Checking"} /> : null}
          <PurchaseDetail label="Status" value={customerOrderStatus(order.status)} />
        </div>
      )}
    </section>
  );
}

function PurchaseDetail({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <strong className="mt-0.5 block truncate text-sm text-slate-900">{value || "Not set"}</strong>
    </div>
  );
}

function ValidationMessage({ message }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-700">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      {message}
    </div>
  );
}

function ReturnSummaryCard({ order, details, refundType, reason, shippingFee, estimatedRefund }) {
  const firstItem = details?.items?.[0];
  const brand = firstItem?.brand || order.brands || "RETELA";
  const product = firstItem?.name || order.first_product_name || order.product_names || "Apparel";
  return (
    <section className="rounded-[20px] border border-emerald-100 bg-emerald-50/50 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={19} className="text-emerald-700" />
        <h3 className="font-display text-lg font-bold text-slate-950">Return Summary</h3>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <PurchaseDetail label="Brand" value={brand} />
        <PurchaseDetail label="Product" value={product} />
        <PurchaseDetail label="Order No." value={orderNumber(order)} />
        <PurchaseDetail label="Amount" value={money(order.total_amount)} />
        <PurchaseDetail label="Refund Type" value={refundType || "Select refund type"} />
        <PurchaseDetail label="Return Reason" value={reason || "Select return reason"} />
        <PurchaseDetail label="Shipping Fee" value={money(shippingFee)} />
        <PurchaseDetail label="Estimated Refund" value={money(estimatedRefund)} />
      </div>
      <p className="mt-3 rounded-2xl border border-emerald-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
        Refund Amount = {money(order.total_amount)} - {money(shippingFee)} = <span className="font-black text-emerald-700">{money(estimatedRefund)}</span>
      </p>
    </section>
  );
}

function OrderPreview({ order, details, loading, showReceived }) {
  const firstItem = details?.items?.[0];
  const image = firstItem?.image_url || order.first_product_image;
  const name = firstItem?.name || order.first_product_name || order.product_names || "Order apparel";
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
      {loading ? (
        <div className="grid gap-3">
          <div className="skeleton h-16 rounded-2xl" />
          <div className="skeleton h-24 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[96px_minmax(0,1fr)]">
          <div className="h-24 w-24 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06]">
            {image ? <img src={assetUrl(image)} className="h-full w-full object-cover" alt={name} /> : <div className="grid h-full place-items-center text-white/35"><FileImage size={24} /></div>}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/65">Order #{order.id}</p>
            <h3 className="mt-1 truncate font-display text-xl font-bold text-white">{name}</h3>
            <p className="mt-1 text-sm text-white/50">{order.product_names || details?.items?.map((item) => item.name).join(", ") || "Apparel Details"}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <PreviewPill label="Total" value={`PHP ${order.total_amount}`} />
              <PreviewPill label={showReceived ? "Date Received" : "Date"} value={formatDate(order.updated_at || order.created_at)} />
              <PreviewPill label="Status" value={order.status} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPill({ label, value }) {
  return (
    <span className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{label}</span>
      <strong className="mt-0.5 block truncate text-white/75">{value || "Not set"}</strong>
    </span>
  );
}

function StarRating({ value, onChange }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button key={rating} type="button" onClick={() => onChange(rating)} className={`transition hover:scale-110 ${rating <= value ? "text-amber-400" : "text-slate-300"}`} aria-label={`${rating} star rating`}>
          <Star size={24} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

function FileDrop({ label, file, onChange, light = false }) {
  return (
    <label className="grid cursor-pointer gap-2">
      <span className={`text-xs font-bold uppercase tracking-[0.16em] ${light ? "text-slate-500" : "text-white/45"}`}>{label}</span>
      <span className={`flex min-h-20 items-center gap-3 rounded-2xl border border-dashed p-3 ${light ? "border-emerald-200 bg-emerald-50/45" : "border-neonbrand/25 bg-neonbrand/5"}`}>
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${light ? "border-emerald-100 bg-white text-emerald-700" : "border-white/10 bg-black/25 text-neonbrand"}`}><Upload size={19} /></span>
        <span className="min-w-0 flex-1">
          <strong className={`block truncate text-sm ${light ? "text-slate-900" : "text-white"}`}>{file ? file.name : "Upload apparel feedback image"}</strong>
          <span className={`text-xs ${light ? "text-slate-500" : "text-white/45"}`}>PNG, JPG, or WEBP</span>
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={(event) => onChange(event.target.files?.[0] || null)} />
      </span>
    </label>
  );
}

function MultiFileDrop({ files, onChange, light = false }) {
  return (
    <label className="grid cursor-pointer gap-2">
      <span className={`text-xs font-bold uppercase tracking-[0.16em] ${light ? "text-slate-500" : "text-white/45"}`}>Image Upload</span>
      <span className={`flex min-h-20 items-center gap-3 rounded-2xl border border-dashed p-3 ${light ? "border-emerald-200 bg-emerald-50/45" : "border-neonbrand/25 bg-neonbrand/5"}`}>
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${light ? "border-emerald-100 bg-white text-emerald-700" : "border-white/10 bg-black/25 text-neonbrand"}`}><FileImage size={19} /></span>
        <span className="min-w-0 flex-1">
          <strong className={`block truncate text-sm ${light ? "text-slate-900" : "text-white"}`}>{files.length ? `${files.length} proof photo${files.length > 1 ? "s" : ""} selected` : "Upload proof photos"}</strong>
          <span className={`text-xs ${light ? "text-slate-500" : "text-white/45"}`}>Up to 4 images</span>
        </span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => onChange(Array.from(event.target.files || []).slice(0, 4))} />
      </span>
    </label>
  );
}

function SelectBox({ label, value, options, onChange, light = false }) {
  return (
    <label className="grid gap-2">
      <span className={`text-xs font-bold uppercase tracking-[0.16em] ${light ? "text-slate-500" : "text-white/45"}`}>{label}</span>
      <select className={`rounded-2xl p-3 text-sm outline-none transition ${light ? "border border-slate-200 bg-white text-slate-900 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" : "border border-white/10 bg-white/[0.06] text-white focus:border-neonbrand"}`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function FeedbackHistoryCard({ review }) {
  return (
    <article className="rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">{review.order_number || orderNumber({ id: review.order_id })}</p>
          <h3 className="mt-1 truncate font-bold text-slate-950">{review.order_products || review.product_name || "Feedback"}</h3>
          <p className="mt-1 text-xs text-slate-500">{review.category || "Overall Experience"} | {formatDate(review.created_at)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">{review.rating}/5</span>
      </div>
      <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-600">{review.comment}</p>
    </article>
  );
}

function ReturnPolicyNotice() {
  const cards = [
    { icon: CalendarDays, title: "Return Period", body: "Returns allowed within 7 days." },
    { icon: PackageCheck, title: "Item Condition", body: "Apparel must not be heavily damaged." },
    { icon: ShieldCheck, title: "Approval", body: "Refund approval depends on admin verification." },
    { icon: WalletCards, title: "Fixed Shipping Fee", body: "Within your city: ₱50. Within your province: ₱80-₱100. Other regions: ₱120-₱180." }
  ];
  return (
    <div className="rounded-[20px] border border-emerald-100 bg-emerald-50/55 p-4">
      <div className="flex items-center gap-3">
        <ShieldCheck size={20} className="text-emerald-700" />
        <h2 className="font-display text-lg font-bold text-slate-950">Return Policy Notice</h2>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.title} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="grid h-9 w-9 place-items-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700"><Icon size={17} /></span>
              <h3 className="mt-3 font-bold text-slate-950">{card.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{card.body}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ReturnStatusTracker({ status }) {
  const activeIndex = Math.max(0, returnFlow.indexOf(status));
  return (
    <div className="mt-5 grid gap-3">
      {returnFlow.map((item, index) => {
        const active = index <= activeIndex;
        return (
          <div key={item} className="flex items-center gap-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${active ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
              {active ? <CheckCircle2 size={16} /> : index + 1}
            </span>
            <span className={`text-sm font-bold ${active ? "text-slate-950" : "text-slate-400"}`}>{returnStatusLabel(item)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ReturnHistoryCard({ request }) {
  return (
    <article className="rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">{request.order_number || orderNumber({ id: request.order_id })}</p>
          <h3 className="mt-1 truncate font-bold text-slate-950">{request.product_name || request.product_names || "Return request"}</h3>
          <p className="mt-1 text-xs text-slate-500">{formatDate(request.created_at)} | {request.reason_category || "Other"}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{request.reason}</p>
    </article>
  );
}

function PortalToast({ toast, onClose }) {
  const success = toast.type === "success";
  return (
    <div className={`fixed bottom-5 right-5 z-[170] flex max-w-sm items-start gap-3 rounded-[24px] border p-4 text-white shadow-2xl backdrop-blur-2xl ${success ? "border-neonbrand/25 bg-black/85" : "border-rose-300/25 bg-rose-950/85"}`}>
      {success ? <CheckCircle2 className="mt-0.5 shrink-0 text-neonbrand" size={20} /> : <AlertCircle className="mt-0.5 shrink-0 text-rose-200" size={20} />}
      <p className="min-w-0 flex-1 text-sm leading-6 text-white/72">{toast.message}</p>
      <button type="button" onClick={onClose} className="shrink-0 rounded-full px-2 text-white/45 hover:bg-white/10 hover:text-white">x</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    under_review: "border-sky-200 bg-sky-50 text-sky-700",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-rose-200 bg-rose-50 text-rose-700",
    refunded: "border-violet-200 bg-violet-50 text-violet-700"
  };
  return <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black ${styles[status] || styles.pending}`}>{returnStatusLabel(status)}</span>;
}

function returnStatusLabel(status) {
  if (status === "under_review") return "Under Review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "refunded") return "Refunded";
  return "Pending";
}

function orderNumber(order) {
  if (order?.order_number) return order.order_number;
  const year = order?.created_at ? new Date(order.created_at).getFullYear() : new Date().getFullYear();
  const id = String(order?.id || "0").padStart(5, "0");
  return `#ORD-${Number.isNaN(year) ? new Date().getFullYear() : year}-${id}`;
}

function customerOrderStatus(status) {
  if (status === "completed") return "Delivered";
  if (status === "awaiting_payment") return "Awaiting Payment";
  if (status === "payment_failed") return "Payment Failed";
  if (status === "paid") return "Paid";
  if (status === "processing") return "Processing";
  if (status === "ready") return "Ready";
  if (status === "cancelled") return "Cancelled";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Pending";
}

function brandInitials(value) {
  const words = String(value || "RT").split(/[\s,]+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join("") || "RT";
}

function canRequestReturn(order, returnStatus) {
  return getReturnValidation(order, returnStatus ? { status: returnStatus } : null).valid;
}

function getReturnValidation(order, returnRequest) {
  if (!order) return { valid: false, message: "Select a verified purchase." };
  if (order.payment_status === "refunded" || returnRequest?.status === "refunded") return { valid: false, message: "Order Already Refunded" };
  if (["pending", "under_review", "approved"].includes(returnRequest?.status)) return { valid: false, message: "Order Already Returned" };
  if (order.status !== "completed") return { valid: false, message: "Order Not Delivered" };
  if (!isWithinReturnWindow(order)) return { valid: false, message: "Return Window Expired" };
  return { valid: true, message: "Within 7-Day Return Window" };
}

function isWithinReturnWindow(order) {
  const date = new Date(order.updated_at || order.created_at);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function calculateAge(value) {
  if (!value) return null;
  const birthday = new Date(value);
  if (Number.isNaN(birthday.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function profileStatusLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "pending" || status === "pending_otp") return "Pending";
  if (status === "suspended") return "Deactivated";
  if (status === "rejected") return "Declined";
  return status || "Pending";
}

function CustomerSettings({ user }) {
  const [theme, setTheme] = useState(() => readUserTheme(user));

  useEffect(() => {
    setTheme(readUserTheme(user));
  }, [user?.id, user?.role]);

  function updateTheme(nextTheme) {
    const normalized = nextTheme === "dark" ? "dark" : "light";
    setTheme(normalized);
    saveUserTheme(user, normalized);
    emitUserThemeChange(user, normalized);
  }

  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(56,255,136,0.18),transparent_32%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.12),transparent_30%)]" />
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-neonbrand/75">Customer Settings</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">Manage preferences for this customer account only.</p>
        </div>
      </section>

      <Card>
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-neonbrand/25 bg-neonbrand/10 text-neonbrand">
            {theme === "dark" ? <Moon size={22} /> : <Sun size={22} />}
          </span>
          <div>
            <h2 className="font-display text-xl font-bold text-white">Appearance</h2>
            <p className="mt-1 text-sm leading-6 text-white/52">This theme is saved only for {user?.username || "your account"}.</p>
          </div>
        </div>
        <CustomerThemeSwitch theme={theme} onChange={updateTheme} />
      </Card>
    </motion.div>
  );
}

function CustomerThemeSwitch({ theme, onChange }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => onChange(dark ? "light" : "dark")}
      className="group flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-left transition hover:border-neonbrand/35 hover:bg-neonbrand/5"
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

function Profile({ profile, setProfile, profilePhoto, setProfilePhoto, saveProfile, onReset, onDeactivate, deactivating }) {
  const [photoPreview, setPhotoPreview] = useState("");
  const age = calculateAge(profile?.birthday);

  useEffect(() => {
    if (!profilePhoto) {
      setPhotoPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(profilePhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  if (!profile) return <Card><p className="text-sm text-slate-500">Loading profile...</p></Card>;
  const photoUrl = photoPreview || assetUrl(profile.profile_photo_url);
  const accountStatus = profileStatusLabel(profile.status);
  return (
    <motion.div className="grid gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(56,255,136,0.18),transparent_32%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.12),transparent_30%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-neonbrand/75">Customer Account</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Profile</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">Keep your contact details, delivery address, and account security up to date.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ProfileStatusCard icon={ShieldCheck} label="Account" value={accountStatus} tone={profile.status === "approved" ? "success" : "warning"} />
            <ProfileStatusCard icon={CheckCircle2} label="Session" value="Active" tone="success" />
            <ProfileStatusCard icon={CalendarDays} label="Age" value={age === null ? "Not set" : `${age}`} tone="neutral" />
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,1fr)]">
        <Card className="h-fit">
          <div className="grid place-items-center gap-4 text-center">
            <div className="relative">
              {photoUrl ? (
                <img src={photoUrl} className="h-32 w-32 rounded-[32px] border border-neonbrand/25 object-cover shadow-[0_0_45px_rgba(56,255,136,0.16)]" alt={profile.display_name || profile.username || "Profile"} />
              ) : (
                <div className="grid h-32 w-32 place-items-center rounded-[32px] border border-white/10 bg-white/[0.06] text-sm font-bold text-white/35">Photo</div>
              )}
              <span className="absolute -bottom-2 -right-2 rounded-2xl border border-neonbrand/25 bg-black px-3 py-1 text-xs font-black text-neonbrand">{accountStatus}</span>
            </div>
            <div className="min-w-0">
              <h2 className="break-words font-display text-2xl font-bold text-white">{profile.display_name || profile.username}</h2>
              <p className="mt-1 break-words text-sm text-white/50">{profile.email || "Email not set"}</p>
            </div>
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-neonbrand/35 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black">
              <Upload size={17} />
              {profilePhoto ? "Change selected photo" : "Upload profile photo"}
              <input className="hidden" type="file" accept="image/*" onChange={(e) => setProfilePhoto(e.target.files?.[0] || null)} />
            </label>
            {profilePhoto ? <p className="max-w-full truncate text-xs text-white/45">{profilePhoto.name}</p> : null}
          </div>
        </Card>

        <Card>
          <form onSubmit={saveProfile} className="grid gap-4">
            <div>
              <h3 className="font-display text-xl font-bold text-white">Personal Details</h3>
              <p className="mt-1 text-sm text-white/45">These changes are saved to your customer record and visible to the admin dashboard.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ProfileField label="Full name"><Field icon={User} placeholder="Full name" value={profile.display_name || ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></ProfileField>
              <ProfileField label="Username"><Field icon={User} placeholder="Username" value={profile.username || ""} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></ProfileField>
              <ProfileField label="Email"><Field icon={Mail} placeholder="Email" type="email" value={profile.email || ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></ProfileField>
              <ProfileField label="Phone number"><Field icon={Phone} placeholder="Phone number" value={profile.phone_number || ""} onChange={(e) => setProfile({ ...profile, phone_number: e.target.value })} /></ProfileField>
              <ProfileField label="Birthday">
                <Field icon={CalendarDays} type="date" value={formatDateInput(profile.birthday)} onChange={(e) => setProfile({ ...profile, birthday: e.target.value })} />
              </ProfileField>
              <ProfileField label="Gender">
                <select className="h-12 rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-white outline-none transition focus:border-neonbrand/60" value={profile.gender || ""} onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>
                  <option className="bg-slate-950 text-white" value="">Select gender</option>
                  <option className="bg-slate-950 text-white" value="Female">Female</option>
                  <option className="bg-slate-950 text-white" value="Male">Male</option>
                  <option className="bg-slate-950 text-white" value="Non-binary">Non-binary</option>
                  <option className="bg-slate-950 text-white" value="Prefer not to say">Prefer not to say</option>
                </select>
              </ProfileField>
              <ProfileField label="Complete address / location" className="md:col-span-2">
                <Field icon={MapPin} placeholder="House/Street, Barangay, City, Province" value={profile.location || ""} onChange={(e) => setProfile({ ...profile, location: e.target.value })} />
              </ProfileField>
            </div>
            <div className="flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button type="submit"><Save size={17} /> Save Profile</Button>
                <Button type="button" variant="secondary" onClick={onReset}><RotateCcw size={17} /> Cancel / Reset</Button>
              </div>
              <Button type="button" variant="secondary" onClick={onDeactivate} disabled={deactivating} className="border-rose-300/25 bg-rose-300/10 text-rose-100 hover:border-rose-300/50 hover:text-white">
                {deactivating ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
                Deactivate Account
              </Button>
            </div>
          </form>
          <ChangePasswordForm />
        </Card>
      </div>
    </motion.div>
  );
}

function ProfileField({ label, children, className = "" }) {
  return (
    <div className={`grid gap-2 ${className}`}>
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">{label}</span>
      {children}
    </div>
  );
}

function ProfileStatusCard({ icon: Icon, label, value, tone = "neutral" }) {
  const tones = {
    success: "border-neonbrand/20 bg-neonbrand/10 text-neonbrand",
    warning: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    neutral: "border-white/10 bg-white/[0.06] text-white/75"
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tones[tone] || tones.neutral}`}>
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] opacity-80"><Icon size={15} /> {label}</span>
      <strong className="mt-1 block text-lg text-white">{value}</strong>
    </div>
  );
}
