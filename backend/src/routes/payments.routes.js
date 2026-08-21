import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth } from "../middleware/auth.js";
import { createAdminNotification } from "../utils/adminNotifications.js";

const router = Router();
let paymentColumnsReady;
const PAYMONGO_CHECKOUT_URL = "https://api.paymongo.com/v2/checkout_sessions";
const PAYMONGO_CHECKOUT_URL_V1 = "https://api.paymongo.com/v1/checkout_sessions";
const PAYMONGO_GCASH_PAYMENT_METHOD_TYPES = Object.freeze(["gcash"]);
const PAYMONGO_QRPH_TYPE = "qrph";
const PAYMONGO_QRPH_EXPIRY_MINUTES = 30;
const PAYMONGO_CHECKOUT_METHOD_TYPES = Object.freeze({
  gcash: PAYMONGO_GCASH_PAYMENT_METHOD_TYPES,
  debit: Object.freeze(["card"]),
  credit: Object.freeze(["card"]),
  maya: Object.freeze(["paymaya"])
});

async function ensurePaymentColumns() {
  paymentColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME IN ('payment_status', 'payment_reference', 'transaction_id', 'paid_at', 'payment_provider', 'checkout_session_id', 'checkout_url', 'payment_intent_id', 'payment_method_id', 'qr_code_url', 'payment_expires_at')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    await safeModifyColumn("orders", "status", "status enum update", "ALTER TABLE orders MODIFY status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed') NOT NULL DEFAULT 'pending'");
    await safeModifyColumn("orders", "payment_method", "payment_method enum update", "ALTER TABLE orders MODIFY payment_method ENUM('cod','cash','gcash','qrph','debit','credit','maya') NOT NULL DEFAULT 'cod'");
    if (!columns.has("payment_status")) await query("ALTER TABLE orders ADD COLUMN payment_status ENUM('unpaid','awaiting_payment','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'unpaid' AFTER payment_method");
    if (!columns.has("payment_reference")) await query("ALTER TABLE orders ADD COLUMN payment_reference VARCHAR(160) NULL AFTER payment_status");
    if (!columns.has("transaction_id")) await query("ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(160) NULL AFTER payment_reference");
    if (!columns.has("paid_at")) await query("ALTER TABLE orders ADD COLUMN paid_at DATETIME NULL AFTER transaction_id");
    if (!columns.has("payment_provider")) await query("ALTER TABLE orders ADD COLUMN payment_provider VARCHAR(40) NULL AFTER paid_at");
    if (!columns.has("checkout_session_id")) await query("ALTER TABLE orders ADD COLUMN checkout_session_id VARCHAR(160) NULL AFTER payment_provider");
    if (!columns.has("checkout_url")) await query("ALTER TABLE orders ADD COLUMN checkout_url TEXT NULL AFTER checkout_session_id");
    if (!columns.has("payment_intent_id")) await query("ALTER TABLE orders ADD COLUMN payment_intent_id VARCHAR(160) NULL AFTER checkout_session_id");
    if (!columns.has("payment_method_id")) await query("ALTER TABLE orders ADD COLUMN payment_method_id VARCHAR(160) NULL AFTER payment_intent_id");
    if (!columns.has("qr_code_url")) await query("ALTER TABLE orders ADD COLUMN qr_code_url LONGTEXT NULL AFTER checkout_url");
    if (!columns.has("payment_expires_at")) await query("ALTER TABLE orders ADD COLUMN payment_expires_at DATETIME NULL AFTER qr_code_url");
  })().catch((error) => {
    paymentColumnsReady = undefined;
    throw error;
  });
  return paymentColumnsReady;
}

function paymongoSecret() {
  const key = process.env.PAYMONGO_SECRET_KEY || "";
  if (!key) throw new HttpError(503, "PayMongo configuration missing. Contact administrator.");
  if (key.startsWith("pk_")) {
    console.error("[paymongo config] PAYMONGO_SECRET_KEY contains a public key. Use an sk_test_ or sk_live_ secret key on the backend.");
    throw new HttpError(503, "PayMongo configuration invalid. Contact administrator.");
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_") && !globalThis.__RETELA_PAYMONGO_KEY_FORMAT_WARNING__) {
    globalThis.__RETELA_PAYMONGO_KEY_FORMAT_WARNING__ = true;
    console.warn("[paymongo config] PAYMONGO_SECRET_KEY does not look like a PayMongo secret key.");
  }
  const configuredMode = String(process.env.PAYMONGO_MODE || "").trim().toLowerCase();
  const actualMode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
  if (["live", "test"].includes(configuredMode) && actualMode !== configuredMode) {
    console.error("[paymongo config] PAYMONGO_MODE does not match PAYMONGO_SECRET_KEY prefix.", { configuredMode, actualMode });
    throw new HttpError(503, "PayMongo mode and secret key do not match. Contact administrator.");
  }
  return key;
}

function assertPaymongoConfigured() {
  paymongoSecret();
}

function clientUrl(path) {
  const base = (process.env.CLIENT_URL || "https://retela.shop").split(",")[0].trim().replace(/\/$/, "");
  const url = `${base}${path}`;
  try {
    return new URL(url).toString();
  } catch {
    console.error("[paymongo config] CLIENT_URL produced an invalid PayMongo redirect URL.", {
      configured: Boolean(process.env.CLIENT_URL),
      path
    });
    throw new HttpError(503, "Payment redirect URL is not configured correctly. Contact administrator.");
  }
}

function authHeader() {
  return `Basic ${Buffer.from(`${paymongoSecret()}:`).toString("base64")}`;
}

function paymongoFetchHeaders() {
  return {
    Authorization: authHeader(),
    "Content-Type": "application/json"
  };
}

function paymongoApiUrl(path) {
  return `https://api.paymongo.com/v1${path}`;
}

function paymongoProviderError(data, fallback) {
  const details = paymongoErrorDetails(data);
  console.error("[paymongo] provider error", { code: details.code, detail: details.detail });
  return new HttpError(502, details.detail || fallback);
}

function dateAfterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function qrImageFromIntent(intent) {
  const nextAction = intent?.data?.attributes?.next_action || intent?.attributes?.next_action || {};
  return nextAction?.code?.image_url || nextAction?.qr_code?.image_url || nextAction?.image_url || null;
}

function qrExpiryFromIntent(intent) {
  const attributes = intent?.data?.attributes || intent?.attributes || {};
  const nextAction = attributes.next_action || {};
  const value = nextAction?.code?.expires_at || nextAction?.expires_at || attributes.expires_at;
  if (value) {
    const date = new Date(typeof value === "number" ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return dateAfterMinutes(PAYMONGO_QRPH_EXPIRY_MINUTES);
}

function paymongoResource(payload) {
  const event = payload?.data;
  if (event?.type === "event") return event.attributes?.data || {};
  return event?.type ? event : event?.data?.type ? event.data : event || payload;
}

function resourceId(value) {
  return typeof value === "string" ? value : value?.id || null;
}

function paymentIntentIdFromResource(resource) {
  const attributes = resource?.attributes || {};
  return resource?.type === "payment_intent" ? resource.id : resourceId(attributes.payment_intent);
}

function orderIdFromResource(resource) {
  const metadataId = Number(resource?.attributes?.metadata?.order_id || 0);
  if (Number.isInteger(metadataId) && metadataId > 0) return metadataId;
  return orderIdFromReference(resource?.attributes?.reference_number || resource?.attributes?.description);
}

function paymongoErrorDetails(data) {
  const error = data?.errors?.[0] || {};
  return {
    code: error.code || null,
    detail: error.detail || error.message || null
  };
}

function checkoutPaymentMethodTypes(method) {
  const normalizedMethod = String(method || "gcash").toLowerCase();
  const paymentMethodTypes = PAYMONGO_CHECKOUT_METHOD_TYPES[normalizedMethod];
  if (!paymentMethodTypes) {
    throw new HttpError(400, "This online payment method is not available.");
  }
  if (!Array.isArray(paymentMethodTypes) || paymentMethodTypes.length === 0) {
    console.error("[paymongo config] PayMongo checkout payment_method_types is empty.", {
      requestedPaymentMethod: normalizedMethod
    });
    throw new HttpError(503, "PayMongo payment methods are not configured. Contact administrator.");
  }
  return [...paymentMethodTypes];
}

function safeUrlSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid_url";
  }
}

function buildCheckoutPayload({ orderId, reference, billing, amount, paymentMethodTypes, successUrl, cancelUrl }) {
  return {
    data: {
      attributes: {
        billing,
        description: `RETELA Order #${orderId}`,
        line_items: [{
          currency: "PHP",
          amount,
          name: `RETELA Order #${orderId}`,
          quantity: 1
        }],
        payment_method_types: paymentMethodTypes,
        reference_number: reference,
        metadata: {
          order_id: String(orderId),
          order_number: `RETELA-${orderId}`
        },
        success_url: successUrl,
        cancel_url: cancelUrl
      }
    }
  };
}

function logPaymongoCheckoutResponse(data) {
  const attributes = data?.data?.attributes || {};
  console.log("[PAYMONGO CHECKOUT]", {
    sessionId: data?.data?.id || null,
    livemode: attributes.livemode,
    paymentMethodTypes: attributes.payment_method_types,
    paymentMethodAllowed: attributes.payment_intent?.attributes?.payment_method_allowed,
    checkoutUrlExists: Boolean(attributes.checkout_url)
  });
}

async function fetchPaymongoCheckoutSession(sessionId) {
  if (!sessionId) throw new HttpError(409, "No PayMongo checkout session is stored for this order.");
  const urls = [
    `${PAYMONGO_CHECKOUT_URL}/${encodeURIComponent(sessionId)}`,
    `${PAYMONGO_CHECKOUT_URL_V1}/${encodeURIComponent(sessionId)}`
  ];
  let lastProviderError = null;
  for (const url of urls) {
    const response = await fetch(url, {
      method: "GET",
      headers: paymongoFetchHeaders()
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    lastProviderError = { status: response.status, data };
    if (response.status !== 404) break;
  }
  const providerError = paymongoErrorDetails(lastProviderError?.data);
  console.error("[paymongo-verify] checkout session retrieve failed", {
    sessionId,
    status: lastProviderError?.status || null,
    detail: providerError.detail,
    code: providerError.code
  });
  throw new HttpError(502, providerError.detail || "Unable to verify payment with PayMongo.");
}

function checkoutSessionFromPaymongoPayload(payload) {
  return payload?.data?.type === "checkout_session"
    ? payload.data
    : payload?.data?.data?.type === "checkout_session"
      ? payload.data.data
      : payload?.data?.attributes?.data?.type === "checkout_session"
        ? payload.data.attributes.data
        : payload?.data?.attributes?.data || payload?.data?.data || payload?.data || null;
}

function checkoutSessionAttributes(session) {
  return session?.attributes || {};
}

function successfulPaymentFromSession(session) {
  const attributes = checkoutSessionAttributes(session);
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  return payments.find((payment) => {
    const status = String(payment?.attributes?.status || payment?.status || "").toLowerCase();
    return status === "paid" || status === "succeeded" || status === "success";
  }) || null;
}

function paymentIntentFromSession(session) {
  return checkoutSessionAttributes(session).payment_intent || null;
}

function isSessionPaymentConfirmed(session) {
  const attributes = checkoutSessionAttributes(session);
  const sessionStatus = String(attributes.status || "").toLowerCase();
  const intentStatus = String(paymentIntentFromSession(session)?.attributes?.status || paymentIntentFromSession(session)?.status || "").toLowerCase();
  return Boolean(successfulPaymentFromSession(session))
    || sessionStatus === "paid"
    || intentStatus === "succeeded"
    || intentStatus === "paid";
}

function failedPaymentFromSession(session) {
  const attributes = checkoutSessionAttributes(session);
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  return payments.find((payment) => {
    const status = String(payment?.attributes?.status || payment?.status || "").toLowerCase();
    return ["failed", "cancelled", "canceled", "expired"].includes(status);
  }) || null;
}

function paymongoSessionSummary(session) {
  const attributes = checkoutSessionAttributes(session);
  const payment = successfulPaymentFromSession(session) || failedPaymentFromSession(session);
  const intent = paymentIntentFromSession(session);
  return {
    sessionId: session?.id || null,
    sessionStatus: attributes.status || null,
    paymentStatus: payment?.attributes?.status || payment?.status || intent?.attributes?.status || intent?.status || null,
    paymentId: payment?.id || null,
    paymentIntentId: intent?.id || null,
    reference: referenceFromSession(session),
    orderId: orderIdFromSession(session)
  };
}

function orderIdFromReference(reference) {
  const match = String(reference || "").match(/RETELA-(\d+)|#(\d+)/);
  return match ? Number(match[1] || match[2]) : null;
}

function orderIdFromSession(session) {
  const attributes = checkoutSessionAttributes(session);
  const metadataId = attributes.metadata?.order_id ? Number(attributes.metadata.order_id) : null;
  if (Number.isInteger(metadataId) && metadataId > 0) return metadataId;
  return orderIdFromReference(attributes.reference_number || attributes.external_reference_number || attributes.description);
}

function referenceFromSession(session) {
  const attributes = checkoutSessionAttributes(session);
  return attributes.reference_number || attributes.external_reference_number || attributes.description || null;
}

function transactionIdFromSession(session, fallback = null) {
  const summary = paymongoSessionSummary(session);
  return summary.paymentId || summary.paymentIntentId || summary.sessionId || fallback || null;
}

function emitPaymentFailureUpdate(io, order) {
  if (!order) return;
  const payload = {
    id: Number(order.id),
    status: "payment_failed",
    payment_status: "failed",
    payment_reference: order.payment_reference || null,
    transaction_id: order.transaction_id || null
  };
  if (order.user_id) io?.to(`user:${order.user_id}`).emit("order:update", payload);
  io?.to("admin").emit("order:update", payload);
}

async function markOrderFailed({ orderId, transactionId, reference, io = null }) {
  const rows = await query("SELECT id, user_id, status, payment_status, payment_reference, transaction_id FROM orders WHERE id = :orderId", { orderId });
  if (!rows.length || rows[0].payment_status === "paid") return;
  if (rows[0].status === "cancelled" || rows[0].payment_status === "cancelled") return;
  await query(
    `UPDATE orders
     SET status = 'payment_failed',
         payment_status = 'failed',
         transaction_id = COALESCE(:transactionId, transaction_id),
         payment_reference = COALESCE(:reference, payment_reference),
         payment_provider = 'paymongo'
     WHERE id = :orderId`,
    { orderId, transactionId: transactionId || null, reference: reference || null }
  );
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', 'Payment failed', :body)",
    { userId: rows[0].user_id, body: `Payment for Order #${orderId} failed or was cancelled.` }
  );
  emitPaymentFailureUpdate(io, rows[0]);
}

function paymongoEventResource(payload) {
  return payload?.data?.attributes?.data || payload?.data?.data || payload?.data || payload || null;
}

function isPaymongoCheckoutSessionResource(resource) {
  return resource?.type === "checkout_session" || String(resource?.id || "").startsWith("cs_");
}

function sessionForWebhookPayload(payload) {
  const resource = paymongoEventResource(payload);
  if (isPaymongoCheckoutSessionResource(resource)) return resource;
  return checkoutSessionFromPaymongoPayload(payload);
}

function eventTypeFromPayload(payload) {
  const dataType = payload?.data?.type;
  const attributeType = payload?.data?.attributes?.type;
  if (dataType === "event") return attributeType || payload?.type || payload?.event_type;
  return dataType || attributeType || payload?.type || payload?.event_type;
}

function statusLooksFailed(value) {
  return /failed|cancelled|canceled|expired/i.test(String(value || ""));
}

function statusLooksPaid(value) {
  return /checkout_session\.payment\.paid|payment\.paid|\bpaid\b/i.test(String(value || ""));
}

function paymongoMode() {
  const key = process.env.PAYMONGO_SECRET_KEY || "";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return key ? "unknown" : "missing";
}

function assertTestModeIfRequested() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "test") return;
  if (String(process.env.PAYMONGO_EXPECT_TEST_MODE || "").toLowerCase() === "true" && paymongoMode() !== "test") {
    console.warn("[paymongo config] PayMongo test mode expected, but backend secret key is not sk_test_.");
  }
}

function isSessionPaymentFailed(session) {
  const attributes = checkoutSessionAttributes(session);
  const sessionStatus = String(attributes.status || "").toLowerCase();
  const intent = paymentIntentFromSession(session);
  const intentStatus = String(intent?.attributes?.status || intent?.status || "").toLowerCase();
  return Boolean(failedPaymentFromSession(session)) || ["failed", "cancelled", "canceled", "expired"].includes(sessionStatus) || ["failed", "cancelled", "canceled", "expired"].includes(intentStatus);
}

function paymentStateLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "awaiting_payment") return "Awaiting Payment";
  if (normalized === "paid") return "Paid";
  if (normalized === "failed") return "Payment Failed";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "refunded") return "Refunded";
  if (normalized === "unpaid") return "Unpaid";
  return status || "Unknown";
}

function paymentStatusResponse(order, extras = {}) {
  return {
    ...extras,
    order,
    ...(order ? {
      id: order.id,
      status: order.status,
      payment_status: order.payment_status,
      payment_status_label: paymentStateLabel(order.payment_status),
      payment_method: order.payment_method,
      payment_reference: order.payment_reference,
      transaction_id: order.transaction_id,
      paid_at: order.paid_at,
      payment_provider: order.payment_provider,
      total_amount: order.total_amount,
      payment_intent_id: order.payment_intent_id || null,
      qr_image: order.qr_code_url || null,
      payment_expires_at: order.payment_expires_at || null
    } : {})
  };
}

async function paymongoRequest(path, body = null, method = "POST") {
  let response;
  try {
    response = await fetch(paymongoApiUrl(path), {
      method,
      headers: paymongoFetchHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    console.error("[paymongo] request failed", { path, message: error?.message || null, code: error?.code || null });
    throw new HttpError(502, "Unable to reach PayMongo. Please try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw paymongoProviderError(data, "PayMongo could not process this payment.");
  return data;
}

function qrPaymentResponse(order, extras = {}) {
  return paymentStatusResponse(order, {
    ...extras,
    paymentIntentId: order?.payment_intent_id || extras.paymentIntentId || null,
    qrImage: order?.qr_code_url || extras.qrImage || null,
    expiresAt: order?.payment_expires_at || extras.expiresAt || null
  });
}

async function findOrderForPaymongo({ orderId, checkoutSessionId, paymentIntentId, reference, userId = null, isAdmin = false }) {
  const ownership = isAdmin ? "" : "AND user_id = :userId";
  if (orderId) {
    const rows = await query(
      `SELECT id, user_id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, checkout_session_id, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
       FROM orders
       WHERE id = :orderId ${ownership}
       LIMIT 1`,
      { orderId, userId }
    );
    if (rows.length) return rows[0];
  }
  if (checkoutSessionId) {
    const rows = await query(
      `SELECT id, user_id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, checkout_session_id, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
       FROM orders
       WHERE checkout_session_id = :checkoutSessionId ${ownership}
       LIMIT 1`,
      { checkoutSessionId, userId }
    );
    if (rows.length) return rows[0];
  }
  if (paymentIntentId) {
    const rows = await query(
      `SELECT id, user_id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, checkout_session_id, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
       FROM orders
       WHERE payment_intent_id = :paymentIntentId ${ownership}
       LIMIT 1`,
      { paymentIntentId, userId }
    );
    if (rows.length) return rows[0];
  }
  if (reference) {
    const rows = await query(
      `SELECT id, user_id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, checkout_session_id, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
       FROM orders
       WHERE payment_reference = :reference ${ownership}
       LIMIT 1`,
      { reference, userId }
    );
    if (rows.length) return rows[0];
  }
  return null;
}

function emitPaymentOrderUpdate(io, order) {
  if (!order) return;
  const payload = {
    id: Number(order.id),
    status: order.status,
    payment_status: order.payment_status,
    payment_reference: order.payment_reference || null,
    transaction_id: order.transaction_id || null,
    paid_at: order.paid_at || null
  };
  if (order.user_id) io?.to(`user:${order.user_id}`).emit("order:update", payload);
  io?.to("admin").emit("order:update", payload);
}

async function getOrderPaymentStatus(orderId) {
  const rows = await query(
    `SELECT id, user_id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, checkout_session_id, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
     FROM orders
     WHERE id = :orderId
     LIMIT 1`,
    { orderId }
  );
  return rows[0] || null;
}

function paymentIntentStatus(payload) {
  const attributes = payload?.data?.attributes || payload?.attributes || {};
  return String(attributes.status || "").toLowerCase();
}

async function verifyQrPaymentIntent(order, io) {
  if (!order?.payment_intent_id) return { order, providerStatus: null, expired: true };
  const intent = await paymongoRequest(`/payment_intents/${encodeURIComponent(order.payment_intent_id)}`, null, "GET");
  const providerStatus = paymentIntentStatus(intent);
  console.log("[paymongo-qrph] intent status", { orderId: order.id, status: providerStatus || null });
  if (["succeeded", "paid"].includes(providerStatus)) {
    const result = await markOrderPaid({
      orderId: order.id,
      transactionId: order.payment_intent_id,
      reference: order.payment_reference,
      paymentIntentId: order.payment_intent_id,
      io
    });
    if (result.adminNotification) io?.to("admin").emit("notification:new", { ...result.adminNotification, created_at: new Date().toISOString() });
    return { order: result.order, providerStatus, confirmed: true, expired: false };
  }
  if (["failed", "cancelled", "canceled"].includes(providerStatus)) {
    await markOrderFailed({ orderId: order.id, transactionId: order.payment_intent_id, reference: order.payment_reference, io });
  }
  const latest = await getOrderPaymentStatus(order.id);
  const expiresAt = latest?.payment_expires_at ? new Date(latest.payment_expires_at) : null;
  return { order: latest, providerStatus, confirmed: false, expired: Boolean(expiresAt && expiresAt <= new Date()) };
}

function verifyWebhookSignature(req) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[paymongo-webhook] PAYMONGO_WEBHOOK_SECRET is not configured.");
    return false;
  }
  const header = req.headers["paymongo-signature"] || req.headers["Paymongo-Signature"];
  if (!header || !Buffer.isBuffer(req.body)) return false;
  const parts = Object.fromEntries(String(header).split(",").map((part) => part.split("=").map((value) => value.trim())));
  const timestamp = parts.t;
  const signature = parts.v1 || parts.li || parts.te;
  if (!timestamp || !signature) return false;
  const payload = `${timestamp}.${req.body.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function markOrderPaid({ orderId, transactionId, reference, checkoutSessionId, paymentIntentId, io = null }) {
  const rows = await query("SELECT id, user_id, status, payment_status FROM orders WHERE id = :orderId", { orderId });
  if (!rows.length) return { order: null, adminNotification: null, updated: false };
  if (rows[0].payment_status === "paid") {
    const order = await getOrderPaymentStatus(orderId);
    return { order, adminNotification: null, updated: false };
  }
  if (rows[0].status === "cancelled" || rows[0].payment_status === "cancelled") {
    const order = await getOrderPaymentStatus(orderId);
    return { order, adminNotification: null, updated: false };
  }
  await query(
    `UPDATE orders
     SET status = CASE
           WHEN status IN ('awaiting_payment', 'payment_failed') THEN 'pending'
           ELSE status
         END,
         payment_status = 'paid',
         transaction_id = COALESCE(:transactionId, transaction_id),
         payment_reference = COALESCE(:reference, payment_reference),
         paid_at = NOW(),
         payment_provider = 'paymongo',
         checkout_session_id = COALESCE(:checkoutSessionId, checkout_session_id),
         payment_intent_id = COALESCE(:paymentIntentId, payment_intent_id)
     WHERE id = :orderId`,
    { orderId, transactionId: transactionId || null, reference: reference || null, checkoutSessionId: checkoutSessionId || null, paymentIntentId: paymentIntentId || null }
  );
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', 'Payment received', :body)",
    { userId: rows[0].user_id, body: `Payment for Order #${orderId} was confirmed.` }
  );
  const adminNotification = await createAdminNotification({
    type: "payment",
    title: "Payment received",
    body: `Payment for Order #${orderId} was confirmed.`,
    customerId: rows[0].user_id,
    emit: false
  });
  const order = await getOrderPaymentStatus(orderId);
  emitPaymentOrderUpdate(io, order);
  return { order, adminNotification, updated: true };
}

router.post("/paymongo/qrph/create", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  assertPaymongoConfigured();
  const { orderId } = z.object({ orderId: z.coerce.number().int().positive() }).parse(req.body);
  const rows = await query(
    `SELECT id, user_id, total_amount, status, payment_status, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at
     FROM orders WHERE id = :orderId AND user_id = :userId LIMIT 1`,
    { orderId, userId: req.user.id }
  );
  if (!rows.length) throw new HttpError(404, "Order not found");
  const order = rows[0];
  if (["cancelled", "rejected"].includes(String(order.status || "").toLowerCase()) || order.payment_status === "cancelled") throw new HttpError(409, "This order cannot be paid.");
  if (order.payment_status === "paid") throw new HttpError(400, "This order is already paid.");

  const existingExpiry = order.payment_expires_at ? new Date(order.payment_expires_at) : null;
  if (order.payment_intent_id && order.qr_code_url && existingExpiry && existingExpiry > new Date()) {
    console.log("[paymongo-qrph] reusing active QR", { orderId: order.id });
    return res.json(qrPaymentResponse(order, { orderId: order.id, amount: Number(order.total_amount) }));
  }

  const amount = Math.round(Number(order.total_amount) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "Invalid order amount for QR payment.");
  const reference = `RETELA-${order.id}-${Date.now()}`;
  console.log("[paymongo-qrph] creating intent", { orderId: order.id, amount, currency: "PHP" });
  const intent = await paymongoRequest("/payment_intents", {
    data: { attributes: {
      amount,
      currency: "PHP",
      payment_method_allowed: [PAYMONGO_QRPH_TYPE],
      description: `RETELA Order #${order.id}`,
      metadata: { order_id: String(order.id), order_number: `RETELA-${order.id}`, reference }
    } }
  });
  const intentId = intent?.data?.id;
  const clientKey = intent?.data?.attributes?.client_key;
  if (!intentId || !clientKey) throw new HttpError(502, "PayMongo did not return a usable QR payment intent.");
  console.log("[paymongo-qrph] intent created", { orderId: order.id, paymentIntentId: intentId });

  const paymentMethod = await paymongoRequest("/payment_methods", {
    data: { attributes: { type: PAYMONGO_QRPH_TYPE } }
  });
  const paymentMethodId = paymentMethod?.data?.id;
  if (!paymentMethodId) throw new HttpError(502, "PayMongo did not return a QR payment method.");
  const attached = await paymongoRequest(`/payment_intents/${encodeURIComponent(intentId)}/attach`, {
    data: { attributes: { payment_method: paymentMethodId, client_key: clientKey } }
  });
  const qrImage = qrImageFromIntent(attached);
  if (!qrImage) {
    console.error("[paymongo-qrph] QR image missing", { orderId: order.id, paymentIntentId: intentId });
    throw new HttpError(502, "PayMongo did not return a QR image. Please try again.");
  }
  const expiresAt = qrExpiryFromIntent(attached);
  await query(
    `UPDATE orders
     SET status = 'awaiting_payment', payment_status = 'awaiting_payment', payment_method = 'qrph',
         payment_reference = :reference, payment_provider = 'paymongo', payment_intent_id = :intentId,
         payment_method_id = :methodId, qr_code_url = :qrImage, payment_expires_at = :expiresAt,
         checkout_session_id = NULL, checkout_url = NULL
     WHERE id = :orderId`,
    { orderId: order.id, reference, intentId, methodId: paymentMethodId, qrImage, expiresAt }
  );
  console.log("[paymongo-qrph] QR attached", { orderId: order.id, paymentIntentId: intentId });
  const saved = await getOrderPaymentStatus(order.id);
  res.json(qrPaymentResponse(saved, { orderId: order.id, amount: Number(order.total_amount) }));
}));

router.post("/create-gcash-checkout", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  assertPaymongoConfigured();
  assertTestModeIfRequested();
  const schema = z.object({
    orderId: z.coerce.number().int().positive(),
    paymentMethod: z.enum(["gcash", "debit", "credit", "maya"]).default("gcash"),
    billingPhone: z.string().trim().regex(/^[0-9+\-\s()]{7,30}$/).optional().or(z.literal(""))
  });
  const input = schema.parse(req.body);
  console.log("GCash endpoint reached", {
    orderId: input.orderId,
    paymentMethod: input.paymentMethod,
    hasBillingPhone: Boolean(input.billingPhone)
  });
  const orders = await query(
    `SELECT o.id, o.user_id, o.total_amount, o.status, o.payment_status, o.checkout_url,
       u.username, u.display_name, u.email, u.phone_number
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.id = :id AND o.user_id = :userId`,
    { id: input.orderId, userId: req.user.id }
  );
  if (!orders.length) throw new HttpError(404, "Order not found");
  const order = orders[0];
  if (order.status === "cancelled" || order.payment_status === "cancelled") {
    throw new HttpError(409, "This order has been cancelled and can no longer be paid.");
  }
  if (order.payment_status === "paid") throw new HttpError(400, "This order is already paid.");

  const reference = `RETELA-${order.id}-${Date.now()}`;
  const amount = Math.round(Number(order.total_amount) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new HttpError(400, "Invalid order amount for online payment.");
  }
  const paymentMethodTypes = checkoutPaymentMethodTypes(input.paymentMethod);
  const successUrl = clientUrl(`/payment/success?order=${order.id}&ref=${reference}`);
  const cancelUrl = clientUrl(`/payment/cancel?order=${order.id}&ref=${reference}`);
  const billingPhone = input.billingPhone || order.phone_number || "";
  const billing = {
    name: order.display_name || order.username || req.user.username,
    ...(order.email ? { email: order.email } : {}),
    ...(billingPhone ? { phone: billingPhone } : {})
  };
  console.log("Creating PayMongo checkout", {
    orderId: order.id,
    requestedPaymentMethod: input.paymentMethod,
    paymentMethodTypes,
    provider: "paymongo",
    amount,
    currency: "PHP",
    successUrl: safeUrlSummary(successUrl),
    cancelUrl: safeUrlSummary(cancelUrl)
  });
  const checkoutPayload = buildCheckoutPayload({
    orderId: order.id,
    reference,
    billing,
    amount,
    paymentMethodTypes,
    successUrl,
    cancelUrl
  });
  let response;
  let data;
  try {
    response = await fetch(PAYMONGO_CHECKOUT_URL, {
      method: "POST",
      headers: paymongoFetchHeaders(),
      body: JSON.stringify(checkoutPayload)
    });
    data = await response.json().catch(() => ({}));
    if (response.ok) logPaymongoCheckoutResponse(data);
  } catch (error) {
    console.error("PayMongo checkout error:", {
      provider: "paymongo",
      message: error.message,
      code: error.code || null
    });
    throw new HttpError(502, "Unable to create online payment.");
  }
  console.log("Payment provider status:", {
    provider: "paymongo",
    status: response.status,
    ok: response.ok,
    orderId: order.id
  });
  if (!response.ok) {
    const providerError = paymongoErrorDetails(data);
    console.error("PayMongo checkout error:", {
      provider: "paymongo",
      status: response.status,
      detail: providerError.detail,
      code: providerError.code
    });
    throw new HttpError(502, providerError.detail || "Unable to create online payment.");
  }
  const checkoutUrl = data?.data?.attributes?.checkout_url;
  if (!checkoutUrl) {
    console.error("PayMongo checkout error:", {
      provider: "paymongo",
      status: response.status,
      reason: "missing_checkout_url",
      orderId: order.id
    });
    throw new HttpError(502, "Payment checkout URL was not returned by the payment provider.");
  }

  await query(
    `UPDATE orders
     SET status = 'awaiting_payment',
         payment_status = 'awaiting_payment',
         payment_method = :paymentMethod,
         payment_reference = :reference,
         payment_provider = 'paymongo',
         checkout_session_id = :sessionId,
         checkout_url = :checkoutUrl
     WHERE id = :orderId`,
    {
      orderId: order.id,
      paymentMethod: input.paymentMethod,
      reference,
      sessionId: data.data.id,
      checkoutUrl
    }
  );

  res.json({ checkoutUrl, orderId: order.id, reference, checkoutSessionId: data.data.id, provider: "paymongo" });
}));

router.post("/orders/:orderId/verify", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  assertPaymongoConfigured();
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  const order = await findOrderForPaymongo({
    orderId,
    userId: req.user.id,
    isAdmin: req.user.role === "admin"
  });
  if (!order) throw new HttpError(404, "Order not found");
  console.log("[paymongo-verify] order:", order.id);
  if (order.payment_status === "paid") {
    return res.json(paymentStatusResponse(order, { confirmed: true, alreadyPaid: true }));
  }
  if (!order.checkout_session_id) {
    console.warn("[paymongo-verify] missing checkout session", {
      orderId: order.id,
      hasReference: Boolean(order.payment_reference)
    });
    throw new HttpError(409, "This order does not have a PayMongo checkout session to verify.");
  }
  const sessionResponse = await fetchPaymongoCheckoutSession(order.checkout_session_id);
  const session = checkoutSessionFromPaymongoPayload(sessionResponse);
  const summary = paymongoSessionSummary(session);
  console.log("[paymongo-verify] session status:", summary.sessionStatus || null);
  console.log("[paymongo-verify] payment status:", summary.paymentStatus || null);
  if (isSessionPaymentConfirmed(session)) {
    const transactionId = summary.paymentId || summary.paymentIntentId || summary.sessionId;
    const reference = summary.reference || order.payment_reference;
    const paidResult = await markOrderPaid({
      orderId: order.id,
      transactionId,
      reference,
      checkoutSessionId: summary.sessionId || order.checkout_session_id,
      io: req.app.get("io")
    });
    if (paidResult.adminNotification) {
      req.app.get("io")?.to("admin").emit("notification:new", {
        ...paidResult.adminNotification,
        created_at: new Date().toISOString()
      });
    }
    console.log("[paymongo-verify] order payment_status updated to paid", { order: order.id });
    return res.json(paymentStatusResponse(paidResult.order, {
      confirmed: true,
      sessionStatus: summary.sessionStatus,
      paymentStatus: summary.paymentStatus
    }));
  }
  if (isSessionPaymentFailed(session)) {
    await markOrderFailed({
      orderId: order.id,
      transactionId: transactionIdFromSession(session),
      reference: summary.reference || order.payment_reference,
      io: req.app.get("io")
    });
  }
  const latestOrder = await getOrderPaymentStatus(order.id);
  res.json(paymentStatusResponse(latestOrder, {
    confirmed: false,
    sessionStatus: summary.sessionStatus,
    paymentStatus: summary.paymentStatus
  }));
}));

router.post(["/webhook", "/paymongo/webhook"], asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  if (!verifyWebhookSignature(req)) throw new HttpError(401, "Invalid PayMongo webhook signature.");
  const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
  const event = payload?.data || {};
  const eventType = eventTypeFromPayload(payload);
  const resource = paymongoResource(payload);
  const session = isPaymongoCheckoutSessionResource(resource) ? sessionForWebhookPayload(payload) : null;
  const summary = session ? paymongoSessionSummary(session) : {};
  const resourceAttributes = resource?.attributes || {};
  const reference = summary.reference || resourceAttributes.reference_number || resourceAttributes.description || null;
  const paymentIntentId = summary.paymentIntentId || paymentIntentIdFromResource(resource);
  const orderId = summary.orderId || orderIdFromResource(resource) || orderIdFromReference(reference);
  const order = await findOrderForPaymongo({
    orderId,
    checkoutSessionId: summary.sessionId,
    paymentIntentId,
    reference
  });

  console.log("[paymongo-webhook] event received");
  console.log("[paymongo-webhook] event type:", eventType || "unknown");
  console.log("[paymongo-webhook] order:", order?.id || orderId || null);

  if (!order) {
    console.warn("[paymongo-webhook] order not found for PayMongo event", {
      eventType: eventType || null,
      sessionId: summary.sessionId,
      paymentIntentId,
      reference
    });
    return res.json({ received: true, matched: false });
  }

  const resourceStatus = String(resourceAttributes.status || "").toLowerCase();
  const paymentConfirmed = statusLooksPaid(eventType) || ["paid", "succeeded", "success"].includes(resourceStatus) || isSessionPaymentConfirmed(session);
  const qrExpired = /qrph.*expired|expired.*qrph|qr.*expired/i.test(String(eventType || ""));
  if (paymentConfirmed) {
    const transactionId = transactionIdFromSession(session, resource?.id || event?.id);
    const paidResult = await markOrderPaid({
      orderId: order.id,
      transactionId,
      reference: summary.reference || order.payment_reference,
      checkoutSessionId: summary.sessionId || order.checkout_session_id,
      paymentIntentId,
      io: req.app.get("io")
    });
    console.log("[paymongo-webhook] payment confirmed", { order: order.id });
    if (paidResult.updated) console.log("[paymongo-webhook] order payment_status updated to paid", { order: order.id });
    if (paidResult.adminNotification) {
      req.app.get("io")?.to("admin").emit("notification:new", {
        ...paidResult.adminNotification,
        created_at: new Date().toISOString()
      });
    }
  }
  if (!paymentConfirmed && qrExpired) {
    await query("UPDATE orders SET qr_code_url = NULL, payment_expires_at = NULL WHERE id = :orderId AND payment_status <> 'paid'", { orderId: order.id });
  } else if (!paymentConfirmed && (statusLooksFailed(eventType) || isSessionPaymentFailed(session))) {
    await markOrderFailed({
      orderId: order.id,
      transactionId: transactionIdFromSession(session, resource?.id || event?.id),
      reference: summary.reference || order.payment_reference,
      io: req.app.get("io")
    });
  }
  res.json({ received: true, matched: true });
}));

router.get("/orders/:orderId/status", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  const order = await findOrderForPaymongo({ orderId, userId: req.user.id, isAdmin: req.user.role === "admin" });
  if (!order) throw new HttpError(404, "Order not found");
  if (order.payment_method === PAYMONGO_QRPH_TYPE && order.payment_status !== "paid") {
    const result = await verifyQrPaymentIntent(order, req.app.get("io"));
    return res.json(qrPaymentResponse(result.order, { confirmed: result.confirmed, providerStatus: result.providerStatus, expired: result.expired }));
  }
  return res.json(paymentStatusResponse(order, { confirmed: order.payment_status === "paid" }));
}));

router.get("/status/:id", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  const rows = await query(
    `SELECT id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, payment_intent_id, payment_method_id, qr_code_url, payment_expires_at, total_amount
     FROM orders
     WHERE id = :id AND (:isAdmin = true OR user_id = :userId)`,
    { id: req.params.id, userId: req.user.id, isAdmin: req.user.role === "admin" }
  );
  if (!rows.length) throw new HttpError(404, "Order not found");
  res.json(paymentStatusResponse(rows[0]));
}));

export default router;
