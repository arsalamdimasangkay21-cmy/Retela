import { query } from "../config/db.js";
import { loadSystemSettings } from "./systemSettings.js";
import { calculateShippingQuote, shippingSummary } from "./shippingSettings.js";

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowInRange(start, end) {
  const now = Date.now();
  const startTime = start ? new Date(start).getTime() : 0;
  const endTime = end ? new Date(end).getTime() : 0;
  if (startTime && now < startTime) return false;
  if (endTime && now > endTime) return false;
  return true;
}

export function activeCouponsFromSettings(config) {
  return (config?.payment?.coupons || []).filter((coupon) => {
    if (!coupon?.active) return false;
    if (coupon.expiresAt && Date.now() > new Date(coupon.expiresAt).getTime()) return false;
    return true;
  });
}

export async function getActiveSalePromotions() {
  const rows = await query(
    `SELECT id, title, sale_discount_percent, sale_product_ids_json, sale_starts_at, sale_ends_at
     FROM broadcasts
     WHERE is_deleted = FALSE
       AND status IN ('sent', 'scheduled')
       AND sale_enabled = TRUE
       AND (sale_starts_at IS NULL OR sale_starts_at <= NOW())
       AND (sale_ends_at IS NULL OR sale_ends_at >= NOW())
     ORDER BY sale_discount_percent DESC, updated_at DESC`
  ).catch(() => []);

  return rows
    .filter((row) => nowInRange(row.sale_starts_at, row.sale_ends_at))
    .map((row) => ({
      id: row.id,
      title: row.title,
      discountPercent: Math.max(0, Math.min(100, Number(row.sale_discount_percent || 0))),
      productIds: parseJson(row.sale_product_ids_json, []).map(Number).filter(Boolean)
    }))
    .filter((sale) => sale.discountPercent > 0 && sale.productIds.length);
}

export async function getPromotionSummary() {
  const { config } = await loadSystemSettings();
  const shipping = await shippingSummary();
  return {
    shipping,
    coupons: activeCouponsFromSettings(config).map((coupon) => ({
      code: coupon.code,
      discountPercent: Number(coupon.discountPercent || 0),
      freeShipping: Boolean(coupon.freeShipping),
      expiresAt: coupon.expiresAt || ""
    })),
    sales: await getActiveSalePromotions()
  };
}

export async function calculateCheckoutPricing(items, couponCode = "", fulfillmentMethod = "delivery", options = {}) {
  const [settings, sales, shipping] = await Promise.all([loadSystemSettings(), getActiveSalePromotions(), shippingSummary()]);
  const config = settings.config;
  const coupons = activeCouponsFromSettings(config);
  const normalizedCoupon = String(couponCode || "").trim().toLowerCase();
  const coupon = normalizedCoupon ? coupons.find((item) => item.code.toLowerCase() === normalizedCoupon) : null;

  const productIds = items.map((item) => Number(item.product_id)).filter(Boolean);
  const products = productIds.length
    ? await query(
      `SELECT id, name, category, size, price, stock, status
       FROM products
       WHERE id IN (${productIds.map(() => "?").join(",")})
         AND is_deleted = FALSE`,
      productIds
    )
    : [];
  const productMap = new Map(products.map((product) => [Number(product.id), product]));

  let subtotal = 0;
  let saleDiscount = 0;
  let couponBase = 0;
  const lineItems = items.map((item) => {
    const product = productMap.get(Number(item.product_id));
    if (!product) {
      const error = new Error("Apparel item not found");
      error.status = 404;
      throw error;
    }
    const quantity = Number(item.quantity || 0);
    if (Number(product.stock || 0) < quantity) {
      const error = new Error(`Only ${product.stock} items remaining in stock.`);
      error.status = 400;
      throw error;
    }
    const price = Number(product.price || 0);
    const lineSubtotal = price * quantity;
    const sale = sales.find((promo) => promo.productIds.includes(Number(product.id)));
    const lineSaleDiscount = sale ? lineSubtotal * (sale.discountPercent / 100) : 0;
    subtotal += lineSubtotal;
    saleDiscount += lineSaleDiscount;
    couponBase += Math.max(0, lineSubtotal - lineSaleDiscount);
    return {
      product_id: Number(product.id),
      name: product.name,
      category: product.category,
      size: product.size,
      quantity,
      price,
      subtotal: lineSubtotal,
      saleDiscount: lineSaleDiscount,
      saleDiscountPercent: sale?.discountPercent || 0,
      status: product.status
    };
  });

  const couponDiscount = coupon ? couponBase * (Number(coupon.discountPercent || 0) / 100) : 0;
  const shippingQuote = await calculateShippingQuote(options.location || {}, {
    fulfillmentMethod,
    couponFreeShipping: Boolean(coupon?.freeShipping)
  });
  const shippingFee = Number(shippingQuote.shippingFee || 0);
  const total = Math.max(0, subtotal - saleDiscount - couponDiscount + shippingFee);

  return {
    items: lineItems,
    subtotal,
    saleDiscount,
    couponDiscount,
    shippingFee,
    shippingZone: shippingQuote.shippingZone,
    shippingDistanceKm: shippingQuote.distanceKm,
    shippingRule: shippingQuote.shippingRule,
    shippingReason: shippingQuote.reason,
    shippingRateName: shipping.name,
    total,
    coupon: coupon ? {
      code: coupon.code,
      discountPercent: Number(coupon.discountPercent || 0),
      freeShipping: Boolean(coupon.freeShipping)
    } : null,
    couponValid: normalizedCoupon ? Boolean(coupon) : null
  };
}
