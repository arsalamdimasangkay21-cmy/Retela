import { Router } from "express";
import { z } from "zod";
import { ensureAutoIncrementId, query, requireUsableAutoIncrementId } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth } from "../middleware/auth.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { shippingSummary } from "../utils/shippingSettings.js";
import { generateAIResponse } from "../utils/aiProvider.js";
import { availableProductWhere, ensureProductInventoryColumns, nonDeletedProductWhere } from "../utils/productInventory.js";
import { productImageExpression } from "../utils/productImages.js";
import { createAdminNotification } from "../utils/adminNotifications.js";

const router = Router();
let messageStatusColumnsReady;
let conversationAiColumnsReady;
let conversationLifecycleColumnsReady;
let messagingIdentityColumnsReady;
const aiProcessingLocks = new Set();

const cannedAdminReplies = [
  "Please share the item name and preferred size so I can confirm stock.",
  "I can help check availability. Let me review the shop inventory.",
  "This item is available. You may proceed with your order.",
  "Sorry, this item is currently out of stock.",
  "Please send your payment proof or reference number.",
  "Your order has been confirmed and is being prepared."
];

const availabilityPattern = /available|avail|stock|meron|size|do you have|mayroon|available pa|pa ba/i;
const sizePattern = /\b(xs|s|m|l|xl|xxl|free size|free)\b/i;
const assistantUnavailableMessage = "Retela Assistant is temporarily unavailable. Please try again shortly.";

function safeAiRouteError(error) {
  return {
    status: error?.status || error?.statusCode || error?.providerStatus || null,
    code: error?.code || null,
    providerMessage: String(error?.message || error?.cause?.message || "Unknown error")
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-openai-key]")
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-key]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/x-goog-api-key['":\s]+[A-Za-z0-9_-]+/gi, "x-goog-api-key [redacted]")
      .slice(0, 240),
    errorName: error?.name || null
  };
}

async function ensureMessagingIdentityColumns() {
  messagingIdentityColumnsReady ||= (async () => {
    await ensureAutoIncrementId("conversations");
    await ensureAutoIncrementId("messages");
    await requireUsableAutoIncrementId("conversations");
    await requireUsableAutoIncrementId("messages");
  })().catch((error) => {
    messagingIdentityColumnsReady = undefined;
    throw error;
  });
  return messagingIdentityColumnsReady;
}

async function ensureMessageStatusColumns() {
  messageStatusColumnsReady ||= (async () => {
    await ensureMessagingIdentityColumns();
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'messages'
         AND COLUMN_NAME IN ('delivery_status', 'delivered_at', 'seen_at', 'ai_provider', 'response_time_ms', 'token_usage')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("delivery_status")) {
      await query("ALTER TABLE messages ADD COLUMN delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent' AFTER body");
    }
    if (!columns.has("delivered_at")) {
      await query("ALTER TABLE messages ADD COLUMN delivered_at DATETIME NULL AFTER delivery_status");
    }
    if (!columns.has("seen_at")) {
      await query("ALTER TABLE messages ADD COLUMN seen_at DATETIME NULL AFTER delivered_at");
    }
    if (!columns.has("ai_provider")) {
      await query("ALTER TABLE messages ADD COLUMN ai_provider VARCHAR(20) NULL AFTER mode");
    }
    if (!columns.has("response_time_ms")) {
      await query("ALTER TABLE messages ADD COLUMN response_time_ms INT NULL AFTER ai_provider");
    }
    if (!columns.has("token_usage")) {
      await query("ALTER TABLE messages ADD COLUMN token_usage INT NULL AFTER response_time_ms");
    }
    await query(
      `UPDATE messages
       SET delivery_status = CASE
           WHEN delivery_status = 'seen' THEN 'seen'
           WHEN sender_type IN ('customer','admin','ai') THEN 'delivered'
           ELSE 'sent'
         END,
         delivered_at = COALESCE(delivered_at, created_at)
       WHERE delivery_status = 'sent' OR delivered_at IS NULL`
    );
  })().catch((error) => {
    messageStatusColumnsReady = undefined;
    throw error;
  });
  return messageStatusColumnsReady;
}

async function ensureConversationAiMetadataColumns() {
  conversationAiColumnsReady ||= (async () => {
    await ensureMessagingIdentityColumns();
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'conversations'
         AND COLUMN_NAME IN ('last_ai_provider', 'last_ai_response_time_ms', 'last_ai_token_usage')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("last_ai_provider")) {
      await query("ALTER TABLE conversations ADD COLUMN last_ai_provider VARCHAR(20) NULL AFTER admin_takeover");
    }
    if (!columns.has("last_ai_response_time_ms")) {
      await query("ALTER TABLE conversations ADD COLUMN last_ai_response_time_ms INT NULL AFTER last_ai_provider");
    }
    if (!columns.has("last_ai_token_usage")) {
      await query("ALTER TABLE conversations ADD COLUMN last_ai_token_usage INT NULL AFTER last_ai_response_time_ms");
    }
  })().catch((error) => {
    conversationAiColumnsReady = undefined;
    throw error;
  });
  return conversationAiColumnsReady;
}

async function ensureConversationLifecycleColumns() {
  conversationLifecycleColumnsReady ||= (async () => {
    await ensureMessagingIdentityColumns();
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'conversations'
         AND COLUMN_NAME IN ('ai_processing', 'is_archived', 'archived_at', 'is_deleted', 'deleted_at', 'deleted_by')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("ai_processing")) {
      await query("ALTER TABLE conversations ADD COLUMN ai_processing BOOLEAN NOT NULL DEFAULT FALSE AFTER admin_takeover");
    }
    if (!columns.has("is_archived")) {
      await query("ALTER TABLE conversations ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_processing");
    }
    if (!columns.has("archived_at")) {
      await query("ALTER TABLE conversations ADD COLUMN archived_at DATETIME NULL AFTER is_archived");
    }
    if (!columns.has("is_deleted")) {
      await query("ALTER TABLE conversations ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER archived_at");
    }
    if (!columns.has("deleted_at")) {
      await query("ALTER TABLE conversations ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted");
    }
    if (!columns.has("deleted_by")) {
      await query("ALTER TABLE conversations ADD COLUMN deleted_by INT NULL AFTER deleted_at");
    }
  })().catch((error) => {
    conversationLifecycleColumnsReady = undefined;
    throw error;
  });
  return conversationLifecycleColumnsReady;
}

function similarityRatio(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return intersection / union;
}

async function recentDuplicateMessage({ conversationId, senderType, body, seconds = 180 }) {
  const rows = await query(
    `SELECT id, body, ai_provider
     FROM messages
     WHERE conversation_id = :conversationId
       AND sender_type = :senderType
       AND created_at >= (NOW() - INTERVAL ${Number(seconds)} SECOND)
     ORDER BY created_at DESC
     LIMIT 5`,
    { conversationId, senderType }
  );
  return rows.find((row) => normalizeText(row.body) === normalizeText(body) || similarityRatio(row.body, body) >= 0.9) || null;
}

async function getOrCreateCustomerConversation(customerId) {
  await ensureConversationLifecycleColumns();
  const existing = await query(
    "SELECT id, customer_id, admin_takeover, ai_processing, is_archived FROM conversations WHERE customer_id = :customerId AND is_deleted = FALSE ORDER BY updated_at DESC, id DESC LIMIT 1",
    { customerId }
  );
  if (existing.length) return existing[0];
  const result = await query(
    "INSERT INTO conversations (customer_id, admin_takeover) VALUES (:customerId, false)",
    { customerId }
  );
  const rows = await query(
    "SELECT id, customer_id, admin_takeover FROM conversations WHERE id = :id LIMIT 1",
    { id: result.insertId }
  );
  return rows[0];
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function getCustomerOrders(customerId) {
  return query(
    `SELECT id, status, payment_method, payment_status, total_amount, created_at, updated_at
     FROM orders
     WHERE user_id = :customerId
     ORDER BY created_at DESC
     LIMIT 5`,
    { customerId }
  );
}

async function getCustomerProfile(customerId) {
  const rows = await query(
    `SELECT id, username, display_name, email, phone_number, location
     FROM users
     WHERE id = :customerId
     LIMIT 1`,
    { customerId }
  );
  return rows[0] || {};
}

async function getConversationHistory(conversationId) {
  await ensureMessageStatusColumns();
  return query(
    `SELECT sender_type, body, delivery_status, ai_provider, response_time_ms, token_usage, created_at
     FROM messages
     WHERE conversation_id = :conversationId
     ORDER BY created_at ASC`,
    { conversationId }
  );
}

function extractRequestedSize(text) {
  const match = String(text || "").match(sizePattern);
  if (!match) return "";
  const value = match[1].toLowerCase();
  if (value === "free") return "Free Size";
  return value.toUpperCase();
}

function productMatchesPrompt(product, prompt) {
  const source = normalizeText(prompt);
  const haystack = normalizeText(`${product.name} ${product.brand || ""} ${product.category || ""} ${product.description || ""}`);
  if (!source || !haystack) return false;
  if (source.includes(normalizeText(product.name))) return true;
  return normalizeText(product.name).split(" ").filter((token) => token.length >= 3).some((token) => source.includes(token))
    || source.split(" ").filter((token) => token.length >= 3).some((token) => haystack.includes(token));
}

function productMatchesSize(product, requestedSize) {
  if (!requestedSize) return true;
  return normalizeText(product.size) === normalizeText(requestedSize);
}

function buildInventorySuggestions(prompt, products) {
  const text = String(prompt || "");
  if (!availabilityPattern.test(text)) return cannedAdminReplies;
  const requestedSize = extractRequestedSize(text);
  const matchedByName = products.filter((product) => productMatchesPrompt(product, text));
  if (!matchedByName.length && requestedSize) {
    return [
      "Sorry, I could not find that item in our shop inventory.",
      "Please share the item name and preferred size so I can confirm stock.",
      "I can help check availability. Let me review the shop inventory.",
      ...cannedAdminReplies.slice(4)
    ];
  }
  if (!matchedByName.length || !requestedSize) {
    return [
      "Please share the item name and preferred size so I can confirm stock.",
      "I can help check availability. Let me review the shop inventory.",
      ...cannedAdminReplies.slice(4)
    ];
  }
  const matchedBySize = matchedByName.find((product) => productMatchesSize(product, requestedSize)) || matchedByName[0];
  const productName = matchedBySize.name || "this item";
  const productSize = matchedBySize.size || requestedSize;
  const stock = Number(matchedBySize.stock || 0);
  if (stock > 0) {
    return [
      `Yes, ${productName} in size ${productSize} is available. Current stock: ${stock}.`,
      "This item is available. You may proceed with your order.",
      "Your order has been confirmed and is being prepared.",
      ...cannedAdminReplies.slice(4, 5)
    ];
  }
  return [
    `Sorry, ${productName} is currently out of stock.`,
    "Sorry, this item is currently out of stock.",
    "I can help check availability. Let me review the shop inventory.",
    ...cannedAdminReplies.slice(4)
  ];
}

async function markConversationSeen({ conversationId, viewer }) {
  await ensureMessageStatusColumns();
  const senderTypes = viewer === "admin" ? ["customer"] : ["admin", "ai"];
  const placeholders = senderTypes.map((_, index) => `:senderType${index}`).join(", ");
  const params = Object.fromEntries(senderTypes.map((senderType, index) => [`senderType${index}`, senderType]));
  await query(
    `UPDATE messages
     SET delivery_status = 'seen',
         seen_at = COALESCE(seen_at, NOW()),
         delivered_at = COALESCE(delivered_at, created_at)
     WHERE conversation_id = :conversationId
       AND sender_type IN (${placeholders})
       AND delivery_status <> 'seen'`,
    { conversationId, ...params }
  );
}

router.get("/conversations", requireAuth, asyncHandler(async (req, res) => {
  await ensureMessageStatusColumns();
  await ensureConversationLifecycleColumns();
  const rows = req.user.role === "admin"
    ? await query(`
        SELECT c.*, u.username, u.email, u.phone_number, u.status,
          (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message,
          (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'customer' AND m.delivery_status <> 'seen') AS unread_count,
          u.last_active_at,
          CASE
            WHEN u.last_active_at >= (NOW() - INTERVAL 5 MINUTE) THEN 'active'
            WHEN u.last_active_at >= (NOW() - INTERVAL 15 MINUTE) THEN 'away'
            ELSE 'offline'
          END AS presence_status,
          u.last_active_at >= (NOW() - INTERVAL 5 MINUTE) AS is_online
        FROM conversations c
        JOIN users u ON u.id = c.customer_id
        WHERE u.role = 'customer'
          AND c.is_archived = FALSE
          AND c.is_deleted = FALSE
        ORDER BY c.updated_at DESC
      `)
    : await query(`
        SELECT c.*,
          (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message,
          (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type IN ('admin','ai') AND m.delivery_status <> 'seen') AS unread_count
        FROM conversations c
        WHERE c.customer_id = :id
          AND c.is_deleted = FALSE
        ORDER BY c.updated_at DESC, c.id DESC
      `, { id: req.user.id });
  res.json(rows);
}));

router.get("/customers/approved", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  const rows = await query(`
    SELECT id AS customer_id, username, email, phone_number, status, last_active_at,
      CASE
        WHEN last_active_at >= (NOW() - INTERVAL 5 MINUTE) THEN 'active'
        WHEN last_active_at >= (NOW() - INTERVAL 15 MINUTE) THEN 'away'
        ELSE 'offline'
      END AS presence_status,
      last_active_at >= (NOW() - INTERVAL 5 MINUTE) AS is_online
    FROM users
    WHERE role = 'customer' AND status = 'approved'
    ORDER BY username ASC
  `);
  res.json(rows);
}));

router.get("/archive", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const rows = await query(`
    SELECT c.*, u.username, u.email, u.phone_number, u.status,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message,
      (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_at
    FROM conversations c
    JOIN users u ON u.id = c.customer_id
    WHERE u.role = 'customer'
      AND c.is_archived = TRUE
      AND c.is_deleted = FALSE
    ORDER BY c.archived_at DESC, c.updated_at DESC
  `);
  res.json(rows);
}));

router.get("/trash", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const rows = await query(`
    SELECT c.*, u.username, u.email, u.phone_number,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message,
      (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS latest_message_at
    FROM conversations c
    JOIN users u ON u.id = c.customer_id
    WHERE c.is_deleted = TRUE
    ORDER BY c.deleted_at DESC, c.updated_at DESC
  `);
  res.json(rows);
}));

router.patch("/:conversationId/archive", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const result = await query(
    `UPDATE conversations
     SET is_archived = TRUE,
         archived_at = NOW(),
         is_deleted = FALSE,
         deleted_at = NULL,
         deleted_by = NULL,
         updated_at = NOW()
     WHERE id = :id AND is_deleted = FALSE`,
    { id: req.params.conversationId }
  );
  if (!result.affectedRows) throw new HttpError(404, "Conversation not found");
  res.json({ id: Number(req.params.conversationId), archived: true });
}));

router.patch("/:conversationId/trash", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const result = await query(
    `UPDATE conversations
     SET is_deleted = TRUE,
         deleted_at = NOW(),
         deleted_by = :deletedBy,
         is_archived = FALSE,
         updated_at = NOW()
     WHERE id = :id`,
    { id: req.params.conversationId, deletedBy: req.user.id }
  );
  if (!result.affectedRows) throw new HttpError(404, "Conversation not found");
  res.json({ id: Number(req.params.conversationId), trashed: true });
}));

router.patch("/:conversationId/restore", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const result = await query(
    `UPDATE conversations
     SET is_archived = FALSE,
         archived_at = NULL,
         is_deleted = FALSE,
         deleted_at = NULL,
         deleted_by = NULL,
         updated_at = NOW()
     WHERE id = :id`,
    { id: req.params.conversationId }
  );
  if (!result.affectedRows) throw new HttpError(404, "Conversation not found");
  res.json({ id: Number(req.params.conversationId), restored: true });
}));

router.delete("/:conversationId/permanent", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureConversationLifecycleColumns();
  const result = await query("DELETE FROM conversations WHERE id = :id AND is_deleted = TRUE", { id: req.params.conversationId });
  if (!result.affectedRows) throw new HttpError(404, "Conversation not found in trash");
  res.json({ id: Number(req.params.conversationId), deleted: true });
}));

router.get("/:conversationId", requireAuth, asyncHandler(async (req, res) => {
  await ensureMessageStatusColumns();
  const conversations = req.user.role === "admin"
    ? await query("SELECT id FROM conversations WHERE id = :id", { id: req.params.conversationId })
    : await query("SELECT id FROM conversations WHERE id = :id AND customer_id = :userId", { id: req.params.conversationId, userId: req.user.id });
  if (!conversations.length) return res.status(404).json({ message: "Conversation not found" });
  if (req.query.markSeen === "true") {
    await markConversationSeen({ conversationId: req.params.conversationId, viewer: req.user.role === "admin" ? "admin" : "customer" });
  }
  const rows = await query("SELECT * FROM messages WHERE conversation_id = :id ORDER BY created_at ASC", { id: req.params.conversationId });
  res.json(rows);
}));

router.get("/:conversationId/suggestions", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureMessageStatusColumns();
  await ensureProductInventoryColumns();
  const conversations = await query("SELECT id FROM conversations WHERE id = :id", { id: req.params.conversationId });
  if (!conversations.length) return res.status(404).json({ message: "Conversation not found" });
  const latestRows = await query(
    `SELECT body
     FROM messages
     WHERE conversation_id = :conversationId
       AND sender_type = 'customer'
     ORDER BY created_at DESC
     LIMIT 1`,
    { conversationId: req.params.conversationId }
  );
  const products = await query(
    `SELECT name, brand, category, size, stock, description
     FROM products
     WHERE ${nonDeletedProductWhere()}
     ORDER BY created_at DESC
     LIMIT 200`
  );
  const suggestions = buildInventorySuggestions(latestRows[0]?.body || "", products);
  res.json({ suggestions: Array.from(new Set(suggestions)).slice(0, 6) });
}));

router.delete("/:conversationId", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  res.status(405).json({ message: "Messages are stored permanently and cannot be deleted." });
}));

router.patch("/:conversationId/takeover", requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  const schema = z.object({ active: z.boolean() });
  const { active } = schema.parse(req.body);
  const rows = await query("SELECT customer_id FROM conversations WHERE id = :id", { id: req.params.conversationId });
  if (!rows.length) return res.status(404).json({ message: "Conversation not found" });
  await query("UPDATE conversations SET admin_takeover = :active, updated_at = NOW() WHERE id = :id", { active, id: req.params.conversationId });
  const systemMessage = active ? "Chat handled by Admin" : "Assistant is back online";
  await ensureMessageStatusColumns();
  await query(
    "INSERT INTO messages (conversation_id, sender_id, sender_type, body, delivery_status, delivered_at, mode, ai_provider) VALUES (:conversationId, NULL, 'ai', :body, 'delivered', NOW(), 'admin', 'Admin')",
    { conversationId: req.params.conversationId, body: systemMessage }
  );
  req.app.get("io")?.to(`conversation:${req.params.conversationId}`).emit("chat:control", { conversation_id: Number(req.params.conversationId), admin_takeover: active, message: systemMessage });
  req.app.get("io")?.to(`user:${rows[0].customer_id}`).emit("notification:new", { type: "message", title: active ? "Admin joined chat" : "Assistant resumed", body: systemMessage });
  res.json({ conversation_id: Number(req.params.conversationId), admin_takeover: active, message: systemMessage });
}));

router.post("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  const schema = z.object({
    conversation_id: z.number().int().optional(),
    customer_id: z.number().int().optional(),
    body: z.string().min(1),
    mode: z.enum(["ai", "admin"]).default("admin")
  });
  const input = schema.parse(req.body);
  await ensureConversationLifecycleColumns();
  await ensureMessageStatusColumns();
  let conversationId = input.conversation_id;
  if (!conversationId && req.user.role === "admin" && input.customer_id) {
    const existing = await query("SELECT id FROM conversations WHERE customer_id = :customerId ORDER BY id DESC LIMIT 1", { customerId: input.customer_id });
    conversationId = existing[0]?.id;
    if (!conversationId) {
      const result = await query("INSERT INTO conversations (customer_id, admin_takeover) VALUES (:customerId, true)", { customerId: input.customer_id });
      conversationId = result.insertId;
    }
  }
  if (!conversationId && req.user.role === "customer") {
    const conversation = await getOrCreateCustomerConversation(req.user.id);
    conversationId = conversation.id;
  }
  if (!conversationId) throw new HttpError(400, "Conversation is required.");
  const allowedConversation = req.user.role === "admin"
    ? (await query("SELECT id FROM conversations WHERE id = :conversationId AND is_deleted = FALSE", { conversationId }))[0]
    : (await query("SELECT id FROM conversations WHERE id = :conversationId AND customer_id = :customerId AND is_deleted = FALSE", { conversationId, customerId: req.user.id }))[0];
  if (!allowedConversation) throw new HttpError(404, "Conversation not found");
  const sender = req.user.role === "admin" ? "admin" : "customer";
  const provider = req.user.role === "admin" ? "Admin" : "Customer";
  await query(
    "INSERT INTO messages (conversation_id, sender_id, sender_type, body, delivery_status, delivered_at, mode, ai_provider) VALUES (:conversationId, :senderId, :sender, :body, 'delivered', NOW(), :mode, :provider)",
    { conversationId, senderId: req.user.id, sender, body: input.body, mode: input.mode, provider }
  );
  if (req.user.role === "admin") {
    await query("UPDATE conversations SET admin_takeover = true, updated_at = NOW() WHERE id = :conversationId", { conversationId });
    const rows = await query("SELECT customer_id FROM conversations WHERE id = :conversationId", { conversationId });
    if (rows[0]?.customer_id) {
      await query(
        "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'message', 'New admin message', :body)",
        { userId: rows[0].customer_id, body: input.body.slice(0, 240) }
      );
      req.app.get("io")?.to(`user:${rows[0].customer_id}`).emit("notification:new", { type: "message", title: "New admin message", body: input.body });
    }
  } else {
    await query(
      "UPDATE conversations SET is_archived = FALSE, archived_at = NULL, updated_at = NOW() WHERE id = :conversationId",
      { conversationId }
    );
    await createAdminNotification({
      type: "message",
      title: "New customer message",
      body: `${req.user.username || "A customer"} sent a new message.`,
      customerId: req.user.id,
      app: req.app
    });
  }
  req.app.get("io")?.to(`conversation:${conversationId}`).emit("message:new", { conversation_id: conversationId, sender_type: sender, body: input.body, mode: input.mode });
  res.status(201).json({ conversation_id: conversationId, sender_type: sender, body: input.body, delivery_status: "delivered" });
}));

router.post("/ai", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  console.info("[ai-route] authenticated", {
    userId: req.user.id,
    role: req.user.role,
    hasPrompt: Boolean(String(req.body?.prompt || "").trim()),
    promptLength: String(req.body?.prompt || "").length,
    conversationProvided: Boolean(req.body?.conversation_id)
  });
  await ensureMessageStatusColumns();
  await ensureConversationAiMetadataColumns();
  await ensureConversationLifecycleColumns();
  await ensureProductInventoryColumns();
  const schema = z.object({ conversation_id: z.number().int().optional(), prompt: z.string().min(1) });
  const input = schema.parse(req.body);
  const conversation = input.conversation_id
    ? (await query("SELECT id, admin_takeover, ai_processing, is_archived FROM conversations WHERE id = :id AND customer_id = :customerId AND is_deleted = FALSE", { id: input.conversation_id, customerId: req.user.id }))[0]
    : await getOrCreateCustomerConversation(req.user.id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  console.info("[ai-route] conversation ready", {
    conversationId: conversation.id,
    adminTakeover: Boolean(conversation.admin_takeover),
    aiProcessing: Boolean(conversation.ai_processing)
  });

  const historyBefore = await getConversationHistory(conversation.id);
  console.info("[ai-route] history ready", {
    conversationId: conversation.id,
    historyCount: historyBefore.length
  });
  const latestCustomer = [...historyBefore].reverse().find((message) => message.sender_type === "customer");
  const latestAi = [...historyBefore].reverse().find((message) => message.sender_type === "ai");
  const duplicateCustomer = await recentDuplicateMessage({ conversationId: conversation.id, senderType: "customer", body: input.prompt, seconds: 90 });
  let adminMessageNotification = null;
  if (!duplicateCustomer) {
    await query(
      "INSERT INTO messages (conversation_id, sender_id, sender_type, body, delivery_status, delivered_at, mode, ai_provider) VALUES (:conversationId, :senderId, 'customer', :body, 'delivered', NOW(), 'ai', 'Customer')",
      { conversationId: conversation.id, senderId: req.user.id, body: input.prompt }
    );
    req.app.get("io")?.to(`conversation:${conversation.id}`).emit("message:new", {
      conversation_id: conversation.id,
      sender_type: "customer",
      body: input.prompt,
      mode: "ai"
    });
    adminMessageNotification = await createAdminNotification({
      type: "message",
      title: "New customer message",
      body: `${req.user.username || "A customer"} sent a new message.`,
      customerId: req.user.id,
      emit: false
    });
  }
  console.info("[ai-route] customer message processed", {
    conversationId: conversation.id,
    duplicateCustomer: Boolean(duplicateCustomer),
    historyCount: historyBefore.length
  });

  await query(
    "UPDATE conversations SET is_archived = FALSE, archived_at = NULL, updated_at = NOW() WHERE id = :conversationId",
    { conversationId: conversation.id }
  );

  if (conversation.admin_takeover) {
    if (adminMessageNotification) {
      req.app.get("io")?.to("admin").emit("notification:new", {
        ...adminMessageNotification,
        title: "Customer replied",
        conversation_id: conversation.id,
        suggestions: [],
        created_at: new Date().toISOString()
      });
    }
    return res.status(202).json({
      conversation_id: conversation.id,
      body: "",
      provider: "",
      admin_takeover: true,
      awaiting_admin: true,
      duplicate: Boolean(duplicateCustomer),
      suggestions: [],
      products: []
    });
  }

  if (latestCustomer && normalizeText(latestCustomer.body) === normalizeText(input.prompt) && latestAi?.body) {
    return res.json({
      conversation_id: conversation.id,
      body: latestAi.body,
      provider: latestAi.ai_provider || "unknown",
      admin_takeover: false,
      duplicate: true,
      suggestions: [],
      products: []
    });
  }

  const lockKey = Number(conversation.id);
  if (aiProcessingLocks.has(lockKey) || conversation.ai_processing) {
    const latestAi = (await query(
      `SELECT body, ai_provider
       FROM messages
       WHERE conversation_id = :conversationId AND sender_type = 'ai'
       ORDER BY created_at DESC
       LIMIT 1`,
      { conversationId: conversation.id }
    ))[0];
    return res.status(202).json({
      conversation_id: conversation.id,
      body: latestAi?.body || "",
      provider: latestAi?.ai_provider || "",
      processing: true,
      duplicate: true,
      suggestions: [],
      products: []
    });
  }
  aiProcessingLocks.add(lockKey);
  await query("UPDATE conversations SET ai_processing = TRUE WHERE id = :conversationId", { conversationId: conversation.id });

  try {
    await query(
      "UPDATE conversations SET is_archived = FALSE, archived_at = NULL, updated_at = NOW() WHERE id = :conversationId",
      { conversationId: conversation.id }
    );
    const products = await query(
      `SELECT name, brand, category, gender, size, price, stock, \`condition\`, description, ${productImageExpression("products")} AS image_url
       FROM products
       WHERE ${availableProductWhere()}
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const suggestions = buildInventorySuggestions(input.prompt, products);
    const availableProducts = products.filter((product) => Number(product.stock || 0) > 0);
    console.info("[ai-route] product context ready", {
      conversationId: conversation.id,
      productCount: products.length,
      availableProductCount: availableProducts.length,
      suggestionCount: suggestions.length
    });

    const [orders, settingsResult, shipping, customerProfile, history] = await Promise.all([
      getCustomerOrders(req.user.id),
      loadSystemSettings(),
      shippingSummary(),
      getCustomerProfile(req.user.id),
      getConversationHistory(conversation.id)
    ]);
    const settings = {
      ...settingsResult.config,
      payment: {
        ...settingsResult.config.payment,
        shippingFeeType: shipping.type,
        shippingRateName: shipping.name,
        shippingFeeEnabled: shipping.enabled,
        shippingFee: Number(shipping.fee || 0)
      }
    };
    console.info("[ai-route] calling provider", {
      conversationId: conversation.id,
      hasMessage: Boolean(String(input.prompt || "").trim()),
      messageLength: String(input.prompt || "").length,
      historyCount: history.length,
      orderCount: orders.length,
      hasProductContext: availableProducts.length > 0,
      configuredProvider: settings?.ai?.aiProvider || process.env.AI_PROVIDER || "auto"
    });
    let aiResult;
    try {
      aiResult = await generateAIResponse(input.prompt, {
        products: availableProducts,
        history,
        orders,
        settings,
        customer: customerProfile,
        provider: settings?.ai?.aiProvider
      });
    } catch (error) {
      console.error("[ai-route] provider failed", safeAiRouteError(error));
      const safeError = new HttpError(error.status || 502, assistantUnavailableMessage);
      safeError.cause = error;
      throw safeError;
    }
    console.info("[ai-route] provider returned", {
      conversationId: conversation.id,
      provider: aiResult.provider,
      responseTime: aiResult.responseTime,
      hasBody: Boolean(String(aiResult.body || "").trim())
    });
    console.info("[ai-route] provider success", {
      conversationId: conversation.id,
      provider: aiResult.provider
    });
    const body = aiResult.body;
    if (!body) throw new HttpError(503, assistantUnavailableMessage);

    if (latestAi?.body && similarityRatio(latestAi.body, body) >= 0.9) {
      return res.json({ conversation_id: conversation.id, body: latestAi.body, provider: latestAi.ai_provider || aiResult.provider, admin_takeover: false, duplicate: true, suggestions: [], products: availableProducts.slice(0, 12) });
    }

    const duplicateAi = await recentDuplicateMessage({ conversationId: conversation.id, senderType: "ai", body, seconds: 300 });
    if (duplicateAi) {
      return res.json({ conversation_id: conversation.id, body: duplicateAi.body, provider: duplicateAi.ai_provider || aiResult.provider, admin_takeover: false, duplicate: true, suggestions: [], products: availableProducts.slice(0, 12) });
    }

    const aiProvider = aiResult.provider === "gemini" ? "Gemini" : "OpenAI";
    console.info("[ai-route] saving assistant response", {
      conversationId: conversation.id,
      provider: aiProvider,
      bodyLength: String(body || "").length
    });
    await query(
      "INSERT INTO messages (conversation_id, sender_id, sender_type, body, delivery_status, delivered_at, mode, ai_provider, response_time_ms, token_usage) VALUES (:conversationId, NULL, 'ai', :body, 'delivered', NOW(), 'ai', :aiProvider, :responseTime, :tokenUsage)",
      { conversationId: conversation.id, body, aiProvider, responseTime: aiResult.responseTime, tokenUsage: aiResult.tokenUsage }
    );
    await query(
      `UPDATE conversations
       SET last_ai_provider = :aiProvider,
           last_ai_response_time_ms = :responseTime,
           last_ai_token_usage = :tokenUsage,
           updated_at = NOW()
       WHERE id = :conversationId`,
      { conversationId: conversation.id, aiProvider, responseTime: aiResult.responseTime, tokenUsage: aiResult.tokenUsage }
    );
    if (adminMessageNotification) {
      req.app.get("io")?.to("admin").emit("notification:new", {
        ...adminMessageNotification,
        title: conversation.admin_takeover ? "Customer replied" : "New customer message",
        conversation_id: conversation.id,
        suggestions,
        created_at: new Date().toISOString()
      });
    }
    console.info("[ai-route] assistant message saved", {
      conversationId: conversation.id,
      provider: aiProvider
    });
    res.json({ conversation_id: conversation.id, body, provider: aiProvider, responseTime: aiResult.responseTime, tokenUsage: aiResult.tokenUsage, admin_takeover: false, suggestions, products: availableProducts.slice(0, 12) });
  } catch (error) {
    console.error("[ai-route] failed", safeAiRouteError(error));
    throw error;
  } finally {
    aiProcessingLocks.delete(lockKey);
    await query("UPDATE conversations SET ai_processing = FALSE WHERE id = :conversationId", { conversationId: conversation.id }).catch(() => {});
  }
}));

export default router;
