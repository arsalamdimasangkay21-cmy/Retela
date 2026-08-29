export const ORDER_STATUS_LABELS = {
  pending: "Pending",
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  approved: "Accepted",
  processing: "Processing",
  ready: "Out for Delivery",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  delivered: "Delivered",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  payment_failed: "Payment Failed",
  rejected: "Rejected",
  returned: "Returned",
  refunded: "Refunded"
};

export function normalizeOrderStatusKey(status) {
  return String(status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizePaymentMethodKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isCodPaymentMethod(orderOrMethod) {
  const rawMethod = orderOrMethod && typeof orderOrMethod === "object"
    ? orderOrMethod.payment_method
      ?? orderOrMethod.paymentMethod
      ?? orderOrMethod.payment_label
      ?? orderOrMethod.paymentLabel
      ?? orderOrMethod.payment
      ?? ""
    : orderOrMethod;
  const normalized = normalizePaymentMethodKey(rawMethod);
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return ["cod", "cash", "cashondelivery", "cashupondelivery", "payondelivery", "paymentondelivery"].includes(compact)
    || (normalized.includes("cash") && normalized.includes("delivery"));
}

export function normalizePaymentStatusKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function hasFailedOnlinePayment(order) {
  if (!order || isCodPaymentMethod(order)) return false;
  const status = normalizePaymentStatusKey(order.payment_status ?? order.paymentStatus);
  return ["failed", "payment failed", "unpaid", "cancelled", "canceled", "expired"].includes(status);
}

export function canonicalOrderStatus(orderOrStatus) {
  const isOrder = orderOrStatus && typeof orderOrStatus === "object";
  const status = normalizeOrderStatusKey(isOrder ? orderOrStatus.status : orderOrStatus);
  if (status === "rejected") return "rejected";
  if (isOrder && hasFailedOnlinePayment(orderOrStatus)) return "payment_failed";
  if (status === "paid" && (!isOrder || normalizePaymentStatusKey(orderOrStatus.payment_status ?? orderOrStatus.paymentStatus) === "paid")) return "pending";
  if (status === "accepted") return "approved";
  if (status === "out_for_delivery") return "ready";
  return status || "pending";
}

export function paymentStatusLabel(status) {
  const normalized = normalizeOrderStatusKey(status);
  const labels = {
    paid: "Paid",
    awaiting_payment: "Awaiting Payment",
    failed: "Payment Failed",
    payment_failed: "Payment Failed",
    expired: "Payment Failed",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    refunded: "Refunded",
    unpaid: "Unpaid"
  };
  return labels[normalized] || "Unpaid";
}

export function orderStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
  return ORDER_STATUS_LABELS[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, " ") : "Pending");
}
