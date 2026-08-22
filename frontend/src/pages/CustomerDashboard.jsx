import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, BadgeCheck, Bell, Bot, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, CreditCard, Edit3, Eye, EyeOff, FileImage, Globe2, Loader2, Mail, MapPin, Megaphone, MessageCircle, Minus, PackageCheck, Phone, Plus, RotateCcw, Save, Search, Send, ShieldCheck, ShoppingCart, Star, Tag, Trash2, Upload, User, Users, WalletCards, X, XCircle } from "lucide-react";
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
import ConfirmDialog from "../components/ConfirmDialog";
import { dispatchCustomerToast } from "../components/CustomerToastStack";
import FaceVerification from "../components/FaceVerification";
import NotificationPreviewPanel from "../components/NotificationPreviewPanel";
import OrderDeliveryInfo from "../components/OrderDeliveryInfo";
import ProductImage from "../components/ProductImage";
import ProductQuickView from "../components/ProductQuickView";
import StructuredLocationPicker from "../components/StructuredLocationPicker";
import { Button, Card, Field } from "../components/ui";
import { resolveAssetUrl } from "../config/branding";
import { useAuth } from "../context/AuthContext";
import useBlockingLoader from "../hooks/useBlockingLoader";
import {
  formatDistanceKm,
  hasLocationCoordinates,
  locationFromProfile,
  locationValidationMessage,
  normalizeStructuredLocation,
  profileFieldsFromLocation
} from "../utils/location";
import { emitUserThemeChange, readUserTheme, saveUserTheme } from "../utils/userTheme";
import { orderStatusLabel as sharedOrderStatusLabel } from "../utils/orderStatus";

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
const defaultDeliverySafetyPolicy = "For everyone's safety, customers and delivery personnel should meet only at the confirmed delivery or meeting location shown in the order. Verify the order and customer/delivery identity before handing over or accepting an item. Avoid changing the meetup location through unofficial messages. Keep communication inside RETELA whenever possible. Do not share OTPs, passwords, or sensitive account information. If the location feels unsafe, contact the other party through RETELA and arrange a safer public meeting point before completing the order.";
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
const adminOnlyNotificationTypes = new Set([
  "inventory",
  "low_stock",
  "out_of_stock",
  "stock",
  "stock_alert",
  "product_stock",
  "new_sale",
  "sale",
  "admin",
  "system"
]);
const adminOnlyNotificationText = /\b(low stock|out of stock|inventory|new sale|stock management|admin system|internal shop|management alert)\b/i;

function customerNotificationRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const type = String(row?.type || "").toLowerCase();
    const text = [row?.title, row?.body, row?.message].map((value) => String(value || "")).join(" ");
    return !adminOnlyNotificationTypes.has(type) && !adminOnlyNotificationText.test(text);
  });
}

function paymentCheckoutUrl(payload) {
  return payload?.checkoutUrl || payload?.checkout_url || payload?.url || "";
}

function normalizeDeliveryLocation(value = {}) {
  return normalizeStructuredLocation(value);
}

function hasDeliveryLocation(value) {
  return Boolean(normalizeDeliveryLocation(value).address);
}

function hasDeliveryCoordinates(value) {
  return hasLocationCoordinates(value);
}

function deliveryLocationFromProfile(profile) {
  return locationFromProfile(profile);
}

function deliveryLocationFromOrder(order) {
  return normalizeDeliveryLocation(order);
}

function deliveryMapUrl(location) {
  const normalized = normalizeDeliveryLocation(location);
  if (hasDeliveryCoordinates(normalized)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${normalized.latitude},${normalized.longitude}`)}`;
  }
  if (normalized.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalized.address)}`;
  }
  return "";
}

function deliverySafetyPolicyFromShop(shop) {
  return String(shop?.about?.deliverySafetyPolicy || defaultDeliverySafetyPolicy).trim() || defaultDeliverySafetyPolicy;
}

function normalizeShippingQuote(value = {}) {
  const fee = Number(value.shippingFee ?? value.shipping_fee ?? 0);
  const rawDistance = value.distanceKm ?? value.distance_km ?? value.shippingDistanceKm ?? value.shipping_distance_km;
  const distance = rawDistance === null || rawDistance === undefined || rawDistance === "" ? Number.NaN : Number(rawDistance);
  const zone = String(value.shippingZone ?? value.shipping_zone ?? "").trim().toLowerCase();
  return {
    shippingFee: Number.isFinite(fee) ? Math.max(0, fee) : 0,
    shippingZone: zone,
    shippingRule: String(value.shippingRule ?? value.shipping_rule ?? "").trim(),
    distanceKm: Number.isFinite(distance) && distance >= 0 ? distance : null,
    reason: String(value.reason || value.shippingReason || value.shipping_reason || (zone === "nearby" ? "Nearby delivery area" : zone === "outside" ? "Outside nearby delivery area" : "")).trim()
  };
}

function shippingFeeText(quote, loading = false) {
  if (loading && !quote) return "Calculating...";
  if (!quote) return "Pending";
  return Number(quote.shippingFee || 0) <= 0 ? "FREE" : money(quote.shippingFee);
}

function deliveryAreaText(quote) {
  if (quote?.shippingZone === "nearby") return "Nearby / Free";
  if (quote?.shippingZone === "outside") return "Outside";
  return "";
}

function setModalBodyLock(active) {
  document.body.classList.toggle("retela-modal-open", Boolean(active));
}

function stockStatus(stock) {
  const quantity = Number(stock || 0);
  if (quantity <= 0) return "Out of stock";
  return `${quantity} in stock`;
}

function stockBadgeClass(stock) {
  const quantity = Number(stock || 0);
  if (quantity <= 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (quantity <= 3) return "border-amber-200 bg-amber-50 text-amber-700";
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
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [paymentDetails, setPaymentDetails] = useState({ gcashNumber: "", debitNumber: "", creditNumber: "", mayaNumber: "" });
  const [paymentError, setPaymentError] = useState("");
  const [redirectingPayment, setRedirectingPayment] = useState(null);
  const [qrPayment, setQrPayment] = useState(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState("delivery");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [filters, setFilters] = useState(defaultCustomerFilters);
  const [shopProductIdsFilter, setShopProductIdsFilter] = useState([]);
  const [chatTargetProductId, setChatTargetProductId] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ brands: [], categories: [], sizes: [] });
  const [shopInfo, setShopInfo] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [returnRequests, setReturnRequests] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileInitial, setProfileInitial] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [deliveryLocation, setDeliveryLocation] = useState(null);
  const [locationSelectorOpen, setLocationSelectorOpen] = useState(false);
  const [shippingQuote, setShippingQuote] = useState(null);
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const filtersRef = useRef(filters);
  const cartRef = useRef(cart);
  const stockRefreshTimerRef = useRef(null);
  const checkoutInFlightRef = useRef(false);
  const shippingQuoteRequestRef = useRef(0);

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

  useEffect(() => {
    function handleViewProduct(event) {
      const productId = Number(event.detail?.productId);
      if (!productId) return;
      setChatTargetProductId(productId);
      setShopProductIdsFilter([]);
      setFilters(defaultCustomerFilters);
      onChange("Shop");
    }
    window.addEventListener("retela:view-product", handleViewProduct);
    return () => window.removeEventListener("retela:view-product", handleViewProduct);
  }, [onChange]);

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
    setProducts((Array.isArray(productRes.data) ? productRes.data : []).filter((item) => Number(item.stock || 0) > 0));
    setFilterOptions(filterRes.data);
    setOrders(orderRes.data);
    setNotifications(customerNotificationRows(notificationRes.data));
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

  const loadShippingQuote = useCallback(async ({ method = "delivery", coupon = "" } = {}) => {
    const requestId = shippingQuoteRequestRef.current + 1;
    shippingQuoteRequestRef.current = requestId;
    setShippingQuote(null);
    setShippingQuoteLoading(true);
    setShippingQuoteError("");
    try {
      const { data } = await api.post("/settings/shipping/quote", {
        fulfillmentMethod: method,
        couponCode: coupon
      });
      if (shippingQuoteRequestRef.current !== requestId) return null;
      const nextQuote = normalizeShippingQuote(data);
      setShippingQuote(nextQuote);
      return nextQuote;
    } catch (error) {
      if (shippingQuoteRequestRef.current !== requestId) return null;
      setShippingQuote(null);
      setShippingQuoteError(error?.response?.data?.message || "Shipping could not be calculated right now.");
      return null;
    } finally {
      if (shippingQuoteRequestRef.current === requestId) setShippingQuoteLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (!profile?.id) return;
    const profileLocation = deliveryLocationFromProfile(profile);
    setDeliveryLocation(hasDeliveryLocation(profileLocation) ? profileLocation : null);
  }, [
    profile?.id,
    profile?.location,
    profile?.formatted_address,
    profile?.delivery_barangay,
    profile?.delivery_municipality,
    profile?.delivery_province,
    profile?.delivery_region,
    profile?.delivery_postal_code,
    profile?.delivery_place_id,
    profile?.delivery_latitude,
    profile?.delivery_longitude,
    profile?.delivery_location_source,
    profile?.delivery_landmark,
    profile?.delivery_notes
  ]);

  useEffect(() => {
    if (!profile?.id) return;
    const savedLocation = deliveryLocationFromProfile(profile);
    if (fulfillmentMethod === "delivery" && !hasDeliveryLocation(savedLocation)) {
      setShippingQuote(null);
      setShippingQuoteError("");
      return;
    }
    void loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" });
  }, [
    appliedCoupon?.code,
    fulfillmentMethod,
    loadShippingQuote,
    profile?.id,
    profile?.location,
    profile?.formatted_address,
    profile?.delivery_barangay,
    profile?.delivery_municipality,
    profile?.delivery_province,
    profile?.delivery_region,
    profile?.delivery_postal_code,
    profile?.delivery_place_id,
    profile?.delivery_latitude,
    profile?.delivery_longitude,
    profile?.delivery_location_source
  ]);

  function notifyCart(message, type = "success") {
    dispatchCustomerToast({ type, message });
  }

  async function confirmMeetup(order, decision, note = "") {
    if (!order?.id) return;
    try {
      const { data } = await api.patch(`/orders/${order.id}/meetup-confirmation`, { decision, note });
      setOrders((current) => current.map((item) => Number(item.id) === Number(order.id) ? { ...item, ...data } : item));
      clearGetCache("/orders");
      dispatchCustomerToast({ type: "success", message: decision === "agreed" ? "Meetup schedule confirmed." : "Schedule declined. The shop can propose another time." });
      window.dispatchEvent(new CustomEvent("retela:data-change", { detail: { type: "order_update", payload: data } }));
      return data;
    } catch (error) {
      dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || "Could not save your meetup response." });
      throw error;
    }
  }

  async function addToCart(product, successMessage = "Item added to cart") {
    const stock = Number(product.stock || 0);
    if (stock <= 0) {
      notifyCart("This apparel item is out of stock.", "warning");
      return;
    }
    try {
      const { data } = await api.post("/cart/items", { product_id: product.id, quantity: 1, selected: true });
      clearGetCache("/cart");
      replaceCart(data);
      notifyCart(successMessage);
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to add this item.", "error");
    }
  }

  async function buyNow(product) {
    const stock = Number(product.stock || 0);
    if (stock <= 0) {
      notifyCart("This apparel item is out of stock.", "warning");
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
      notifyCart(error?.response?.data?.message || "Unable to prepare checkout.", "error");
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
      notifyCart(error?.response?.data?.message || "Unable to update quantity.", "error");
    }
  }

  async function removeCartItem(productId) {
    try {
      const { data } = await api.delete(`/cart/items/${productId}`);
      clearGetCache("/cart");
      replaceCart(data);
      notifyCart("Item removed");
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Unable to remove item.", "error");
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
      if (profile?.id) {
        void loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" });
      }
    }
    window.addEventListener("retela:shipping-change", refreshShipping);
    return () => {
      cancelled = true;
      window.removeEventListener("retela:shipping-change", refreshShipping);
    };
  }, [appliedCoupon?.code, fulfillmentMethod, loadPromotions, loadShippingQuote, profile?.id]);

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
  const cartPricing = useMemo(
    () => calculateCartPricing(selectedCartItems, promotions, appliedCoupon, fulfillmentMethod, shippingQuote),
    [selectedCartItems, promotions, appliedCoupon, fulfillmentMethod, shippingQuote]
  );
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
      setShippingQuote(normalizeShippingQuote(data));
      setShippingQuoteError("");
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
          message ||= `${item.name || "This apparel item"} is no longer available.`;
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
    if (!ok && !silent) notifyCart(message || "Cart stock was updated.", "warning");
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
    if (checkoutInFlightRef.current || checkoutLoading) return;
    const selectedDeliveryLocation = normalizeDeliveryLocation(deliveryLocation);
    if (fulfillmentMethod === "delivery" && !hasDeliveryLocation(selectedDeliveryLocation)) {
      notifyCart("Please set your delivery location before checkout.", "warning");
      return;
    }
    const stockOk = await recheckCartStock({ productIds: selectedCartIds });
    if (!stockOk) return;
    const billingPhone = paymentMethod === "cod" || paymentMethod === "qrph" ? "" : (paymentDetails[paymentNumberKey(paymentMethod)] || "").trim();
    if (paymentMethod !== "cod" && paymentMethod !== "qrph" && !isValidPaymentNumber(billingPhone)) {
      const message = `Enter a valid ${paymentNumberLabels[paymentMethod].toLowerCase()}.`;
      setPaymentError(message);
      notifyCart(message, "error");
      return;
    }

    checkoutInFlightRef.current = true;
    setCheckoutLoading(true);
    let didRedirect = false;
    try {
      if (!selectedCartItems.length) {
        notifyCart("Please select at least one item.", "warning");
        return;
      }
      if (fulfillmentMethod === "delivery") {
        const displayedShippingFee = Number(shippingQuote?.shippingFee || 0);
        const latestQuote = await loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" });
        if (!latestQuote) {
          notifyCart("Shipping could not be recalculated. Please try again.", "error");
          return;
        }
        if (Math.abs(Number(latestQuote.shippingFee || 0) - displayedShippingFee) > 0.009) {
          notifyCart("Shipping was updated. Review the new total, then confirm checkout again.", "info");
          return;
        }
      }
      const { data } = await api.post("/orders", {
        payment_method: paymentMethod,
        fulfillment_method: fulfillmentMethod,
        coupon_code: appliedCoupon?.code || "",
        delivery_address: selectedDeliveryLocation.address,
        delivery_latitude: selectedDeliveryLocation.latitude,
        delivery_longitude: selectedDeliveryLocation.longitude,
        delivery_landmark: selectedDeliveryLocation.landmark,
        delivery_notes: selectedDeliveryLocation.notes,
        items: selectedCartItems.map(({ product_id, quantity }) => ({ product_id, quantity }))
      }, { timeout: 30000 });
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
        if (paymentMethod === "qrph") {
          const qrResponse = await api.post("/payments/paymongo/qrph/create", { orderId: data.id });
          setQrPayment({ ...qrResponse.data, orderId: data.id, amount: Number(data.total_amount || cartTotal) });
          await load(filtersRef.current, { force: true });
          return;
        }
        console.log("Selected payment method:", paymentMethod);
        console.log("Starting GCash checkout");
        setRedirectingPayment(paymentMethod);
        const checkoutRes = await api.post("/payments/create-gcash-checkout", { orderId: data.id, paymentMethod, billingPhone });
        console.log("GCash API response:", checkoutRes.data);
        const checkoutUrl = paymentCheckoutUrl(checkoutRes.data);
        if (!checkoutUrl) {
          throw new Error("GCash checkout URL was not returned by the server.");
        }
        didRedirect = true;
        window.location.href = checkoutUrl;
        return;
      }
      notifyCart("Order placed successfully.", "success");
      await load(filtersRef.current, { force: true });
    } catch (error) {
      if (paymentMethod !== "cod") {
        console.error("GCash checkout failed:", error);
        console.error("GCash server response:", error?.response?.data);
      } else {
        console.error("Checkout failed:", error);
      }
      notifyCart(checkoutErrorMessage(error, paymentMethod), "error");
    } finally {
      if (!didRedirect) {
        checkoutInFlightRef.current = false;
        setCheckoutLoading(false);
        setRedirectingPayment(null);
      }
    }
  }

  async function openCheckoutSummary() {
    if (!selectedCartItems.length) {
      setCouponError("Please select at least one item.");
      notifyCart("Please select at least one item.", "warning");
      return;
    }
    if (fulfillmentMethod === "delivery" && !hasDeliveryLocation(deliveryLocation)) {
      notifyCart("Please set your delivery location before checkout.", "warning");
      setLocationSelectorOpen(true);
      return;
    }
    if (fulfillmentMethod === "delivery" && shippingQuoteLoading) {
      notifyCart("Shipping is still being calculated.", "info");
      return;
    }
    if (fulfillmentMethod === "delivery") {
      const quote = await loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" });
      if (!quote) {
        notifyCart("Shipping could not be calculated. Please try again.", "error");
        return;
      }
    }
    setCheckoutSummaryOpen(true);
  }

  async function saveCheckoutDeliveryLocation(nextLocation) {
    const normalized = normalizeDeliveryLocation(nextLocation);
    const validationMessage = locationValidationMessage(normalized);
    if (validationMessage) {
      notifyCart(validationMessage, "warning");
      return false;
    }
    try {
      const { data } = await api.patch("/users/me", {
        ...profileFieldsFromLocation(normalized),
        delivery_landmark: normalized.landmark || null,
        delivery_notes: normalized.notes || null
      });
      clearGetCache("/users/me");
      localStorage.setItem("retela_user", JSON.stringify(data));
      setUser(data);
      setProfile(data);
      setProfileInitial(data);
      setDeliveryLocation(deliveryLocationFromProfile(data));
      setLocationSelectorOpen(false);
      await loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" });
      notifyCart("Delivery location saved.");
      return true;
    } catch (error) {
      notifyCart(error?.response?.data?.message || "Could not save the delivery location.", "error");
      return false;
    }
  }

  async function saveProfile(event, profileInput = profile, photoInput = profilePhoto) {
    event.preventDefault();
    const payload = new FormData();
    Object.entries(profileInput || {}).forEach(([key, value]) => payload.append(key, value ?? ""));
    if (photoInput) payload.append("profilePhoto", photoInput);
    try {
      const { data } = await api.patch("/users/me", payload, { headers: { "Content-Type": "multipart/form-data" } });
      clearGetCache("/users/me");
      localStorage.setItem("retela_user", JSON.stringify(data));
      setUser(data);
      setProfile(data);
      setProfileInitial(data);
      setProfilePhoto(null);
      dispatchCustomerToast({ type: "success", message: "Profile updated successfully." });
      return data;
    } catch (error) {
      dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || "Could not save profile changes." });
      throw error;
    }
  }

  function resetProfile() {
    setProfile(profileInitial);
    setProfilePhoto(null);
    dispatchCustomerToast({ type: "info", message: "Profile changes were reset." });
  }

  async function deactivateAccount() {
    setDeactivateConfirmOpen(true);
  }

  async function confirmDeactivateAccount() {
    setDeactivating(true);
    try {
      await api.patch("/users/me/deactivate");
      logout();
    } catch (error) {
      dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || "Could not deactivate account." });
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
            onBuyNow={buyNow}
          />
          <FloatingNotificationsWidget rows={notifications} onViewAll={() => onChange("Notifications")} />
        </div>
        <Shop products={filteredProducts.slice(0, 6)} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={updateFilters} filterOptions={filterOptions} focusProductId={chatTargetProductId} onFocusProductHandled={() => setChatTargetProductId(null)} />
      </div>
    );
  }

  if (active === "Shop") {
    return (
      <div className="grid min-w-0 gap-5">
        <Shop products={filteredProducts} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={updateFilters} filterOptions={filterOptions} clearFilters={clearFilters} focusProductId={chatTargetProductId} onFocusProductHandled={() => setChatTargetProductId(null)} />
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
          deliveryLocation={deliveryLocation}
          shippingQuote={shippingQuote}
          shippingQuoteLoading={shippingQuoteLoading}
          shippingQuoteError={shippingQuoteError}
          retryShippingQuote={() => loadShippingQuote({ method: fulfillmentMethod, coupon: appliedCoupon?.code || "" })}
          deliverySafetyPolicy={deliverySafetyPolicyFromShop(shopInfo)}
          onOpenLocationSelector={() => setLocationSelectorOpen(true)}
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
            deliveryLocation={deliveryLocation}
            shippingQuote={shippingQuote}
            shippingQuoteLoading={shippingQuoteLoading}
            fulfillmentMethod={fulfillmentMethod}
            deliverySafetyPolicy={deliverySafetyPolicyFromShop(shopInfo)}
            checkout={checkout}
            checkoutLoading={checkoutLoading}
            onClose={() => setCheckoutSummaryOpen(false)}
          />
        ) : null}
        {qrPayment ? (
          <QrPhPaymentScreen
            payment={qrPayment}
            onClose={() => setQrPayment(null)}
            onViewOrder={() => { setQrPayment(null); onChange("Orders"); }}
            onPaid={() => load(filtersRef.current, { force: true })}
            onRegenerate={async () => {
              const { data } = await api.post("/payments/paymongo/qrph/create", { orderId: qrPayment.orderId });
              setQrPayment({ ...data, orderId: qrPayment.orderId, amount: Number(qrPayment.amount || data.total_amount || 0) });
            }}
          />
        ) : null}
        {locationSelectorOpen ? (
          <DeliveryLocationSelector
            initialLocation={deliveryLocation || deliveryLocationFromProfile(profile)}
            onClose={() => setLocationSelectorOpen(false)}
            onSave={saveCheckoutDeliveryLocation}
          />
        ) : null}
        {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
      </>
    );
  }

  if (active === "Shop") {
    return (
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Shop products={filteredProducts} addToCart={addToCart} buyNow={buyNow} filters={filters} setFilters={setFilters} filterOptions={filterOptions} clearFilters={clearFilters} focusProductId={chatTargetProductId} onFocusProductHandled={() => setChatTargetProductId(null)} />
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
                  <ProductImage product={item} className="h-full w-full object-cover" alt={item.name} />
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
                {[["cod", "COD"], ["qrph", "GCash / QR Ph"], ["debit", "Debit"], ["credit", "Credit"], ["maya", "Maya"]].map(([value, label]) => (
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
        {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
      </div>
    );
  }

  if (active === "Orders") return (
    <Orders
      rows={orders}
      profile={profile}
      reviews={reviews}
      returnRequests={returnRequests}
      deliverySafetyPolicy={deliverySafetyPolicyFromShop(shopInfo)}
      onNavigate={onChange}
        onMeetupConfirmation={confirmMeetup}
        onQrPayment={(payment) => { setQrPayment(payment); onChange("Cart"); }}
      onOrderCancelled={(updatedOrder) => {
        setOrders((current) => current.map((order) => Number(order.id) === Number(updatedOrder.id) ? { ...order, ...updatedOrder } : order));
        clearGetCache("/orders");
        load(filtersRef.current, { force: true }).catch(() => {});
      }}
    />
  );
  if (active === "Notifications") {
    return (
      <Notifications
        rows={notifications}
        onRead={(id) => setNotifications((items) => items.map((item) => Number(item.id) === Number(id) ? { ...item, is_read: true } : item))}
        onShopSale={openSaleProducts}
        onNavigate={onChange}
      />
    );
  }
  if (active === "About") return <AboutShop shop={shopInfo} />;
  if (active === "Feedback") return <Feedback orders={orders} reviews={reviews} onSaved={() => load(filtersRef.current, { force: true })} />;
  if (active === "Returns") return <ReturnForm orders={orders} returnRequests={returnRequests} onSaved={() => load(filtersRef.current, { force: true })} />;
  return (
    <>
      <Profile profile={profile} profilePhoto={profilePhoto} setProfilePhoto={setProfilePhoto} saveProfile={saveProfile} shippingQuote={shippingQuote} shippingQuoteLoading={shippingQuoteLoading} onDeactivate={deactivateAccount} deactivating={deactivating} />
      <ConfirmDialog
        open={deactivateConfirmOpen}
        title="Deactivate your account?"
        message="You will be signed out and will need admin help to restore access."
        confirmLabel="Deactivate Account"
        busy={deactivating}
        onClose={() => {
          if (!deactivating) setDeactivateConfirmOpen(false);
        }}
        onConfirm={confirmDeactivateAccount}
      />
    </>
  );
}

function FloatingNotificationsWidget({ rows = [], onViewAll }) {
  return <NotificationPreviewPanel notifications={customerNotificationRows(rows)} onViewAll={onViewAll} maxItems={3} />;
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
  deliveryLocation,
  shippingQuote,
  shippingQuoteLoading,
  shippingQuoteError,
  retryShippingQuote,
  deliverySafetyPolicy,
  onOpenLocationSelector,
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
  const normalizedDeliveryLocation = normalizeDeliveryLocation(deliveryLocation);
  const hasLocation = hasDeliveryLocation(normalizedDeliveryLocation);
  const distanceLabel = formatDistanceKm(shippingQuote?.distanceKm);
  return (
    <div className="retela-customer-checkout-layout grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                  <ProductImage product={item} className="h-full w-full object-cover" alt={item.name} />
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

      <Card className="retela-checkout-card h-fit">
        <h3 className="font-display text-xl font-bold text-slate-950">Checkout</h3>
        <div className={`retela-delivery-location-card mt-4 ${hasLocation ? "has-location" : ""}`}>
          <div className="retela-delivery-location-icon">
            <MapPin size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="retela-delivery-location-eyebrow">Delivery Location</p>
            {hasLocation ? (
              <>
                <strong>{normalizedDeliveryLocation.address}</strong>
                <span>{hasDeliveryCoordinates(normalizedDeliveryLocation) ? "Exact location saved" : "Address saved. Add an exact pin when available."}</span>
                {normalizedDeliveryLocation.landmark ? <span>{normalizedDeliveryLocation.landmark}</span> : null}
                {distanceLabel ? <span>Distance from shop: {distanceLabel}</span> : null}
                {shippingQuote ? <span>Shipping: {shippingFeeText(shippingQuote)}</span> : shippingQuoteLoading ? <span>Calculating shipping...</span> : null}
                {deliveryAreaText(shippingQuote) ? <span>Delivery Area: {deliveryAreaText(shippingQuote)}</span> : null}
                {shippingQuote?.reason ? <span>Reason: {shippingQuote.reason}</span> : null}
              </>
            ) : (
              <>
                <strong>No delivery location selected.</strong>
                <span>Set where this order should be delivered before checkout.</span>
              </>
            )}
          </div>
          <button type="button" onClick={onOpenLocationSelector} className="retela-delivery-location-action">
            {hasLocation ? "Change" : "Set Location"}
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Payment Method</p>
          <div className="payment-methods grid grid-cols-2 gap-2">
            {[["cod", "COD"], ["qrph", "GCash / QR Ph"], ["debit", "Debit"], ["credit", "Credit"], ["maya", "Maya"]].map(([value, label]) => (
              <button key={value} type="button" onClick={() => selectPaymentMethod(value)} className={`payment-method-option inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold transition ${paymentMethod === value ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:text-emerald-700"}`}>
                {value === "debit" ? <CreditCard size={14} /> : <WalletCards size={14} />}{label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Coupon Code</p>
          <div className="retela-coupon-row flex gap-2">
            <input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="ENTER CODE" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" />
            <button type="button" onClick={applyCoupon} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Apply</button>
          </div>
          {appliedCoupon ? <p className="text-xs font-bold text-emerald-700">{appliedCoupon.code} applied{appliedCoupon.freeShipping ? " with free shipping" : ""}.</p> : null}
          {couponError ? <p className="text-xs font-bold text-rose-600">{couponError}</p> : null}
        </div>
        <div className="retela-order-summary mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="retela-order-summary-row flex items-center justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <strong className="text-slate-900">{money(pricing.subtotal)}</strong>
          </div>
          <div className="retela-order-summary-row flex items-center justify-between text-sm text-slate-600">
            <span>Coupon Discount</span>
            <strong className="text-emerald-700">-{money(pricing.couponDiscount)}</strong>
          </div>
          <div className="retela-order-summary-row flex items-center justify-between text-sm text-slate-600">
            <span>Sales Discount</span>
            <strong className="text-emerald-700">-{money(pricing.saleDiscount)}</strong>
          </div>
          <div className="retela-order-summary-row flex items-center justify-between text-sm text-slate-600">
            <span>Shipping</span>
            <strong className={shippingQuote && Number(shippingQuote.shippingFee || 0) <= 0 ? "text-emerald-700" : "text-slate-900"}>{shippingFeeText(shippingQuote, shippingQuoteLoading)}</strong>
          </div>
          <div className="retela-order-summary-row retela-order-summary-total flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm font-bold text-slate-700">Total</span>
            <strong className="font-display text-2xl text-emerald-700">{money(pricing.total)}</strong>
          </div>
        </div>
        {shippingQuoteError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
            <span>{shippingQuoteError}</span>
            <button type="button" className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs" onClick={retryShippingQuote}>Retry</button>
          </div>
        ) : null}
        <DeliverySafetyPolicyCard policy={deliverySafetyPolicy} compact />
        {!selectedCount ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">Please select at least one item.</p> : null}
        <Button className="retela-checkout-button mt-4 w-full" disabled={!selectedCount || checkoutLoading} onClick={openCheckoutSummary}>
          <ShoppingCart size={17} /> {checkoutLoading && paymentMethod !== "cod" ? `Redirecting to ${paymentLabel(paymentMethod)}...` : checkoutLoading ? "Processing..." : paymentMethod === "cod" ? "Checkout" : `Checkout with ${paymentLabel(paymentMethod)}`}
        </Button>
      </Card>
    </div>
  );
}

function DeliverySafetyPolicyCard({ policy, compact = false }) {
  return (
    <section className={`retela-delivery-safety-card ${compact ? "is-compact" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="retela-delivery-safety-icon"><ShieldCheck size={17} /></span>
        <div className="min-w-0">
          <p className="retela-modal-eyebrow">Delivery & Meetup Safety</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{policy || defaultDeliverySafetyPolicy}</p>
        </div>
      </div>
    </section>
  );
}

function FeaturedApparelHero({ items, loading, onAddToCart, onBuyNow }) {
  const [selectedApparel, setSelectedApparel] = useState(null);
  const [quickViewProduct, setQuickViewProduct] = useState(null);
  const availableItems = useMemo(() => items.filter((item) => Number(item.stock || 0) > 0), [items]);

  function openDetails(item) {
    setSelectedApparel(item);
  }

  function closeDetails() {
    setSelectedApparel(null);
  }

  function openQuickView(event, item) {
    event.stopPropagation();
    setQuickViewProduct(item);
  }

  useEffect(() => {
    if (!selectedApparel) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setModalBodyLock(true);
    function handleKeyDown(event) {
      if (event.key === "Escape") closeDetails();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      setModalBodyLock(false);
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
                  <div
                    role="button"
                    tabIndex={0}
                    className="grid min-h-[370px] w-full cursor-pointer gap-0 text-left lg:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.58fr)]"
                    onClick={() => openDetails(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") openDetails(item);
                    }}
                  >
                    <div className="relative min-h-[270px] overflow-hidden bg-slate-950/85 lg:min-h-[420px]">
                      {image ? (
                        <ProductImage src={image} alt={item.name} className="h-full min-h-[270px] w-full object-contain lg:min-h-[420px]" />
                      ) : (
                        <div className="grid h-full min-h-[270px] place-items-center text-white/35 lg:min-h-[420px]">
                          <FileImage size={42} />
                        </div>
                      )}
                      <button type="button" className="retela-product-eye-button retela-featured-eye-button" onClick={(event) => openQuickView(event, item)} aria-label={`Preview ${item.name}`}>
                        <Eye size={17} />
                      </button>
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
                  </div>
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
      <ProductQuickView
        product={quickViewProduct}
        isOpen={Boolean(quickViewProduct)}
        onClose={() => setQuickViewProduct(null)}
        mode="customer"
        onAddToCart={onAddToCart}
        onBuyNow={onBuyNow}
      />
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
    <div className="retela-product-details-backdrop fixed inset-0 z-[220] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <section
        className="retela-product-details-modal max-h-[92vh] w-[96vw] max-w-[1080px] overflow-y-auto rounded-[28px] border border-emerald-100 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
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

        <div className="retela-product-details-grid grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="grid gap-3">
            <div className="retela-product-image-frame grid min-h-[320px] place-items-center overflow-hidden rounded-3xl bg-slate-100">
              {activeImage ? (
                <ProductImage src={activeImage} alt={item.name} className="retela-product-details-image max-h-[62vh] w-full object-contain" />
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
                    <ProductImage src={image} alt="" className="h-full w-full object-cover" />
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

        <div className="retela-product-action-row sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 p-5 backdrop-blur sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
            Close
          </button>
          <Button type="button" disabled={outOfStock} onClick={() => onAddToCart(item)}>
            <ShoppingCart size={17} /> {outOfStock ? "Out of stock" : "Add to Cart"}
          </Button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function Shop({ products, addToCart, buyNow, filters, setFilters, filterOptions, clearFilters, focusProductId, onFocusProductHandled }) {
  const [selectedApparel, setSelectedApparel] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState(null);

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
    setModalBodyLock(true);
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      if (isPhotoModalOpen) closePhoto();
      else closeDetails();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      setModalBodyLock(false);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDetailsModalOpen, isPhotoModalOpen]);

  useEffect(() => {
    if (!selectedApparel) return;
    const latest = products.find((item) => Number(item.id) === Number(selectedApparel.id));
    if (!latest) {
      setIsDetailsModalOpen(false);
      setIsPhotoModalOpen(false);
      setSelectedApparel(null);
      return;
    }
    if (latest !== selectedApparel) setSelectedApparel(latest);
  }, [products, selectedApparel]);

  useEffect(() => {
    if (!focusProductId) return;
    const target = products.find((item) => Number(item.id) === Number(focusProductId));
    if (!target) return;
    setSelectedApparel(target);
    setIsDetailsModalOpen(true);
    setIsPhotoModalOpen(false);
    onFocusProductHandled?.();
  }, [focusProductId, onFocusProductHandled, products]);

  return (
    <>
      <Card className="retela-shop-card">
        <div className="retela-shop-filter-panel mb-4 grid gap-3">
          <div className="retela-shop-filter-header flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Shop search</p>
              <h3 className="mt-1 font-display text-2xl font-bold text-white">Shop Apparel</h3>
            </div>
            <button type="button" onClick={clearFilters} className="retela-shop-clear-button rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand">
              Clear filters
            </button>
          </div>
          <CustomerFilters filters={filters} setFilters={setFilters} filterOptions={filterOptions} />
          <p className="text-sm text-white/55">{products.length} apparel items found</p>
        </div>
        <div className="retela-shop-product-grid">
          {products.map((p) => {
            const stock = Number(p.stock || 0);
            const outOfStock = stock <= 0;
            const status = stockStatus(p.stock);
            return (
              <article key={p.id} className="retela-product-card flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="retela-product-card-image-wrap relative overflow-hidden bg-slate-100">
                  <ProductImage product={p} className="retela-shop-product-image h-full w-full object-cover" alt={p.name} />
                  <span className={`retela-product-stock-badge absolute right-2 top-2 rounded-full border font-black ${stockBadgeClass(p.stock)}`}>{status}</span>
                  <button type="button" className="retela-product-eye-button" onClick={() => setQuickViewProduct(p)} aria-label={`Preview ${p.name}`}>
                    <Eye size={15} />
                  </button>
                </div>
                <div className="retela-product-card-body flex flex-1 min-w-0 flex-col">
                  <h4 className="retela-product-card-title font-bold text-slate-950">{p.name}</h4>
                  <p className="retela-product-card-meta min-w-0 text-slate-600">
                    <span className="truncate">{p.brand || "Other"}</span>
                    <span aria-hidden="true"> | </span>
                    <span className="truncate">{p.category || "T-Shirts"}</span>
                    <span aria-hidden="true"> | </span>
                    <span className="truncate">{p.size || "Free Size"}</span>
                  </p>
                  <p className="retela-product-card-price font-black text-emerald-700">PHP {Number(p.price || 0).toLocaleString()}</p>
                  <p className="retela-product-card-condition text-slate-500">{p.condition || "Good"} condition</p>
                  {p.description ? <p className="retela-product-card-description break-words text-slate-500">{p.description}</p> : null}
                  <div className="retela-product-card-actions mt-auto">
                    <button type="button" onClick={() => openDetails(p)} className="retela-product-action-button retela-product-action-view">
                      <Eye size={14} /> <span className="retela-view-label-full">View Details</span><span className="retela-view-label-short">View</span>
                    </button>
                    <button type="button" disabled={outOfStock} onClick={() => addToCart(p)} className="retela-product-action-button retela-product-action-add">
                      <ShoppingCart size={14} /> {outOfStock ? "Out of stock" : "Add"}
                    </button>
                    <button type="button" disabled={outOfStock} onClick={() => buyNow(p)} className="retela-product-action-button retela-product-action-buy">
                      {outOfStock ? "Out of stock" : "Buy Now"}
                    </button>
                  </div>
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
      <ProductQuickView
        product={quickViewProduct}
        isOpen={Boolean(quickViewProduct)}
        onClose={() => setQuickViewProduct(null)}
        mode="customer"
        onAddToCart={addToCart}
        onBuyNow={buyNow}
      />
    </>
  );
}

function CustomerFilters({ filters, setFilters, filterOptions }) {
  return (
    <div className="retela-customer-filter-grid grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Field icon={Search} placeholder="Search apparel, brands, or categories" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} wrapperClassName="retela-customer-filter-search" />
      <select className="retela-customer-filter-control retela-filter-brand rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })}>
        <option value="all">Brand</option>
        {productBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
      </select>
      <select className="retela-customer-filter-control retela-filter-category rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
        <option value="all">Category</option>
        {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <select className="retela-customer-filter-control retela-filter-size rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.size} onChange={(e) => setFilters({ ...filters, size: e.target.value })}>
        <option value="all">Size</option>
        {productSizes.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
      <input className="retela-customer-filter-control retela-filter-min-price rounded-xl border border-slate-200 bg-white p-3 text-sm" type="number" min="0" placeholder="Min price" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} />
      <input className="retela-customer-filter-control retela-filter-max-price rounded-xl border border-slate-200 bg-white p-3 text-sm" type="number" min="0" placeholder="Max price" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} />
      <select className="retela-customer-filter-control retela-filter-sort rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}>
        <option value="latest">Latest</option>
        <option value="lowest_price">Price: Low to High</option>
        <option value="highest_price">Price: High to Low</option>
        <option value="name_asc">Name A-Z</option>
      </select>
      <select className="retela-customer-filter-control retela-customer-filter-stock rounded-xl border border-slate-200 bg-white p-3 text-sm" value={filters.stock} onChange={(e) => setFilters({ ...filters, stock: e.target.value })}>
        <option value="all">All</option>
        <option value="in_stock">In Stock</option>
      </select>
    </div>
  );
}

function ApparelDetailsModal({ item, onClose, onViewPhoto, onAdd, onBuyNow }) {
  const status = stockStatus(item.stock);
  const outOfStock = Number(item.stock || 0) <= 0;
  return createPortal(
    <div className="retela-product-details-backdrop fixed inset-0 z-[200] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <section
        className="retela-product-details-modal max-h-[90vh] w-[95vw] max-w-[800px] overflow-y-auto rounded-[28px] border border-emerald-100 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.38)]"
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

        <div className="retela-product-details-grid grid gap-5 p-5">
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

          <div className="retela-product-action-row flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                Close
              </button>
              <button type="button" onClick={onViewPhoto} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">
                <FileImage size={17} /> View Photo
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button disabled={outOfStock} onClick={() => onAdd(item)}><ShoppingCart size={17} /> {outOfStock ? "Unavailable" : "Add to Cart"}</Button>
              <Button disabled={outOfStock} onClick={() => onBuyNow(item)}>{outOfStock ? "Unavailable" : "Buy Now"}</Button>
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
            <ProductImage src={item.image_url} className="max-h-[76vh] w-full object-contain" alt={item.name} />
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

function calculateCartPricing(items, promotions, coupon, fulfillmentMethod = "delivery", shippingQuote = null) {
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
  const shippingFee = fulfillmentMethod === "delivery" && shippingQuote
    ? Math.max(0, Number(shippingQuote.shippingFee || 0))
    : 0;
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

function DeliveryLocationSelector({ initialLocation, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeDeliveryLocation(initialLocation));
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  async function submitLocation(event) {
    event.preventDefault();
    const next = normalizeDeliveryLocation(draft);
    const message = locationValidationMessage(next);
    if (message) {
      setValidationError(message);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <motion.div className="retela-location-selector-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.form className="retela-location-selector" initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.96 }} onSubmit={submitLocation} onMouseDown={(event) => event.stopPropagation()}>
        <div className="retela-location-selector-header">
          <div>
            <p>Checkout Delivery</p>
            <h3>Set Delivery Location</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close delivery location selector">
            <X size={18} />
          </button>
        </div>

        <div className="retela-location-selector-body">
          <StructuredLocationPicker
            value={draft}
            onChange={(location) => {
              setValidationError("");
              setDraft((current) => ({ ...location, landmark: current.landmark, notes: current.notes }));
            }}
            error={validationError}
            label="Search delivery location"
            placeholder="Street, barangay, municipality..."
          />

          <div className="retela-location-fields">
            <label>
              <span>House / Building / Landmark</span>
              <input value={draft.landmark} onChange={(event) => setDraft((current) => ({ ...current, landmark: event.target.value }))} placeholder="Green gate beside barangay hall" />
            </label>
            <label>
              <span>Delivery Notes</span>
              <input value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Call when outside." />
            </label>
            <p className="retela-location-persistence-note">This location will be saved to your customer profile and used for delivery pricing.</p>
          </div>
        </div>

        <div className="retela-location-selector-footer">
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {saving ? "Saving..." : "Save Location"}</button>
        </div>
      </motion.form>
    </motion.div>,
    document.body
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

function CheckoutSummaryModal({ items, pricing, paymentMethod, paymentDetails, paymentError, updatePaymentNumber, deliveryLocation, shippingQuote, shippingQuoteLoading, fulfillmentMethod, deliverySafetyPolicy, checkout, checkoutLoading, onClose }) {
  const normalizedDeliveryLocation = normalizeDeliveryLocation(deliveryLocation);
  const distanceLabel = formatDistanceKm(shippingQuote?.distanceKm);
  const shippingUnavailable = fulfillmentMethod === "delivery" && (shippingQuoteLoading || !shippingQuote);
  return createPortal(
    <motion.div
      className="retela-checkout-modal-backdrop fixed inset-0 z-[175] grid place-items-center overflow-y-auto bg-black/45 p-4 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.section
        className="retela-checkout-summary-modal my-6 w-full max-w-2xl rounded-[28px] border border-neonbrand/25 bg-slate-950/92 p-5 text-white shadow-[0_30px_110px_rgba(0,0,0,0.55),0_0_55px_rgba(56,255,136,0.12)] backdrop-blur-2xl sm:p-6"
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

        <div className="retela-checkout-summary-items mt-5 grid max-h-72 gap-3 overflow-y-auto pr-1">
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

        <div className="retela-order-summary retela-checkout-summary-totals mt-5 grid gap-2 rounded-2xl border border-white/10 bg-black/25 p-4">
          <SummaryLine label="Subtotal" value={money(pricing.subtotal)} />
          <SummaryLine label="Coupon Discount" value={`-${money(pricing.couponDiscount)}`} highlight />
          <SummaryLine label="Sales Discount" value={`-${money(pricing.saleDiscount)}`} highlight />
          <SummaryLine label="Shipping" value={shippingFeeText(shippingQuote, shippingQuoteLoading)} />
          <SummaryLine label="Final Total" value={money(pricing.total)} strong />
        </div>

        <div className="retela-checkout-summary-delivery mt-5 rounded-2xl border border-neonbrand/15 bg-neonbrand/5 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-neonbrand/75">Delivery Location</p>
          <h4 className="mt-2 break-words text-sm font-bold text-white">{normalizedDeliveryLocation.address || "No delivery location selected."}</h4>
          {normalizedDeliveryLocation.landmark ? <p className="mt-2 break-words text-xs font-semibold text-white/58">Landmark: {normalizedDeliveryLocation.landmark}</p> : null}
          {normalizedDeliveryLocation.notes ? <p className="mt-1 break-words text-xs font-semibold text-white/58">Notes: {normalizedDeliveryLocation.notes}</p> : null}
          {hasDeliveryCoordinates(normalizedDeliveryLocation) ? <p className="mt-2 text-xs font-bold text-neonbrand">Exact map pin saved for this order.</p> : null}
          {distanceLabel ? <p className="mt-2 text-xs font-semibold text-white/70">Distance from shop: {distanceLabel}</p> : null}
          <p className="mt-1 text-xs font-bold text-neonbrand">Shipping: {shippingFeeText(shippingQuote, shippingQuoteLoading)}</p>
          {deliveryAreaText(shippingQuote) ? <p className="mt-1 text-xs font-bold text-neonbrand">Delivery Area: {deliveryAreaText(shippingQuote)}</p> : null}
          {shippingQuote?.reason ? <p className="mt-1 text-xs font-semibold text-white/70">Reason: {shippingQuote.reason}</p> : null}
        </div>
        <DeliverySafetyPolicyCard policy={deliverySafetyPolicy} compact />

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

        <div className="retela-checkout-modal-actions mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={checkoutLoading} className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white transition hover:text-neonbrand disabled:opacity-60">Cancel</button>
          <Button type="button" onClick={checkout} disabled={checkoutLoading || shippingUnavailable}>
            {checkoutLoading || shippingUnavailable ? <Loader2 size={17} className="animate-spin" /> : <ShoppingCart size={17} />}
            {shippingUnavailable ? "Updating shipping..." : checkoutLoading && paymentMethod !== "cod" ? `Redirecting to ${paymentLabel(paymentMethod)}...` : checkoutLoading ? "Processing..." : "Confirm Checkout"}
          </Button>
        </div>
      </motion.section>
    </motion.div>,
    document.body
  );
}

function QrPhPaymentScreen({ payment, onClose, onViewOrder, onPaid, onRegenerate }) {
  const orderId = payment?.orderId || payment?.id;
  const [status, setStatus] = useState(String(payment?.payment_status || "awaiting_payment").toLowerCase());
  const [secondsRemaining, setSecondsRemaining] = useState(() => {
    const expires = payment?.expiresAt ? new Date(payment.expiresAt).getTime() : Date.now() + 30 * 60 * 1000;
    return Math.max(0, Math.floor((expires - Date.now()) / 1000));
  });
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const notifiedPaid = useRef(false);
  const qrImage = payment?.qrImage || payment?.qr_image || payment?.order?.qr_code_url || "";
  const amount = Number(payment?.amount || payment?.total_amount || payment?.order?.total_amount || 0);
  const expired = secondsRemaining <= 0 && status !== "paid";

  useEffect(() => {
    const timer = window.setInterval(() => setSecondsRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!orderId || ["paid", "failed", "cancelled"].includes(status) || expired) return undefined;
    let active = true;
    const checkStatus = async () => {
      try {
        const { data } = await api.get(`/payments/orders/${orderId}/status`);
        if (!active) return;
        const nextStatus = String(data?.payment_status || data?.order?.payment_status || "awaiting_payment").toLowerCase();
        setStatus(nextStatus);
        setError("");
        if (nextStatus === "paid" && !notifiedPaid.current) {
          notifiedPaid.current = true;
          onPaid?.();
        }
      } catch (requestError) {
        if (active) setError(requestError?.response?.data?.message || "Payment status is temporarily unavailable.");
      }
    };
    checkStatus();
    const timer = window.setInterval(checkStatus, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [expired, onPaid, orderId, status]);

  const timeLabel = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const paid = status === "paid";
  const failed = ["failed", "cancelled"].includes(status);

  return createPortal(
    <motion.div className="fixed inset-0 z-[260] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="w-full max-w-lg rounded-[28px] border border-neonbrand/25 bg-slate-950 p-5 text-white shadow-2xl sm:p-7" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-neonbrand/75">Pay with GCash / QR Ph</p>
            <h2 className="mt-2 font-display text-2xl font-bold">Order #{orderId}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-white/65 hover:text-neonbrand">Close</button>
        </div>
        <div className="mt-5 rounded-2xl border border-neonbrand/20 bg-neonbrand/10 p-4 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">Amount to Pay</p>
          <p className="mt-1 font-display text-3xl font-black text-neonbrand">PHP {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        {paid ? (
          <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-5 text-center">
            <CheckCircle2 className="mx-auto text-neonbrand" size={42} />
            <h3 className="mt-3 font-display text-2xl font-bold">Payment Successful</h3>
            <p className="mt-1 text-sm text-white/65">GCash / QR Ph · Paid</p>
            <button type="button" onClick={onViewOrder} className="mt-4 inline-flex items-center justify-center rounded-xl bg-neonbrand px-4 py-3 text-sm font-black text-black">View Order</button>
          </div>
        ) : failed ? (
          <div className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-5 text-center">
            <h3 className="font-display text-xl font-bold">Payment could not be completed</h3>
            <p className="mt-2 text-sm text-white/65">You can close this screen and try the payment again from Orders.</p>
          </div>
        ) : expired ? (
          <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-5 text-center">
            <h3 className="font-display text-xl font-bold">Payment QR expired</h3>
            <p className="mt-2 text-sm text-white/65">Generate a new QR when you are ready to pay.</p>
            <button
              type="button"
              disabled={regenerating}
              onClick={async () => {
                setRegenerating(true);
                setError("");
                try {
                  await onRegenerate?.();
                } catch (regenerateError) {
                  setError(regenerateError?.response?.data?.message || "Unable to generate a new payment QR.");
                } finally {
                  setRegenerating(false);
                }
              }}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-neonbrand px-4 py-3 text-sm font-black text-black disabled:opacity-60"
            >
              {regenerating ? <Loader2 size={16} className="animate-spin" /> : null}
              {regenerating ? "Generating..." : "Generate New QR"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid place-items-center rounded-2xl bg-white p-4">
              {qrImage ? <img src={qrImage} alt="RETELA QR Ph payment code" className="h-64 w-64 max-w-full object-contain" /> : <Loader2 className="animate-spin text-emerald-700" size={32} />}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold text-neonbrand">Waiting for payment...</span>
              <span className="text-white/65">QR expires in {timeLabel}</span>
            </div>
            {qrImage ? <a href={qrImage} download={`RETELA-ORDER-${orderId}-QR.png`} className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-neonbrand/30 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand hover:bg-neonbrand hover:text-black">Save QR to Phone</a> : null}
            <ol className="mt-4 grid gap-1 text-sm leading-6 text-white/65">
              <li>1. Save the QR image.</li>
              <li>2. Open GCash, Maya, or another QR Ph app and scan/upload it.</li>
              <li>3. Confirm the exact amount, then return to RETELA.</li>
            </ol>
          </>
        )}
        {error ? <p className="mt-3 text-xs font-semibold text-amber-200">{error}</p> : null}
      </motion.section>
    </motion.div>,
    document.body
  );
}

function SummaryLine({ label, value, highlight = false, strong = false }) {
  return (
    <div className={`retela-summary-line flex items-center justify-between gap-4 ${strong ? "border-t border-white/10 pt-3" : ""}`}>
      <span className={`${strong ? "font-bold text-white" : "text-sm text-white/58"}`}>{label}</span>
      <strong className={`${highlight ? "text-neonbrand" : "text-white"} ${strong ? "font-display text-2xl text-neonbrand" : "text-sm"}`}>{value}</strong>
    </div>
  );
}

function PaymentLoadingOverlay({ method }) {
  const showBlockingLoader = useBlockingLoader(Boolean(method));

  if (!showBlockingLoader) {
    return (
      <motion.div
        className="fixed right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[9999] w-[calc(100vw-24px)] max-w-xs rounded-2xl border border-neonbrand/25 bg-[#07110d]/95 p-4 text-white shadow-2xl shadow-black/35 backdrop-blur-xl sm:right-5 sm:top-5"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
      >
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          <Loader2 size={16} className="animate-spin text-neonbrand" />
          Still preparing {paymentLabel(method)} checkout...
        </p>
      </motion.div>
    );
  }

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
        <h3 className="mt-5 font-display text-2xl font-bold">Redirecting to {paymentLabel(method)}...</h3>
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

function Notifications({ rows, onRead, onShopSale, onNavigate }) {
  const [selectedNotification, setSelectedNotification] = useState(null);

  async function openNotification(notification) {
    const nextNotification = { ...notification, is_read: true };
    const target = notificationNavigationTarget(nextNotification);
    setSelectedNotification(target.openModal ? nextNotification : null);
    if (!notification.is_read) {
      onRead?.(notification.id);
      window.dispatchEvent(new CustomEvent("retela:notification-read", { detail: { id: notification.id } }));
      await api.patch(`/notifications/${notification.id}/read`).catch(() => {});
    }
    if (target.section) onNavigate?.(target.section);
    if (target.openAssistant) {
      window.dispatchEvent(new CustomEvent("retela:open-customer-assistant"));
    }
    if (!target.openModal && target.saleProductIds?.length) {
      onShopSale?.(target.saleProductIds);
    }
  }

  function closeNotification() {
    setSelectedNotification(null);
  }

  function handleCopyPromo(code) {
    const promoCode = String(code || "").trim();
    if (!promoCode) return;
    navigator.clipboard?.writeText(promoCode).catch(() => {});
    dispatchCustomerToast({ type: "success", message: "Promo code copied." });
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

function notificationSaleProductIds(notification) {
  const relatedProducts = Array.isArray(notification?.related_products) ? notification.related_products : [];
  const sourceIds = relatedProducts.length
    ? relatedProducts.map((item) => item.id)
    : notification?.broadcast?.product_ids || [];
  return sourceIds.map(Number).filter(Boolean);
}

function notificationNavigationTarget(notification) {
  const type = notification?.type;
  const displayType = notificationDisplayType(notification);
  const saleProductIds = notificationSaleProductIds(notification);
  const promotional = displayType === "promo" || Boolean(notificationPromoStatus(notification));

  if (type === "message") return { section: "Home", openAssistant: true, openModal: false };
  if (type === "order") return { section: "Orders", openModal: false };
  if (type === "refund") return { section: "Returns", openModal: false };
  if (type === "feedback") return { section: "Feedback", openModal: false };
  if (type === "new_product") return { section: "Shop", openModal: false };
  if (type === "approval") return { section: "Profile", openModal: false };
  if (type === "broadcast" || promotional) return { openModal: true, saleProductIds };
  return { openModal: true };
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
                      <ProductImage product={product} className="h-full w-full object-cover" alt={product.name} />
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

function Orders({ rows, profile, reviews = [], returnRequests = [], deliverySafetyPolicy, onNavigate, onOrderCancelled, onMeetupConfirmation, onQrPayment }) {
  const flow = ["pending", "awaiting_payment", "paid", "processing", "completed"];
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [cancelDialogOrder, setCancelDialogOrder] = useState(null);
  const [redirectingPayment, setRedirectingPayment] = useState(null);
  const reviewedOrderIds = useMemo(() => new Set(reviews.map((review) => Number(review.order_id))), [reviews]);
  const returnStateByOrder = useMemo(() => {
    const map = new Map();
    returnRequests.forEach((request) => map.set(Number(request.order_id), request.status));
    return map;
  }, [returnRequests]);

  async function payOrder(order, event) {
    event?.stopPropagation();
    if (!order || order.payment_method === "cod" || payingOrderId || isOrderCancelled(order)) return;
    if (order.payment_method === "qrph") {
      setPayingOrderId(order.id);
      try {
        const { data } = await api.post("/payments/paymongo/qrph/create", { orderId: order.id });
        onQrPayment?.({ ...data, orderId: order.id, amount: Number(order.total_amount || 0) });
      } catch (error) {
        dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || "Unable to create the QR payment." });
      } finally {
        setPayingOrderId(null);
      }
      return;
    }
    const billingPhone = profile?.phone_number || order.phone_number || "";
    if (!isValidPaymentNumber(billingPhone)) {
      dispatchCustomerToast({ type: "error", message: `Add a valid ${paymentNumberLabels[order.payment_method].toLowerCase()} in your Profile before paying.` });
      return;
    }
    setPayingOrderId(order.id);
    setRedirectingPayment(order.payment_method);
    let didRedirect = false;
    try {
      console.log("Selected payment method:", order.payment_method);
      console.log("Starting GCash checkout");
      const { data } = await api.post("/payments/create-gcash-checkout", { orderId: order.id, paymentMethod: order.payment_method, billingPhone });
      console.log("GCash API response:", data);
      const checkoutUrl = paymentCheckoutUrl(data);
      if (!checkoutUrl) {
        throw new Error("GCash checkout URL was not returned by the server.");
      }
      didRedirect = true;
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error("GCash checkout failed:", error);
      console.error("GCash server response:", error?.response?.data);
      dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || error?.message || "Unable to continue to GCash payment." });
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
    setModalBodyLock(true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      alive = false;
      document.body.style.overflow = "";
      setModalBodyLock(false);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedOrderId]);

  function openAction(target, event) {
    event.stopPropagation();
    onNavigate?.(target);
  }

  function openCancelDialog(order, event) {
    event.stopPropagation();
    if (!canCancelOrder(order)) return;
    setCancelDialogOrder(order);
  }

  async function confirmCancelOrder() {
    if (!cancelDialogOrder || cancellingOrderId) return;
    setCancellingOrderId(cancelDialogOrder.id);
    try {
      const { data } = await api.patch(`/orders/${cancelDialogOrder.id}/cancel`);
      const updatedOrder = data?.order || { ...cancelDialogOrder, status: "cancelled", payment_status: "cancelled", checkout_url: null };
      onOrderCancelled?.(updatedOrder);
      setSelectedOrder((current) => current?.order && Number(current.order.id) === Number(updatedOrder.id)
        ? { ...current, order: { ...current.order, ...updatedOrder } }
        : current);
      dispatchCustomerToast({ type: "success", message: data?.message || "Order cancelled successfully." });
      setCancelDialogOrder(null);
    } catch (error) {
      dispatchCustomerToast({ type: "error", message: error?.response?.data?.message || "This order can no longer be cancelled." });
    } finally {
      setCancellingOrderId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {rows.map((order) => {
        const cancelled = isOrderCancelled(order);
        const canCancel = canCancelOrder(order);
        const canPay = canPayOrder(order);
        const orderMapUrl = deliveryMapUrl(deliveryLocationFromOrder(order));
        return (
        <div key={order.id} role="button" tabIndex={0} onClick={() => setSelectedOrderId(order.id)} onKeyDown={(event) => event.key === "Enter" ? setSelectedOrderId(order.id) : null} className="text-left outline-none">
        <Card className="rounded-[20px] border-slate-100 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_20px_45px_rgba(15,23,42,0.1)]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50 text-sm font-black text-emerald-700">
                {order.first_product_image ? <ProductImage src={order.first_product_image} className="h-full w-full object-cover" alt={order.first_product_name || "Order apparel"} /> : brandInitials(order.brands)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-slate-950">{order.brands || "RETELA Apparel"}</strong>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${customerOrderStatusClass(order.status)}`}>{customerOrderStatus(order.status)}</span>
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
              {!cancelled ? (
                <button type="button" disabled={order.status !== "completed" || reviewedOrderIds.has(Number(order.id))} onClick={(event) => openAction("Feedback", event)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
                  <Star size={15} /> Leave Feedback
                </button>
              ) : null}
              {!cancelled ? (
                <button type="button" disabled={!canRequestReturn(order, returnStateByOrder.get(Number(order.id)))} onClick={(event) => openAction("Returns", event)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
                  <RotateCcw size={15} /> Request Return
                </button>
              ) : null}
            </div>
          </div>
          {!cancelled ? <div className="mt-3 grid grid-cols-5 gap-2">{flow.map((s) => <div key={s} className={`h-1.5 rounded-full ${flow.indexOf(s) <= flow.indexOf(normalizeOrderStatus(order.status)) ? "bg-emerald-500" : "bg-slate-200"}`} />)}</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!cancelled && order.fulfillment_method === "delivery" && orderMapUrl ? (
              <a onClick={(event) => event.stopPropagation()} className="inline-flex min-h-9 min-w-[150px] items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 max-[600px]:w-full" href={orderMapUrl} target="_blank" rel="noreferrer">
                <MapPin size={15} /> Open tracking map
              </a>
            ) : null}
            {canPay ? (
              <button type="button" onClick={(event) => payOrder(order, event)} className="inline-flex min-h-9 min-w-[150px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-[0_12px_24px_rgba(22,163,74,0.18)] max-[600px]:w-full">
                <WalletCards size={15} /> {payingOrderId === order.id ? "Opening..." : `Pay with ${paymentLabel(order.payment_method)}`}
              </button>
            ) : null}
            {canCancel ? (
              <button type="button" disabled={cancellingOrderId === order.id} onClick={(event) => openCancelDialog(order, event)} className="inline-flex min-h-9 min-w-[150px] items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 max-[600px]:w-full">
                <XCircle size={15} /> {cancellingOrderId === order.id ? "Cancelling..." : "Cancel Order"}
              </button>
            ) : null}
          </div>
        </Card>
        </div>
      );})}
      <AnimatePresence>
        {selectedOrderId ? <CustomerOrderModal loading={loading} selectedOrder={selectedOrder} displayNumber={rows.length - rows.findIndex((item) => item.id === selectedOrderId)} deliverySafetyPolicy={deliverySafetyPolicy} onPay={payOrder} payingOrderId={payingOrderId} onMeetupConfirmation={async (...args) => { const data = await onMeetupConfirmation?.(...args); if (data) setSelectedOrder((current) => current?.order ? { ...current, order: { ...current.order, ...data } } : current); return data; }} onClose={() => setSelectedOrderId(null)} /> : null}
        {cancelDialogOrder ? (
          <CancelOrderDialog
            order={cancelDialogOrder}
            cancelling={cancellingOrderId === cancelDialogOrder.id}
            onClose={() => setCancelDialogOrder(null)}
            onConfirm={confirmCancelOrder}
          />
        ) : null}
      </AnimatePresence>
      {redirectingPayment ? <PaymentLoadingOverlay method={redirectingPayment} /> : null}
    </div>
  );
}

function CustomerOrderModal({ loading, selectedOrder, displayNumber, deliverySafetyPolicy, onPay, payingOrderId, onMeetupConfirmation, onClose }) {
  const order = selectedOrder?.order;
  const cancelled = isOrderCancelled(order);
  const meetingPlace = String(order?.meeting_place || "").trim();
  const confirmationStatus = String(order?.meetup_confirmation_status || "pending").toLowerCase();
  const [confirmationStep, setConfirmationStep] = useState(null);
  const [meetupNote, setMeetupNote] = useState("");
  const [confirmationSaving, setConfirmationSaving] = useState(false);

  function messageShop() {
    window.dispatchEvent(new CustomEvent("retela:open-customer-assistant", {
      detail: {
        orderId: order?.id,
        context: order?.id ? `Conversation regarding Order #${order.id}` : "Conversation regarding my order"
      }
    }));
  }

  async function submitMeetupConfirmation(decision) {
    if (confirmationSaving) return;
    setConfirmationSaving(true);
    try {
      await onMeetupConfirmation?.(order, decision, meetupNote);
      setConfirmationStep(null);
      setMeetupNote("");
    } finally {
      setConfirmationSaving(false);
    }
  }

  return (
    <motion.div className="retela-modal-backdrop z-[120]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="retela-modal-card modal-md" initial={{ opacity: 0, scale: 0.94, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 18 }} transition={{ duration: 0.22, ease: "easeOut" }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="customer-order-details-title">
          {loading ? (
            <div className="retela-modal-body grid gap-4">
              <div className="skeleton h-8 w-1/2 rounded-2xl" />
              <div className="skeleton h-24 rounded-3xl" />
              <div className="skeleton h-40 rounded-3xl" />
            </div>
          ) : order ? (
            <>
              <div className="retela-modal-header">
                <div>
                  <p className="retela-modal-eyebrow">Order Details</p>
                  <h3 id="customer-order-details-title" className="retela-modal-title">My Order #{displayNumber}</h3>
                  <p className="retela-modal-subtitle">Created {new Date(order.created_at).toLocaleString()}</p>
                </div>
                <span className={`rounded-full border px-4 py-2 text-sm font-bold ${customerOrderStatusClass(order.status)}`}>{customerOrderStatus(order.status)}</span>
              </div>
              <div className="retela-modal-body grid gap-4">
                <div className="retela-modal-detail-grid two-col">
                  <ModalInfo label="Total" value={`PHP ${order.total_amount}`} />
                  <ModalInfo label="Payment" value={paymentLabel(order.payment_method)} />
                  <ModalInfo label="Tracking Number" value={order.tracking_number || "Waiting for admin"} />
                  <ModalInfo label="Payment Status" value={customerOrderStatus(order.payment_status || "unpaid")} />
                </div>
                {order.fulfillment_method === "delivery" ? <OrderDeliveryInfo order={order} title="Delivery Information" mapLabel="View Location" /> : null}
                {order.meetup_eligible ? <section className="retela-meeting-place-card">
                  <div>
                    <p className="retela-modal-eyebrow">Meeting Place</p>
                    <h4>Admin-selected meetup location</h4>
                  </div>
                  {meetingPlace ? (
                    <>
                      <p>{meetingPlace}</p>
                    </>
                  ) : (
                    <p>Meeting place will be provided by the shop.</p>
                  )}
                  <div className="mt-3 border-t border-emerald-100 pt-3">
                    <p className="retela-modal-eyebrow">Meetup Date &amp; Time</p>
                    <p>{order.meetup_date ? formatMeetupDate(order.meetup_date) : "Meetup date will be provided by the shop."}{order.meetup_time ? ` • ${formatMeetupTime(order.meetup_time)}` : ""}</p>
                  </div>
                  {meetingPlace || order.meetup_date || order.meetup_time ? (
                    <div className="retela-meetup-confirmation">
                      <p className="retela-modal-eyebrow">Customer Confirmation</p>
                      {confirmationStatus === "agreed" ? <p className="retela-meetup-confirmed">✓ Meetup Confirmed</p> : confirmationStatus === "disagreed" ? <><p className="retela-meetup-declined">Schedule declined</p><p>The shop will need to propose another meetup schedule.</p><button type="button" onClick={messageShop} className="retela-meeting-place-action"><MessageCircle size={15} /> Message Shop</button></> : confirmationStep === "agree" ? <div className="grid gap-2"><p>The shop proposed this meetup schedule.</p><p className="font-bold text-slate-800">Confirm this meetup schedule?</p><div className="flex flex-wrap gap-2"><button type="button" disabled={confirmationSaving} onClick={() => submitMeetupConfirmation("agreed")} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">{confirmationSaving ? "Saving..." : "Confirm"}</button><button type="button" onClick={() => setConfirmationStep(null)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Cancel</button></div></div> : confirmationStep === "disagree" ? <div className="grid gap-2"><p>Tell the shop why this schedule does not work (optional).</p><textarea value={meetupNote} onChange={(event) => setMeetupNote(event.target.value)} maxLength={500} rows={2} placeholder="I am not available at this time." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" /><div className="flex flex-wrap gap-2"><button type="button" disabled={confirmationSaving} onClick={() => submitMeetupConfirmation("disagreed")} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white">{confirmationSaving ? "Saving..." : "Decline Schedule"}</button><button type="button" onClick={() => setConfirmationStep(null)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Cancel</button></div></div> : <><p>The shop proposed this meetup schedule.</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setConfirmationStep("agree")} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Agree</button><button type="button" onClick={() => setConfirmationStep("disagree")} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Disagree</button></div></>}
                    </div>
                  ) : null}
                </section> : null}
                <DeliverySafetyPolicyCard policy={deliverySafetyPolicy} />
                <div className="grid gap-2">
                  <p className="retela-modal-eyebrow">Items</p>
                  {selectedOrder.items.map((item) => (
                    <div key={`${item.product_id}-${item.quantity}`} className="retela-modal-item-row">
                      <div className="retela-modal-item-image">
                        <ProductImage src={item.image_url} className="h-full w-full object-cover" alt={item.name} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-slate-950">{item.name}</strong>
                        <p className="mt-1 truncate text-sm text-slate-500">{item.brand || "Other Brands"} | Qty {item.quantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="retela-modal-footer">
                {canPayOrder(order) ? (
                  <button type="button" onClick={(event) => onPay(order, event)} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">
                    {payingOrderId === order.id ? "Opening..." : `Pay with ${paymentLabel(order.payment_method)}`}
                  </button>
                ) : null}
                <button type="button" onClick={messageShop} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
                  <MessageCircle size={15} /> Message Shop
                </button>
                <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">Close</button>
              </div>
            </>
          ) : <p className="retela-modal-body text-slate-600">Order details are not available.</p>}
      </motion.div>
    </motion.div>
  );
}

function CancelOrderDialog({ order, cancelling, onClose, onConfirm }) {
  return (
    <motion.div className="retela-modal-backdrop z-[130]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="retela-modal-card modal-sm" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.96 }} transition={{ duration: 0.18 }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
        <div className="retela-modal-body flex items-start gap-3">
          <span className="retela-confirm-icon">
            <XCircle size={21} />
          </span>
          <div className="min-w-0">
            <h3 id="cancel-order-title" className="font-display text-lg font-bold text-slate-950">Cancel this order?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Are you sure you want to cancel this order? This action cannot be undone.</p>
            <p className="mt-2 text-xs font-bold text-slate-400">{orderNumber(order)}</p>
          </div>
        </div>
        <div className="retela-modal-footer">
          <button type="button" disabled={cancelling} onClick={onClose} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none">
            Keep Order
          </button>
          <button type="button" disabled={cancelling} onClick={onConfirm} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none">
            {cancelling ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
            Cancel Order
          </button>
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

function checkoutErrorMessage(error, paymentMethod = "cod") {
  const serverMessage = String(error?.response?.data?.message || "").trim();
  if (serverMessage) return serverMessage;
  const rawMessage = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || rawMessage.includes("timeout")) {
    return "Checkout is taking longer than expected. Please try again.";
  }
  if (rawMessage.includes("er_lock_wait_timeout") || rawMessage.includes("lock wait timeout") || rawMessage.includes("deadlock")) {
    return "This item is currently being updated. Please try checkout again.";
  }
  return paymentMethod !== "cod" ? "Unable to continue to payment. Please try again." : "Checkout failed. Please try again.";
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
  if (method === "qrph") return "GCash / QR Ph";
  if (method === "debit") return "Debit Card";
  if (method === "credit") return "Credit Card";
  if (method === "maya") return "Maya";
  return "COD";
}

function formatMeetupDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatMeetupTime(value) {
  if (!value) return "";
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return "";
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function Detail({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <span className="block text-xs font-bold uppercase tracking-[0.16em] text-white/40">{label}</span>
      <strong className="mt-1 block break-words text-white/80">{value || "Not provided"}</strong>
    </div>
  );
}

function ModalInfo({ label, value }) {
  return (
    <div className="retela-modal-info-card">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
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
    dispatchCustomerToast({ type, message });
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
    dispatchCustomerToast({ type, message });
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
            {image ? <ProductImage src={image} className="h-full w-full object-cover" alt={name} /> : <div className="grid h-full place-items-center text-white/35"><FileImage size={24} /></div>}
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
    { icon: WalletCards, title: "Location-based Shipping", body: "Nearby configured delivery areas may receive free shipping. The current outside-area fee is shown at checkout from your saved delivery location." }
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
  return sharedOrderStatusLabel(status);
}

function normalizeOrderStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function isOrderCancelled(orderOrStatus) {
  const status = typeof orderOrStatus === "object" ? orderOrStatus?.status : orderOrStatus;
  return ["cancelled", "canceled"].includes(normalizeOrderStatus(status));
}

function canCancelOrder(order) {
  return ["pending", "awaiting_payment"].includes(normalizeOrderStatus(order?.status));
}

function canPayOrder(order) {
  if (!order || isOrderCancelled(order)) return false;
  if (order.payment_method === "cod" || order.payment_status === "paid") return false;
  return !["paid", "processing", "ready", "completed", "cancelled", "canceled", "returned"].includes(normalizeOrderStatus(order.status));
}

function customerOrderStatusClass(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "completed") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (normalized === "cancelled" || normalized === "canceled") return "border-rose-100 bg-rose-50 text-rose-700";
  if (normalized === "payment_failed") return "border-rose-100 bg-rose-50 text-rose-700";
  if (normalized === "pending" || normalized === "awaiting_payment") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-sky-100 bg-sky-50 text-sky-700";
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
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1];
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function Profile({ profile, profilePhoto, setProfilePhoto, saveProfile, shippingQuote, shippingQuoteLoading, onDeactivate, deactivating }) {
  const [editing, setEditing] = useState(false);
  const [draftProfile, setDraftProfile] = useState(profile || {});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileLocationError, setProfileLocationError] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [verificationRecovery, setVerificationRecovery] = useState({ loading: true, verification: null, error: "", message: "" });
  const [governmentIdUploading, setGovernmentIdUploading] = useState(false);
  const [selfieCaptureOpen, setSelfieCaptureOpen] = useState(false);
  const [selfieUploadBusy, setSelfieUploadBusy] = useState(false);
  const [selfieFile, setSelfieFile] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState("");
  const governmentIdInputRef = useRef(null);
  const age = calculateAge(profile?.birthday);

  useEffect(() => {
    if (!editing) setDraftProfile(profile || {});
  }, [editing, profile]);

  const loadVerificationRecovery = useCallback(async () => {
    if (!profile?.id) return;
    setVerificationRecovery((value) => ({ ...value, loading: true, error: "" }));
    try {
      const { data } = await api.get("/identity-verifications/me");
      setVerificationRecovery({ loading: false, verification: data?.verification || null, error: "", message: "" });
    } catch (error) {
      if (error?.response?.status === 404) {
        setVerificationRecovery({ loading: false, verification: null, error: "", message: "" });
        return;
      }
      setVerificationRecovery((value) => ({ ...value, loading: false, error: error?.response?.data?.message || "Could not check verification images." }));
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profilePhoto) {
      setPhotoPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(profilePhoto);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  useEffect(() => {
    void loadVerificationRecovery();
  }, [loadVerificationRecovery]);

  useEffect(() => () => {
    if (selfiePreview?.startsWith("blob:")) URL.revokeObjectURL(selfiePreview);
  }, [selfiePreview]);

  if (!profile) return <Card><p className="text-sm text-slate-500">Loading profile...</p></Card>;
  const current = editing ? draftProfile : profile;
  const photoUrl = photoPreview || assetUrl(profile.profile_photo_url);
  const accountStatus = profileStatusLabel(profile.status);
  const verification = verificationRecovery.verification;
  const governmentIdMissing = verification?.government_id_image?.reason === "FILE_MISSING";
  const selfieMissing = verification?.selfie_verification_image?.reason === "FILE_MISSING";
  const displayName = current.display_name || current.username || "RETELA Customer";
  const username = current.username || "customer";
  const email = current.email || "Email not set";

  function updateDraft(key, value) {
    setDraftProfile((draft) => ({ ...draft, [key]: value }));
  }

  function startEditing() {
    setDraftProfile({ ...(profile || {}), ...profileFieldsFromLocation(deliveryLocationFromProfile(profile)) });
    setProfilePhoto(null);
    setProfileLocationError("");
    setEditing(true);
  }

  function cancelEditing() {
    if (savingProfile) return;
    setDraftProfile(profile || {});
    setProfilePhoto(null);
    setProfileLocationError("");
    setEditing(false);
  }

  function updateDraftLocation(location) {
    setDraftProfile((draft) => ({
      ...draft,
      ...profileFieldsFromLocation(location),
      delivery_landmark: draft.delivery_landmark || "",
      delivery_notes: draft.delivery_notes || ""
    }));
    setProfileLocationError("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    if (savingProfile) return;
    const nextUsername = String(draftProfile.username || "").trim();
    if (!nextUsername) {
      dispatchCustomerToast({ type: "error", message: "Username is required." });
      return;
    }
    if (nextUsername.length < 3 || nextUsername.length > 80) {
      dispatchCustomerToast({ type: "error", message: "Username must be 3 to 80 characters." });
      return;
    }
    const locationError = locationValidationMessage(normalizeDeliveryLocation(draftProfile));
    if (locationError) {
      setProfileLocationError(locationError);
      dispatchCustomerToast({ type: "error", message: locationError });
      return;
    }
    setSavingProfile(true);
    try {
      const saved = await saveProfile(event, { ...draftProfile, username: nextUsername }, profilePhoto);
      if (saved) setEditing(false);
    } catch {
      // saveProfile owns the error toast; keep edit mode open for correction.
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadGovernmentId(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !verification?.id) return;
    const formData = new FormData();
    formData.append("governmentId", file);
    setGovernmentIdUploading(true);
    setVerificationRecovery((value) => ({ ...value, error: "", message: "" }));
    try {
      await api.put(`/identity-verifications/${verification.id}/government-id`, formData);
      await loadVerificationRecovery();
      setVerificationRecovery((value) => ({ ...value, message: "Government ID image re-uploaded." }));
    } catch (error) {
      setVerificationRecovery((value) => ({ ...value, error: error?.response?.data?.message || "Could not re-upload Government ID image." }));
    } finally {
      setGovernmentIdUploading(false);
    }
  }

  async function uploadSelfieCapture() {
    if (!selfieFile || !verification?.id) return;
    const formData = new FormData();
    formData.append("selfie", selfieFile);
    setSelfieUploadBusy(true);
    setVerificationRecovery((value) => ({ ...value, error: "", message: "" }));
    try {
      await api.put(`/identity-verifications/${verification.id}/selfie`, formData);
      setSelfieCaptureOpen(false);
      setSelfieFile(null);
      setSelfiePreview("");
      await loadVerificationRecovery();
      setVerificationRecovery((value) => ({ ...value, message: "Selfie verification image recaptured." }));
    } catch (error) {
      setVerificationRecovery((value) => ({ ...value, error: error?.response?.data?.message || "Could not upload selfie verification image." }));
    } finally {
      setSelfieUploadBusy(false);
    }
  }

  function closeSelfieCapture() {
    setSelfieCaptureOpen(false);
    setSelfieFile(null);
    setSelfiePreview("");
  }

  return (
    <motion.div className="customer-profile-page" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <section className="customer-profile-intro">
        <div>
          <p className="customer-profile-eyebrow">Customer Account</p>
          <h1>Profile</h1>
          <p>Keep your contact details, delivery address, and account security up to date.</p>
        </div>
        <div className="customer-profile-status-grid">
          <ProfileStatusCard icon={ShieldCheck} label="Account" value={accountStatus} tone={profile.status === "approved" ? "success" : "warning"} />
          <ProfileStatusCard icon={CheckCircle2} label="Session" value="Active" tone="success" />
          <ProfileStatusCard icon={CalendarDays} label="Age" value={age === null ? "Not set" : `${age}`} tone="neutral" />
        </div>
      </section>

      <div className="customer-profile-layout">
        <aside className="customer-profile-identity-card">
          <div className="customer-profile-avatar-wrap">
            {photoUrl ? (
              <img src={photoUrl} className="customer-profile-avatar" alt={displayName} />
            ) : (
              <div className="customer-profile-avatar customer-profile-avatar-fallback">{customerProfileInitials(current)}</div>
            )}
            <span className={`customer-profile-status-badge is-${profile.status || "pending"}`}>{accountStatus}</span>
          </div>
          <div className="customer-profile-identity-copy">
            <h2>{displayName}</h2>
            <p>@{username}</p>
            <span>{email}</span>
          </div>
          {editing ? (
            <label className="customer-profile-photo-button">
              <Upload size={16} />
              {profilePhoto ? "Change selected photo" : "Change Photo"}
              <input className="hidden" type="file" accept="image/*" onChange={(event) => setProfilePhoto(event.target.files?.[0] || null)} />
            </label>
          ) : null}
          {editing && profilePhoto ? <p className="customer-profile-photo-name">{profilePhoto.name}</p> : null}
        </aside>

        <div className="customer-profile-main">
          <form id="retela-customer-profile-form" onSubmit={submitProfile} className="customer-profile-info-card">
            <div className="customer-profile-section-heading">
              <div>
                <h3>Personal Information</h3>
                <p>These details are used for your account, orders, and delivery updates.</p>
              </div>
              <div className="customer-profile-actions">
                {!editing ? (
                  <button type="button" className="customer-profile-edit-button" onClick={startEditing}>
                    <Edit3 size={16} /> Edit Profile
                  </button>
                ) : (
                  <>
                    <button type="button" className="customer-profile-cancel-button" onClick={cancelEditing} disabled={savingProfile}>
                      <X size={16} /> Cancel
                    </button>
                    <button type="submit" className="customer-profile-save-button" disabled={savingProfile}>
                      {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {savingProfile ? "Saving..." : "Save Profile"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="customer-profile-info-grid">
              <CustomerProfileField label="Full Name" value={current.display_name || ""} editing={editing} onChange={(value) => updateDraft("display_name", value)} placeholder="Full name" empty="Not set" />
              <CustomerProfileField label="Username" value={current.username || ""} editing={editing} onChange={(value) => updateDraft("username", value)} placeholder="Username" prefix={!editing ? "@" : ""} required />
              <CustomerProfileField label="Email" value={current.email || ""} editing={editing} onChange={(value) => updateDraft("email", value)} placeholder="Email address" type="email" empty="Not set" />
              <CustomerProfileField label="Phone Number" value={current.phone_number || ""} editing={editing} onChange={(value) => updateDraft("phone_number", value)} placeholder="Phone number" empty="Not set" />
              <CustomerProfileField label="Birthday" value={editing ? formatDateInput(current.birthday) : (current.birthday ? formatDate(current.birthday) : "")} editing={editing} onChange={(value) => updateDraft("birthday", value)} type="date" empty="Not set" />
              <CustomerProfileField label="Gender" value={current.gender || ""} editing={editing} onChange={(value) => updateDraft("gender", value)} select options={["Female", "Male", "Non-binary", "Prefer not to say"]} placeholder="Select gender" empty="Not set" />
              {editing ? (
                <div className="customer-profile-field is-wide">
                  <StructuredLocationPicker
                    value={normalizeDeliveryLocation(draftProfile)}
                    onChange={updateDraftLocation}
                    error={profileLocationError}
                    compact
                    label="Complete Address / Location"
                    placeholder="Search street, barangay, municipality..."
                  />
                </div>
              ) : (
                <CustomerProfileField label="Complete Address / Location" value={current.formatted_address || current.location || ""} editing={false} empty="Not set" wide />
              )}
              {!editing && (shippingQuote || shippingQuoteLoading) ? (
                <div className="customer-profile-field is-wide">
                  <span>Current Shipping</span>
                  <strong>{shippingFeeText(shippingQuote, shippingQuoteLoading)}</strong>
                  {formatDistanceKm(shippingQuote?.distanceKm) ? <small>{formatDistanceKm(shippingQuote.distanceKm)} from the shop</small> : null}
                  {shippingQuote?.reason ? <small>{shippingQuote.reason}</small> : null}
                </div>
              ) : null}
            </div>
          </form>

          {(governmentIdMissing || selfieMissing || verificationRecovery.error || verificationRecovery.message) ? (
            <Card>
              <div className="grid gap-4">
                <div>
                  <h3 className="font-display text-xl font-bold text-white">Verification Recovery</h3>
                  <p className="mt-1 text-sm text-white/45">Use this only when a saved verification image is unavailable.</p>
                </div>
                {verificationRecovery.loading ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-white/60"><Loader2 size={16} className="animate-spin" /> Checking verification images</p>
                ) : null}
                {verificationRecovery.error ? <p className="rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm font-bold text-rose-100">{verificationRecovery.error}</p> : null}
                {verificationRecovery.message ? <p className="rounded-2xl border border-neonbrand/20 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand">{verificationRecovery.message}</p> : null}
                <div className="flex flex-wrap gap-3">
                  {governmentIdMissing ? (
                    <button type="button" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neonbrand/30 bg-neonbrand/10 px-4 py-3 text-sm font-bold text-neonbrand transition hover:bg-neonbrand hover:text-black disabled:opacity-60" disabled={governmentIdUploading} onClick={() => governmentIdInputRef.current?.click()}>
                      {governmentIdUploading ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
                      {governmentIdUploading ? "Uploading..." : "Re-upload Government ID"}
                    </button>
                  ) : null}
                  {selfieMissing ? (
                    <Button type="button" onClick={() => setSelfieCaptureOpen(true)}>
                      <CameraIcon /> Recapture Selfie
                    </Button>
                  ) : null}
                </div>
                <input ref={governmentIdInputRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadGovernmentId} />
              </div>
            </Card>
          ) : null}

          <ChangePasswordForm onSuccess={(message) => dispatchCustomerToast({ type: "success", message: message || "Password changed successfully." })} onError={(message) => dispatchCustomerToast({ type: "error", message: message || "Could not change password." })} />

          <section className="customer-account-management-card">
            <div>
              <p className="customer-profile-eyebrow">Account Management</p>
              <h3>Deactivate your account</h3>
              <span>You will be signed out and will need admin help to restore access.</span>
            </div>
            <button type="button" onClick={onDeactivate} disabled={deactivating} className="customer-profile-danger-button">
              {deactivating ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
              Deactivate Account
            </button>
          </section>
        </div>
      </div>
      {selfieCaptureOpen ? createPortal(
        <div className="fixed inset-0 z-[1800] overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-md sm:p-5" role="dialog" aria-modal="true">
          <div className="mx-auto max-w-5xl">
            <FaceVerification
              selfie={selfieFile}
              selfiePreview={selfiePreview}
              captureVerified={Boolean(selfieFile && selfiePreview)}
              onCaptured={(file, preview) => {
                setSelfieFile(file);
                setSelfiePreview(preview);
              }}
              onBack={closeSelfieCapture}
              onNext={uploadSelfieCapture}
            />
            {selfieUploadBusy ? (
              <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[9999] flex w-[calc(100vw-24px)] max-w-xs items-center justify-center gap-2 rounded-2xl border border-neonbrand/20 bg-black/85 px-4 py-3 text-sm font-bold text-neonbrand shadow-2xl sm:right-5 sm:top-5">
                <Loader2 size={17} className="animate-spin" /> Uploading selfie
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      ) : null}
    </motion.div>
  );
}

function CameraIcon() {
  return <FileImage size={17} />;
}

function customerProfileInitials(profile) {
  const source = String(profile?.display_name || profile?.username || "RC").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : source.slice(0, 2);
  return initials.toUpperCase();
}

function CustomerProfileField({ label, value, editing, onChange, placeholder, empty = "Not set", prefix = "", type = "text", select = false, options = [], wide = false, required = false }) {
  const readValue = String(value || "").trim();
  return (
    <label className={`customer-profile-field ${wide ? "is-wide" : ""}`}>
      <span>{label}</span>
      {editing ? (
        select ? (
          <select className="customer-profile-input" value={value || ""} onChange={(event) => onChange(event.target.value)}>
            <option value="">{placeholder || `Select ${label.toLowerCase()}`}</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <input
            className="customer-profile-input"
            type={type}
            required={required}
            minLength={required ? 3 : undefined}
            maxLength={label === "Username" ? 80 : undefined}
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
        )
      ) : (
        <strong className={readValue ? "" : "is-empty"}>{readValue ? `${prefix}${readValue}` : empty}</strong>
      )}
    </label>
  );
}

function ProfileStatusCard({ icon: Icon, label, value, tone = "neutral" }) {
  return (
    <div className={`customer-profile-status-card is-${tone}`}>
      <span><Icon size={15} /> {label}</span>
      <strong>{value}</strong>
    </div>
  );
}
