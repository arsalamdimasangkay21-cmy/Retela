export const CUSTOMER_PRIVATE_NOTIFICATION_TYPES = [
  "approval",
  "order",
  "order_cancelled",
  "payment",
  "message",
  "refund",
  "return",
  "new_product"
];

export const CUSTOMER_PUBLIC_NOTIFICATION_TYPES = ["new_product"];

export const CUSTOMER_SAFE_BROADCAST_TYPES = [
  "new_arrival",
  "new_product_drop",
  "promo_sale",
  "flash_sale",
  "holiday_promo",
  "event_announcement"
];

export const CUSTOMER_BLOCKED_NOTIFICATION_TITLES = [
  "new sale",
  "new sales",
  "sale completed",
  "pos sale completed",
  "low stock alert",
  "out of stock"
];

export const CUSTOMER_BLOCKED_NOTIFICATION_TEXT_PATTERNS = [
  "% sold %",
  "% sold.%",
  "% sold today%",
  "% sold in %",
  "%items sold%",
  "%item sold%",
  "%+% sales%",
  "%new sales%",
  "%sales count%",
  "%sales total%",
  "%sales analytics%",
  "%sales activity%",
  "%revenue%",
  "%low stock%",
  "%out of stock%",
  "%out-of-stock%",
  "%inventory%",
  "%stock adjustment%",
  "%stock management%",
  "%stock warning%",
  "%admin activity%",
  "%admin system%",
  "%internal shop%",
  "%dashboard analytics%",
  "%orders received%"
];

export const CUSTOMER_BLOCKED_NOTIFICATION_TYPES = [
  "inventory",
  "system",
  "low_stock",
  "out_of_stock",
  "stock",
  "stock_alert",
  "product_stock",
  "new_sale",
  "sale",
  "admin"
];

const blockedTextPattern = /\b(?:low stock|out of stock|out-of-stock|inventory|new sales?|sales count|sales total|sales analytics|sales activity|revenue|stock adjustment|stock management|stock warning|admin activity|admin system|internal shop|dashboard analytics|orders received)\b|\b\d+\s+.+\bsold\b|\+\d+\s+sales\b/i;

export function isCustomerSafeBroadcastType(broadcast = {}) {
  const type = String(broadcast.broadcast_type || "").toLowerCase();
  return CUSTOMER_SAFE_BROADCAST_TYPES.includes(type)
    || Boolean(broadcast.sale_enabled)
    || Boolean(String(broadcast.promo_code || "").trim());
}

export function isCustomerSafeNotificationPayload(notification = {}, customerId = null) {
  const type = String(notification.type || "").toLowerCase();
  const text = [notification.title, notification.body, notification.message].map((value) => String(value || "")).join(" ");

  if (CUSTOMER_BLOCKED_NOTIFICATION_TYPES.includes(type)) return false;
  if (CUSTOMER_BLOCKED_NOTIFICATION_TITLES.includes(String(notification.title || "").trim().toLowerCase())) return false;
  if (blockedTextPattern.test(text)) return false;

  if (type === "broadcast") {
    if (customerId && notification.user_id !== undefined && notification.user_id !== null && Number(notification.user_id) !== Number(customerId)) return false;
    return isCustomerSafeBroadcastType(notification.broadcast || notification);
  }

  if (CUSTOMER_PUBLIC_NOTIFICATION_TYPES.includes(type) && (notification.user_id === null || notification.user_id === undefined)) return true;

  if (!CUSTOMER_PRIVATE_NOTIFICATION_TYPES.includes(type)) return false;
  if (!customerId) return Boolean(notification.user_id);
  return Number(notification.user_id) === Number(customerId);
}
