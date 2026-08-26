const deliveredStatuses = new Set(["delivered", "completed"]);
const unpaidStatuses = new Set(["pending", "awaiting_payment", "failed", "expired", "cancelled", "canceled"]);

export function normalizeFeedbackStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Feedback is available only after fulfilment is delivered/completed. Online
 * orders must also have a successful payment; COD keeps the existing local
 * completion flow intact.
 */
export function canLeaveFeedback(order) {
  const status = normalizeFeedbackStatus(order?.status || order?.order_status || order?.delivery_status);
  if (!deliveredStatuses.has(status)) return false;
  const method = normalizeFeedbackStatus(order?.payment_method);
  const paymentStatus = normalizeFeedbackStatus(order?.payment_status);
  const isCod = method === "cod" || method === "cash_on_delivery" || method === "cash_on_delivery_local";
  return isCod || !unpaidStatuses.has(paymentStatus);
}

export function feedbackStatusLabel(order) {
  const status = normalizeFeedbackStatus(order?.status || order?.order_status || order?.delivery_status);
  if (status === "awaiting_payment") return "Awaiting Payment";
  if (status === "out_for_delivery") return "Out for Delivery";
  if (status === "under_review") return "Under Review";
  if (!status) return "Pending";
  return status.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function feedbackImageList(record) {
  const values = Array.isArray(record?.images)
    ? record.images
    : Array.isArray(record?.image_urls)
      ? record.image_urls
      : record?.image_url
        ? [record.image_url]
        : [];
  return values.filter(Boolean).map(String);
}
