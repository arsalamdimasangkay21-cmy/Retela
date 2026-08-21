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
  returned: "Returned",
  refunded: "Refunded"
};

export function orderStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
  return ORDER_STATUS_LABELS[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, " ") : "Pending");
}
