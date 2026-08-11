import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth } from "../middleware/auth.js";

const router = Router();
let paymentColumnsReady;
const PAYMONGO_CHECKOUT_URL = "https://api.paymongo.com/v2/checkout_sessions";
const GCASH_PAYMENT_METHOD_TYPES = ["gcash"];

async function ensurePaymentColumns() {
  paymentColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME IN ('payment_status', 'payment_reference', 'transaction_id', 'paid_at', 'payment_provider', 'checkout_session_id', 'checkout_url')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    await safeModifyColumn("orders", "status", "status enum update", "ALTER TABLE orders MODIFY status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed') NOT NULL DEFAULT 'pending'");
    await safeModifyColumn("orders", "payment_method", "payment_method enum update", "ALTER TABLE orders MODIFY payment_method ENUM('cod','cash','gcash','debit','credit','maya') NOT NULL DEFAULT 'cod'");
    if (!columns.has("payment_status")) await query("ALTER TABLE orders ADD COLUMN payment_status ENUM('unpaid','awaiting_payment','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'unpaid' AFTER payment_method");
    if (!columns.has("payment_reference")) await query("ALTER TABLE orders ADD COLUMN payment_reference VARCHAR(160) NULL AFTER payment_status");
    if (!columns.has("transaction_id")) await query("ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(160) NULL AFTER payment_reference");
    if (!columns.has("paid_at")) await query("ALTER TABLE orders ADD COLUMN paid_at DATETIME NULL AFTER transaction_id");
    if (!columns.has("payment_provider")) await query("ALTER TABLE orders ADD COLUMN payment_provider VARCHAR(40) NULL AFTER paid_at");
    if (!columns.has("checkout_session_id")) await query("ALTER TABLE orders ADD COLUMN checkout_session_id VARCHAR(160) NULL AFTER payment_provider");
    if (!columns.has("checkout_url")) await query("ALTER TABLE orders ADD COLUMN checkout_url TEXT NULL AFTER checkout_session_id");
  })().catch((error) => {
    paymentColumnsReady = undefined;
    throw error;
  });
  return paymentColumnsReady;
}

function paymongoSecret() {
  const key = process.env.PAYMONGO_SECRET_KEY || "";
  if (!key) throw new HttpError(503, "PayMongo configuration missing. Contact administrator.");
  return key;
}

function assertPaymongoConfigured() {
  paymongoSecret();
}

function clientUrl(path) {
  const base = (process.env.CLIENT_URL || "https://retela.shop").split(",")[0].trim().replace(/\/$/, "");
  return `${base}${path}`;
}

function authHeader() {
  return `Basic ${Buffer.from(`${paymongoSecret()}:`).toString("base64")}`;
}

function paymongoErrorDetails(data) {
  const error = data?.errors?.[0] || {};
  return {
    code: error.code || null,
    detail: error.detail || error.message || null
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

function verifyWebhookSignature(req) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) return true;
  const header = req.headers["paymongo-signature"] || req.headers["Paymongo-Signature"];
  if (!header || !Buffer.isBuffer(req.body)) return false;
  const parts = Object.fromEntries(String(header).split(",").map((part) => part.split("=").map((value) => value.trim())));
  const timestamp = parts.t;
  const signature = parts.v1 || parts.li || parts.te;
  if (!timestamp || !signature) return false;
  const payload = `${timestamp}.${req.body.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function markOrderPaid({ orderId, transactionId, reference }) {
  const rows = await query("SELECT id, user_id, status, payment_status FROM orders WHERE id = :orderId", { orderId });
  if (!rows.length) return null;
  if (rows[0].payment_status === "paid") return null;
  if (rows[0].status === "cancelled" || rows[0].payment_status === "cancelled") return null;
  await query(
    `UPDATE orders
     SET status = 'paid',
         payment_status = 'paid',
         transaction_id = COALESCE(:transactionId, transaction_id),
         payment_reference = COALESCE(:reference, payment_reference),
         paid_at = NOW(),
         payment_provider = 'paymongo'
     WHERE id = :orderId`,
    { orderId, transactionId: transactionId || null, reference: reference || null }
  );
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', 'Payment received', :body)",
    { userId: rows[0].user_id, body: `Payment for Order #${orderId} was confirmed.` }
  );
  const adminResult = await query(
    "INSERT INTO notifications (type, title, body) VALUES ('order', 'Payment received', :body)",
    { body: `Payment for Order #${orderId} was confirmed.` }
  );
  console.log("[admin notification created]", {
    id: adminResult.insertId,
    type: "order",
    title: "Payment received"
  });
  return {
    id: adminResult.insertId,
    type: "order",
    title: "Payment received",
    body: `Payment for Order #${orderId} was confirmed.`
  };
}

async function markOrderFailed({ orderId, transactionId, reference }) {
  const rows = await query("SELECT id, user_id, status, payment_status FROM orders WHERE id = :orderId", { orderId });
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
}

router.post("/create-gcash-checkout", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  assertPaymongoConfigured();
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
  const billingPhone = input.billingPhone || order.phone_number || "";
  const billing = {
    name: order.display_name || order.username || req.user.username,
    ...(order.email ? { email: order.email } : {}),
    ...(billingPhone ? { phone: billingPhone } : {})
  };
  console.log("Creating GCash payment", {
    orderId: order.id,
    requestedPaymentMethod: input.paymentMethod,
    paymentMethodTypes: GCASH_PAYMENT_METHOD_TYPES,
    provider: "paymongo",
    amount,
    successUrl: clientUrl(`/payment/success?order=${order.id}&ref=${reference}`),
    cancelUrl: clientUrl(`/payment/cancel?order=${order.id}&ref=${reference}`)
  });
  let response;
  let data;
  try {
    response = await fetch(PAYMONGO_CHECKOUT_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: {
          attributes: {
            billing,
            description: `RETELA Order #${order.id}`,
            line_items: [{
              currency: "PHP",
              amount,
              name: `RETELA Order #${order.id}`,
              quantity: 1
            }],
            payment_method_types: GCASH_PAYMENT_METHOD_TYPES,
            reference_number: reference,
            success_url: clientUrl(`/payment/success?order=${order.id}&ref=${reference}`),
            cancel_url: clientUrl(`/payment/cancel?order=${order.id}&ref=${reference}`)
          }
        }
      })
    });
    data = await response.json().catch(() => ({}));
    if (response.ok) logPaymongoCheckoutResponse(data);
  } catch (error) {
    console.error("GCash payment error:", {
      provider: "paymongo",
      message: error.message,
      code: error.code || null
    });
    throw new HttpError(502, "Unable to create GCash payment.");
  }
  console.log("Payment provider status:", {
    provider: "paymongo",
    status: response.status,
    ok: response.ok,
    orderId: order.id
  });
  if (!response.ok) {
    const providerError = paymongoErrorDetails(data);
    console.error("GCash payment error:", {
      provider: "paymongo",
      status: response.status,
      detail: providerError.detail,
      code: providerError.code
    });
    throw new HttpError(502, providerError.detail || "Unable to create GCash payment.");
  }
  const checkoutUrl = data?.data?.attributes?.checkout_url;
  if (!checkoutUrl) {
    console.error("GCash payment error:", {
      provider: "paymongo",
      status: response.status,
      reason: "missing_checkout_url",
      orderId: order.id
    });
    throw new HttpError(502, "GCash checkout URL was not returned by the payment provider.");
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
      paymentMethod: "gcash",
      reference,
      sessionId: data.data.id,
      checkoutUrl
    }
  );

  res.json({ checkoutUrl, orderId: order.id, reference, provider: "paymongo" });
}));

router.post("/webhook", asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  if (!verifyWebhookSignature(req)) throw new HttpError(401, "Invalid PayMongo webhook signature.");
  const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
  const event = payload?.data;
  const attributes = event?.attributes || {};
  const resource = attributes?.data || event;
  const resourceAttributes = resource?.attributes || {};
  const reference = resourceAttributes.reference_number || resourceAttributes.external_reference_number || resourceAttributes.description?.match(/#(\d+)/)?.[1];
  const orderMatch = String(reference || "").match(/RETELA-(\d+)/) || String(resourceAttributes.description || "").match(/#(\d+)/);
  const orderId = orderMatch ? Number(orderMatch[1]) : null;
  const eventType = attributes.type || event?.type;

  if (orderId && /paid|payment\.paid|checkout_session\.payment\.paid/i.test(String(eventType))) {
    const adminNotification = await markOrderPaid({ orderId, transactionId: resource?.id || event?.id, reference });
    if (adminNotification) {
      req.app.get("io")?.to("admin").emit("notification:new", {
        ...adminNotification,
        created_at: new Date().toISOString()
      });
    }
  }
  if (orderId && /failed|cancelled|canceled|expired/i.test(String(eventType))) {
    await markOrderFailed({ orderId, transactionId: resource?.id || event?.id, reference });
  }
  res.json({ received: true });
}));

router.get("/status/:id", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensurePaymentColumns();
  const rows = await query(
    `SELECT id, status, payment_status, payment_method, payment_reference, transaction_id, paid_at, payment_provider, total_amount
     FROM orders
     WHERE id = :id AND (:isAdmin = true OR user_id = :userId)`,
    { id: req.params.id, userId: req.user.id, isAdmin: req.user.role === "admin" }
  );
  if (!rows.length) throw new HttpError(404, "Order not found");
  res.json(rows[0]);
}));

export default router;
