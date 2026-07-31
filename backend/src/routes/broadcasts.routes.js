import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { sendEmail } from "../utils/email.js";
import { sendSms } from "../utils/sms.js";
import { getOpenAiRuntimeSettings } from "../utils/systemSettings.js";

const router = Router();

const audienceValues = ["all_customers", "by_location", "by_product_interest", "active_customers", "new_customers", "customers_with_orders", "vip_customers"];
const typeValues = ["new_arrival", "new_product_drop", "promo_sale", "flash_sale", "restock_alert", "holiday_promo", "order_update", "event_announcement", "ai_marketing_campaign"];

let broadcastSchemaReady;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function titleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeChannels(input) {
  return {
    inApp: Boolean(input?.inApp),
    email: Boolean(input?.email),
    sms: Boolean(input?.sms),
    aiChat: Boolean(input?.aiChat)
  };
}

function toMysqlDatetime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function ensureBroadcastSchema() {
  broadcastSchemaReady ||= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS broadcasts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(160) NOT NULL,
        message TEXT NOT NULL,
        image_url VARCHAR(255) NULL,
        promo_code VARCHAR(80) NULL,
        audience ENUM('all_customers','by_location','by_product_interest','active_customers','new_customers','customers_with_orders','vip_customers') NOT NULL DEFAULT 'all_customers',
        audience_filter VARCHAR(160) NULL,
        broadcast_type ENUM('new_arrival','new_product_drop','promo_sale','flash_sale','restock_alert','holiday_promo','order_update','event_announcement','ai_marketing_campaign') NOT NULL DEFAULT 'promo_sale',
        status ENUM('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
        channels_json JSON NOT NULL,
        scheduled_at DATETIME NULL,
        sent_at DATETIME NULL,
        ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
         created_by INT NULL,
         is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
         deleted_at DATETIME NULL,
         deleted_by INT NULL,
         sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
         sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
         sale_product_ids_json JSON NULL,
         sale_starts_at DATETIME NULL,
         sale_ends_at DATETIME NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_broadcasts_status_schedule (status, scheduled_at),
        INDEX idx_broadcasts_created (created_at),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await query("ALTER TABLE broadcasts MODIFY audience ENUM('all_customers','by_location','by_product_interest','active_customers','new_customers','customers_with_orders','vip_customers') NOT NULL DEFAULT 'all_customers'");
    await query("ALTER TABLE broadcasts MODIFY broadcast_type ENUM('new_arrival','new_product_drop','promo_sale','flash_sale','restock_alert','holiday_promo','order_update','event_announcement','ai_marketing_campaign') NOT NULL DEFAULT 'promo_sale'");
    const broadcastColumns = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'broadcasts'
         AND COLUMN_NAME IN ('audience_filter', 'is_deleted', 'deleted_at', 'deleted_by', 'sale_enabled', 'sale_discount_percent', 'sale_product_ids_json', 'sale_starts_at', 'sale_ends_at')`
    );
    const broadcastColumnSet = new Set(broadcastColumns.map((row) => row.COLUMN_NAME));
    if (!broadcastColumnSet.has("audience_filter")) {
      await query("ALTER TABLE broadcasts ADD COLUMN audience_filter VARCHAR(160) NULL AFTER audience");
    }
    if (!broadcastColumnSet.has("is_deleted")) {
      await query("ALTER TABLE broadcasts ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER created_by");
    }
    if (!broadcastColumnSet.has("deleted_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted");
    }
    if (!broadcastColumnSet.has("deleted_by")) {
      await query("ALTER TABLE broadcasts ADD COLUMN deleted_by INT NULL AFTER deleted_at");
    }
    if (!broadcastColumnSet.has("sale_enabled")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by");
    }
    if (!broadcastColumnSet.has("sale_discount_percent")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled");
    }
    if (!broadcastColumnSet.has("sale_product_ids_json")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_product_ids_json JSON NULL AFTER sale_discount_percent");
    }
    if (!broadcastColumnSet.has("sale_starts_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_starts_at DATETIME NULL AFTER sale_product_ids_json");
    }
    if (!broadcastColumnSet.has("sale_ends_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_ends_at DATETIME NULL AFTER sale_starts_at");
    }

    await query(`
      CREATE TABLE IF NOT EXISTS broadcast_deliveries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        broadcast_id INT NOT NULL,
        user_id INT NOT NULL,
        notification_id INT NULL,
        channel ENUM('in_app','email','sms','ai_chat') NOT NULL,
        delivery_status ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
        delivered_at DATETIME NULL,
        opened_at DATETIME NULL,
        clicked_at DATETIME NULL,
        error_message VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_broadcast_deliveries_broadcast (broadcast_id),
        INDEX idx_broadcast_deliveries_user (user_id),
        INDEX idx_broadcast_deliveries_notification (notification_id),
        FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
      )
    `);

    const notificationColumns = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'notifications'
         AND COLUMN_NAME IN ('broadcast_id')`
    );
    const notificationColumnSet = new Set(notificationColumns.map((row) => row.COLUMN_NAME));
    if (!notificationColumnSet.has("broadcast_id")) {
      await query("ALTER TABLE notifications ADD COLUMN broadcast_id INT NULL AFTER product_id");
      await query("ALTER TABLE notifications ADD CONSTRAINT fk_notifications_broadcast FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL");
      await query("CREATE INDEX idx_notifications_broadcast ON notifications (broadcast_id)");
    }
    await query("ALTER TABLE notifications MODIFY type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL");
  })().catch((error) => {
    broadcastSchemaReady = undefined;
    throw error;
  });
  return broadcastSchemaReady;
}

async function getAudienceUsers(audience, audienceFilter = "") {
  const filter = String(audienceFilter || "").trim();
  if (audience === "by_location" && filter) {
    return query(
      `SELECT id, username, display_name, email, phone_number
       FROM users
       WHERE role = 'customer'
         AND status = 'approved'
         AND location LIKE :location
       ORDER BY last_active_at DESC, created_at DESC`,
      { location: `%${filter}%` }
    );
  }
  if (audience === "by_product_interest" && filter) {
    return query(
      `SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.phone_number
       FROM users u
       JOIN orders o ON o.user_id = u.id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE u.role = 'customer'
         AND u.status = 'approved'
         AND (
           p.name LIKE :interest
           OR p.brand LIKE :interest
           OR p.category LIKE :interest
           OR p.description LIKE :interest
         )
       ORDER BY u.created_at DESC`,
      { interest: `%${filter}%` }
    );
  }
  if (audience === "by_location") {
    return query(
      `SELECT id, username, display_name, email, phone_number
       FROM users
       WHERE role = 'customer'
         AND status = 'approved'
         AND location IS NOT NULL
         AND location <> ''
       ORDER BY created_at DESC`
    );
  }
  if (audience === "by_product_interest") {
    return query(
      `SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.phone_number
       FROM users u
       JOIN orders o ON o.user_id = u.id
       JOIN order_items oi ON oi.order_id = o.id
       WHERE u.role = 'customer'
         AND u.status = 'approved'
       ORDER BY u.created_at DESC`
    );
  }
  if (audience === "new_customers") {
    return query(
      `SELECT id, username, display_name, email, phone_number
       FROM users
       WHERE role = 'customer'
         AND status = 'approved'
         AND created_at >= (NOW() - INTERVAL 30 DAY)
       ORDER BY created_at DESC`
    );
  }
  if (audience === "active_customers") {
    return query(
      `SELECT id, username, display_name, email, phone_number
       FROM users
       WHERE role = 'customer'
         AND status = 'approved'
         AND last_active_at IS NOT NULL
         AND last_active_at >= (NOW() - INTERVAL 14 DAY)
       ORDER BY last_active_at DESC`
    );
  }
  if (audience === "customers_with_orders") {
    return query(
      `SELECT DISTINCT u.id, u.username, u.display_name, u.email, u.phone_number
       FROM users u
       JOIN orders o ON o.user_id = u.id
       WHERE u.role = 'customer'
         AND u.status = 'approved'
       ORDER BY u.created_at DESC`
    );
  }
  if (audience === "vip_customers") {
    return query(
      `SELECT u.id, u.username, u.display_name, u.email, u.phone_number
       FROM users u
       JOIN (
         SELECT user_id,
                COUNT(*) AS order_count,
                COALESCE(SUM(total_amount), 0) AS total_spent
         FROM orders
         WHERE status IN ('approved', 'processing', 'ready', 'completed')
         GROUP BY user_id
       ) stats ON stats.user_id = u.id
       WHERE u.role = 'customer'
         AND u.status = 'approved'
         AND (stats.order_count >= 3 OR stats.total_spent >= 5000)
       ORDER BY stats.total_spent DESC, stats.order_count DESC`
    );
  }
  return query(
    `SELECT id, username, display_name, email, phone_number
     FROM users
     WHERE role = 'customer'
       AND status = 'approved'
     ORDER BY created_at DESC`
  );
}

async function getAudienceCounts() {
  const counts = await Promise.all(audienceValues.map(async (audience) => [audience, (await getAudienceUsers(audience)).length]));
  return Object.fromEntries(counts);
}

function toNotificationPayload(broadcast, imageUrl) {
  return {
    type: "broadcast",
    title: broadcast.title,
    body: broadcast.message,
    product: imageUrl ? { image_url: imageUrl } : null
  };
}

async function sendAiChatAnnouncement(userId, body) {
  const existing = await query("SELECT id FROM conversations WHERE customer_id = :userId LIMIT 1", { userId });
  let conversationId = existing[0]?.id;
  if (!conversationId) {
    const result = await query("INSERT INTO conversations (customer_id) VALUES (:userId)", { userId });
    conversationId = result.insertId;
  }
  await query(
    `INSERT INTO messages (conversation_id, sender_id, sender_type, mode, body)
     VALUES (:conversationId, NULL, 'ai', 'ai', :body)`,
    { conversationId, body }
  );
}

async function markBroadcastSent(broadcastId, status) {
  await query(
    `UPDATE broadcasts
     SET status = :status,
         sent_at = CASE WHEN :status = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = :id`,
    { id: broadcastId, status }
  );
}

async function dispatchBroadcast(app, broadcast, recipientUsers) {
  const io = app.get("io");
  const channels = normalizeChannels(parseJson(broadcast.channels_json, {}));
  let sentAnything = false;
  let processedUsers = 0;
  const totalUsers = Math.max(recipientUsers.length, 1);

  io?.to("admin").emit("broadcast:progress", {
    broadcast_id: Number(broadcast.id),
    progress: 0,
    status: "pending"
  });

  for (const user of recipientUsers) {
    if (channels.inApp) {
      const notificationResult = await query(
        `INSERT INTO notifications (user_id, type, title, body, broadcast_id)
         VALUES (:userId, 'broadcast', :title, :body, :broadcastId)`,
        {
          userId: user.id,
          title: broadcast.title,
          body: broadcast.message,
          broadcastId: broadcast.id
        }
      );
      await query(
        `INSERT INTO broadcast_deliveries (broadcast_id, user_id, notification_id, channel, delivery_status, delivered_at)
         VALUES (:broadcastId, :userId, :notificationId, 'in_app', 'sent', NOW())`,
        {
          broadcastId: broadcast.id,
          userId: user.id,
          notificationId: notificationResult.insertId
        }
      );
      io?.to(`user:${user.id}`).emit("notification:new", toNotificationPayload(broadcast, broadcast.image_url));
      sentAnything = true;
    }

    if (channels.email) {
      if (!user.email) {
        await query(
          `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, error_message)
           VALUES (:broadcastId, :userId, 'email', 'skipped', 'Customer email is not available')`,
          { broadcastId: broadcast.id, userId: user.id }
        );
      } else {
        try {
          await sendEmail(user.email, broadcast.title, broadcast.message);
          await query(
            `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, delivered_at)
             VALUES (:broadcastId, :userId, 'email', 'sent', NOW())`,
            { broadcastId: broadcast.id, userId: user.id }
          );
          sentAnything = true;
        } catch (error) {
          await query(
            `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, error_message)
             VALUES (:broadcastId, :userId, 'email', 'failed', :errorMessage)`,
            { broadcastId: broadcast.id, userId: user.id, errorMessage: String(error.message || "Email delivery failed").slice(0, 255) }
          );
        }
      }
    }

    if (channels.sms) {
      if (!user.phone_number) {
        await query(
          `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, error_message)
           VALUES (:broadcastId, :userId, 'sms', 'skipped', 'Customer mobile number is not available')`,
          { broadcastId: broadcast.id, userId: user.id }
        );
      } else {
        try {
          const sent = await sendSms(user.phone_number, `${broadcast.title}\n${broadcast.message}`);
          await query(
            `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, delivered_at, error_message)
             VALUES (:broadcastId, :userId, 'sms', :status, ${sent ? "NOW()" : "NULL"}, :errorMessage)`,
            {
              broadcastId: broadcast.id,
              userId: user.id,
              status: sent ? "sent" : "skipped",
              errorMessage: sent ? null : "SMS delivery provider is not configured"
            }
          );
          sentAnything ||= sent;
        } catch (error) {
          await query(
            `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, error_message)
             VALUES (:broadcastId, :userId, 'sms', 'failed', :errorMessage)`,
            { broadcastId: broadcast.id, userId: user.id, errorMessage: String(error.message || "SMS delivery failed").slice(0, 255) }
          );
        }
      }
    }

    if (channels.aiChat) {
      try {
        await sendAiChatAnnouncement(user.id, broadcast.message);
        await query(
          `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, delivered_at)
           VALUES (:broadcastId, :userId, 'ai_chat', 'sent', NOW())`,
          { broadcastId: broadcast.id, userId: user.id }
        );
        sentAnything = true;
      } catch (error) {
        await query(
          `INSERT INTO broadcast_deliveries (broadcast_id, user_id, channel, delivery_status, error_message)
           VALUES (:broadcastId, :userId, 'ai_chat', 'failed', :errorMessage)`,
          { broadcastId: broadcast.id, userId: user.id, errorMessage: String(error.message || "AI chat delivery failed").slice(0, 255) }
        );
      }
    }

    processedUsers += 1;
    io?.to("admin").emit("broadcast:progress", {
      broadcast_id: Number(broadcast.id),
      progress: Math.min(99, Math.round((processedUsers / totalUsers) * 100)),
      status: "sending"
    });
  }

  await markBroadcastSent(broadcast.id, sentAnything ? "sent" : "failed");
  io?.to("admin").emit("broadcast:progress", {
    broadcast_id: Number(broadcast.id),
    progress: 100,
    status: sentAnything ? "delivered" : "failed"
  });
}

async function processScheduledBroadcasts(app) {
  await ensureBroadcastSchema();
  const due = await query(
    `SELECT *
     FROM broadcasts
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 10`
  );
  for (const broadcast of due) {
    const claimResult = await query("UPDATE broadcasts SET status = 'sending' WHERE id = :id AND status = 'scheduled'", { id: broadcast.id });
    if (!Number(claimResult.affectedRows || 0)) continue;
    const recipients = await getAudienceUsers(broadcast.audience, broadcast.audience_filter);
    await dispatchBroadcast(app, broadcast, recipients);
  }
}

async function getBroadcastsResponse(app) {
  await processScheduledBroadcasts(app);
  const audienceCounts = await getAudienceCounts();
  const broadcasts = await query(
    `SELECT b.*,
       COUNT(DISTINCT bd.user_id) AS total_recipients,
       COUNT(DISTINCT CASE WHEN bd.opened_at IS NOT NULL THEN bd.user_id END) AS opened_recipients,
       COUNT(DISTINCT CASE WHEN bd.clicked_at IS NOT NULL THEN bd.user_id END) AS clicked_recipients
     FROM broadcasts b
     LEFT JOIN broadcast_deliveries bd ON bd.broadcast_id = b.id
     WHERE b.is_deleted = FALSE
     GROUP BY b.id
     ORDER BY COALESCE(b.sent_at, b.scheduled_at, b.updated_at, b.created_at) DESC, b.id DESC`
  );
  const deliveryStats = await query(
    `SELECT
       COUNT(*) AS total_broadcasts,
       COUNT(DISTINCT CASE WHEN status = 'scheduled' THEN id END) AS active_campaigns,
       COALESCE(SUM(total_recipients), 0) AS total_recipients,
       COALESCE(SUM(opened_recipients), 0) AS opened_recipients,
       COALESCE(SUM(clicked_recipients), 0) AS clicked_recipients
     FROM (
       SELECT b.id, b.status,
         COUNT(DISTINCT bd.user_id) AS total_recipients,
         COUNT(DISTINCT CASE WHEN bd.opened_at IS NOT NULL THEN bd.user_id END) AS opened_recipients,
         COUNT(DISTINCT CASE WHEN bd.clicked_at IS NOT NULL THEN bd.user_id END) AS clicked_recipients
       FROM broadcasts b
       LEFT JOIN broadcast_deliveries bd ON bd.broadcast_id = b.id
       WHERE b.is_deleted = FALSE
       GROUP BY b.id, b.status
     ) stats`
  );
  const analyticsRow = deliveryStats[0] || {};
  const analytics = {
    totalBroadcasts: Number(analyticsRow.total_broadcasts || 0),
    totalRecipients: Number(analyticsRow.total_recipients || 0),
    totalSent: Number(analyticsRow.total_recipients || 0),
    totalOpened: Number(analyticsRow.opened_recipients || 0),
    totalClicked: Number(analyticsRow.clicked_recipients || 0),
    openRate: Number(analyticsRow.total_recipients || 0) ? Number(((Number(analyticsRow.opened_recipients || 0) / Number(analyticsRow.total_recipients || 1)) * 100).toFixed(1)) : 0,
    clickRate: Number(analyticsRow.total_recipients || 0) ? Number(((Number(analyticsRow.clicked_recipients || 0) / Number(analyticsRow.total_recipients || 1)) * 100).toFixed(1)) : 0,
    conversionRate: Number(analyticsRow.total_recipients || 0) ? Number(((Number(analyticsRow.clicked_recipients || 0) / Number(analyticsRow.total_recipients || 1)) * 100).toFixed(1)) : 0,
    activeCampaigns: Number(analyticsRow.active_campaigns || 0)
  };
  return {
    analytics,
    audienceCounts,
    broadcasts: broadcasts.map((broadcast) => {
      const totalRecipients = Number(broadcast.total_recipients || 0);
      const openedRecipients = Number(broadcast.opened_recipients || 0);
      const clickedRecipients = Number(broadcast.clicked_recipients || 0);
      return {
        ...broadcast,
        channels: normalizeChannels(parseJson(broadcast.channels_json, {})),
        total_recipients: totalRecipients,
        opened_recipients: openedRecipients,
        clicked_recipients: clickedRecipients,
        open_rate: totalRecipients ? Number(((openedRecipients / totalRecipients) * 100).toFixed(1)) : 0,
        click_rate: totalRecipients ? Number(((clickedRecipients / totalRecipients) * 100).toFixed(1)) : 0,
        conversion_rate: totalRecipients ? Number(((clickedRecipients / totalRecipients) * 100).toFixed(1)) : 0
      };
    })
  };
}

function parseFormPayload(body) {
  const rawChannels = typeof body.channels === "string" ? parseJson(body.channels, null) : body.channels;
  const payload = {
    title: body.title,
    message: body.message,
    promo_code: body.promo_code || "",
    audience: body.audience,
    audience_filter: body.audience_filter || "",
    broadcast_type: body.broadcast_type,
    scheduled_at: body.scheduled_at || "",
    action: body.action || "draft",
    ai_generated: body.ai_generated === true || body.ai_generated === "true",
    sale_enabled: body.sale_enabled === true || body.sale_enabled === "true",
    sale_discount_percent: body.sale_discount_percent || 0,
    sale_product_ids: typeof body.sale_product_ids === "string" ? parseJson(body.sale_product_ids, []) : body.sale_product_ids,
    sale_starts_at: body.sale_starts_at || "",
    sale_ends_at: body.sale_ends_at || "",
    channels: normalizeChannels(rawChannels || {
      inApp: body.channel_in_app === "true",
      email: body.channel_email === "true",
      sms: body.channel_sms === "true",
      aiChat: body.channel_ai_chat === "true"
    })
  };
  const schema = z.object({
    title: z.string().trim().min(3).max(160),
    message: z.string().trim().min(12).max(5000),
    promo_code: z.string().trim().max(80).optional().default(""),
    audience: z.enum(audienceValues),
    audience_filter: z.string().trim().max(160).optional().default(""),
    broadcast_type: z.enum(typeValues),
    scheduled_at: z.string().optional().or(z.literal("")),
    action: z.enum(["draft", "schedule", "send"]),
    ai_generated: z.boolean().optional().default(false),
    sale_enabled: z.boolean().optional().default(false),
    sale_discount_percent: z.coerce.number().min(0).max(100).optional().default(0),
    sale_product_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
    sale_starts_at: z.string().optional().or(z.literal("")),
    sale_ends_at: z.string().optional().or(z.literal("")),
    channels: z.object({
      inApp: z.boolean(),
      email: z.boolean(),
      sms: z.boolean(),
      aiChat: z.boolean()
    }).refine((channels) => Object.values(channels).some(Boolean), "Select at least one delivery channel.")
  });
  return schema.parse(payload);
}

router.get("/sales/active", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const rows = await query(
    `SELECT id, title, sale_discount_percent, sale_product_ids_json, sale_starts_at, sale_ends_at
     FROM broadcasts
     WHERE is_deleted = FALSE
       AND status IN ('sent', 'scheduled')
       AND sale_enabled = TRUE
       AND (sale_starts_at IS NULL OR sale_starts_at <= NOW())
       AND (sale_ends_at IS NULL OR sale_ends_at >= NOW())
     ORDER BY sale_discount_percent DESC, updated_at DESC`
  );
  res.json(rows.map((row) => ({
    id: row.id,
    title: row.title,
    discountPercent: Number(row.sale_discount_percent || 0),
    productIds: parseJson(row.sale_product_ids_json, []).map(Number).filter(Boolean),
    startsAt: row.sale_starts_at,
    endsAt: row.sale_ends_at
  })));
}));

router.use(requireAuth, requireRole("admin"));

router.get("/", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  res.json(await getBroadcastsResponse(req.app));
}));

router.get("/trash", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const rows = await query(
    `SELECT *
     FROM broadcasts
     WHERE is_deleted = TRUE
     ORDER BY deleted_at DESC, updated_at DESC`
  );
  res.json(rows.map((broadcast) => ({ ...broadcast, channels: normalizeChannels(parseJson(broadcast.channels_json, {})) })));
}));

router.post("/generate", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const schema = z.object({
    title: z.string().trim().max(160).optional().default(""),
    audience: z.enum(audienceValues),
    broadcast_type: z.enum(typeValues),
    promo_code: z.string().trim().max(80).optional().default(""),
    notes: z.string().trim().max(500).optional().default("")
  }).refine((value) => value.title.length >= 3 || value.notes.length >= 3, {
    message: "Enter a campaign title or short AI prompt."
  });
  const input = schema.parse(req.body);
  const runtime = await getOpenAiRuntimeSettings();
  if (!runtime.apiKey) {
    throw new HttpError(400, "OpenAI is not configured in Settings yet.");
  }
  const prompt = [
    "Write one professional ecommerce marketing broadcast message for a thrift shop called Tela to Pera.",
    "Keep it concise, natural, and conversion-focused.",
    "Use 1 short paragraph only.",
    "Avoid markdown, hashtags, and quotation marks.",
    `Campaign title: ${input.title || input.notes}`,
    `Broadcast type: ${titleCase(input.broadcast_type)}`,
    `Audience: ${titleCase(input.audience)}`,
    input.promo_code ? `Promo code: ${input.promo_code}` : "Promo code: none",
    input.notes ? `Extra notes: ${input.notes}` : ""
  ].filter(Boolean).join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: Number(runtime.temperature ?? 0.45),
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: "You write short, polished ecommerce campaign announcements for Filipino retail customers."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpError(502, `OpenAI rejected the request: ${errorBody.slice(0, 180)}`);
  }
  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content?.trim();
  if (!message) throw new HttpError(502, "AI did not return a broadcast message.");
  res.json({ message });
}));

router.post("/", upload.single("image"), asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const input = parseFormPayload(req.body);
  const scheduledAt = toMysqlDatetime(input.scheduled_at);
  if (input.action === "schedule" && !scheduledAt) {
    throw new HttpError(400, "Select a valid schedule date and time.");
  }

  const status = input.action === "draft" ? "draft" : input.action === "schedule" ? "scheduled" : "sending";
  const result = await query(
    `INSERT INTO broadcasts (
      title, message, image_url, promo_code, audience, audience_filter, broadcast_type, status, channels_json, scheduled_at, ai_generated, created_by, sale_enabled, sale_discount_percent, sale_product_ids_json, sale_starts_at, sale_ends_at
    ) VALUES (
      :title, :message, :imageUrl, :promoCode, :audience, :audienceFilter, :broadcastType, :status, :channelsJson, :scheduledAt, :aiGenerated, :createdBy, :saleEnabled, :saleDiscountPercent, :saleProductIdsJson, :saleStartsAt, :saleEndsAt
    )`,
    {
      title: input.title,
      message: input.message,
      imageUrl: req.file ? `/uploads/${req.file.filename}` : null,
      promoCode: input.promo_code || null,
      audience: input.audience,
      audienceFilter: input.audience_filter || null,
      broadcastType: input.broadcast_type,
      status,
      channelsJson: JSON.stringify(input.channels),
      scheduledAt,
      aiGenerated: input.ai_generated,
      createdBy: req.user.id,
      saleEnabled: input.sale_enabled,
      saleDiscountPercent: input.sale_enabled ? input.sale_discount_percent : 0,
      saleProductIdsJson: input.sale_enabled ? JSON.stringify(input.sale_product_ids) : null,
      saleStartsAt: input.sale_enabled ? toMysqlDatetime(input.sale_starts_at) : null,
      saleEndsAt: input.sale_enabled ? toMysqlDatetime(input.sale_ends_at) : null
    }
  );

  if (input.action === "send") {
    const broadcasts = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: result.insertId });
    const recipients = await getAudienceUsers(input.audience, input.audience_filter);
    await dispatchBroadcast(req.app, broadcasts[0], recipients);
  }

  res.status(201).json({
    message: input.action === "send" ? "Broadcast sent successfully." : input.action === "schedule" ? "Broadcast scheduled successfully." : "Broadcast saved as draft.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

router.put("/:id", upload.single("image"), asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const existingRows = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: req.params.id });
  if (!existingRows.length) throw new HttpError(404, "Broadcast not found.");
  const existing = existingRows[0];
  const input = parseFormPayload(req.body);
  const scheduledAt = toMysqlDatetime(input.scheduled_at);
  if (input.action === "schedule" && !scheduledAt) {
    throw new HttpError(400, "Select a valid schedule date and time.");
  }

  const status = input.action === "draft" ? "draft" : input.action === "schedule" ? "scheduled" : "sending";
  await query(
    `UPDATE broadcasts
     SET title = :title,
         message = :message,
         image_url = :imageUrl,
         promo_code = :promoCode,
         audience = :audience,
         audience_filter = :audienceFilter,
         broadcast_type = :broadcastType,
         status = :status,
         channels_json = :channelsJson,
         scheduled_at = :scheduledAt,
         sent_at = CASE WHEN :status IN ('draft', 'scheduled', 'sending') THEN NULL ELSE sent_at END,
         ai_generated = :aiGenerated,
         sale_enabled = :saleEnabled,
         sale_discount_percent = :saleDiscountPercent,
         sale_product_ids_json = :saleProductIdsJson,
         sale_starts_at = :saleStartsAt,
         sale_ends_at = :saleEndsAt
     WHERE id = :id`,
    {
      id: req.params.id,
      title: input.title,
      message: input.message,
      imageUrl: req.file ? `/uploads/${req.file.filename}` : (req.body.image_url || existing.image_url || null),
      promoCode: input.promo_code || null,
      audience: input.audience,
      audienceFilter: input.audience_filter || null,
      broadcastType: input.broadcast_type,
      status,
      channelsJson: JSON.stringify(input.channels),
      scheduledAt,
      aiGenerated: input.ai_generated,
      saleEnabled: input.sale_enabled,
      saleDiscountPercent: input.sale_enabled ? input.sale_discount_percent : 0,
      saleProductIdsJson: input.sale_enabled ? JSON.stringify(input.sale_product_ids) : null,
      saleStartsAt: input.sale_enabled ? toMysqlDatetime(input.sale_starts_at) : null,
      saleEndsAt: input.sale_enabled ? toMysqlDatetime(input.sale_ends_at) : null
    }
  );

  if (input.action === "send") {
    await query("DELETE FROM broadcast_deliveries WHERE broadcast_id = :id", { id: req.params.id });
    await query("DELETE FROM notifications WHERE broadcast_id = :id", { id: req.params.id });
    const broadcasts = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: req.params.id });
    const recipients = await getAudienceUsers(input.audience, input.audience_filter);
    await dispatchBroadcast(req.app, broadcasts[0], recipients);
  }

  res.json({
    message: input.action === "send" ? "Broadcast updated and sent." : input.action === "schedule" ? "Broadcast updated and scheduled." : "Broadcast draft updated.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

router.post("/:id/resend", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const rows = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: req.params.id });
  if (!rows.length) throw new HttpError(404, "Broadcast not found.");
  const source = rows[0];
  const clone = await query(
    `INSERT INTO broadcasts (
      title, message, image_url, promo_code, audience, audience_filter, broadcast_type, status, channels_json, ai_generated, created_by
    ) VALUES (
      :title, :message, :imageUrl, :promoCode, :audience, :audienceFilter, :broadcastType, 'sending', :channelsJson, :aiGenerated, :createdBy
    )`,
    {
      title: source.title,
      message: source.message,
      imageUrl: source.image_url,
      promoCode: source.promo_code,
      audience: source.audience,
      audienceFilter: source.audience_filter,
      broadcastType: source.broadcast_type,
      channelsJson: source.channels_json,
      aiGenerated: source.ai_generated,
      createdBy: req.user.id
    }
  );
  const clonedRows = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: clone.insertId });
  const recipients = await getAudienceUsers(source.audience, source.audience_filter);
  await dispatchBroadcast(req.app, clonedRows[0], recipients);
  res.json({
    message: "Broadcast resent successfully.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

router.post("/:id/duplicate", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const rows = await query("SELECT * FROM broadcasts WHERE id = :id LIMIT 1", { id: req.params.id });
  if (!rows.length) throw new HttpError(404, "Broadcast not found.");
  const source = rows[0];
  await query(
    `INSERT INTO broadcasts (
      title, message, image_url, promo_code, audience, audience_filter, broadcast_type, status, channels_json, ai_generated, created_by
    ) VALUES (
      :title, :message, :imageUrl, :promoCode, :audience, :audienceFilter, :broadcastType, 'draft', :channelsJson, :aiGenerated, :createdBy
    )`,
    {
      title: `${source.title} Copy`.slice(0, 160),
      message: source.message,
      imageUrl: source.image_url,
      promoCode: source.promo_code,
      audience: source.audience,
      audienceFilter: source.audience_filter,
      broadcastType: source.broadcast_type,
      channelsJson: source.channels_json,
      aiGenerated: source.ai_generated,
      createdBy: req.user.id
    }
  );
  res.json({
    message: "Campaign duplicated as a draft.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

router.patch("/:id/restore", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const result = await query(
    `UPDATE broadcasts
     SET is_deleted = FALSE,
         deleted_at = NULL,
         deleted_by = NULL
     WHERE id = :id`,
    { id: req.params.id }
  );
  if (!Number(result.affectedRows || 0)) throw new HttpError(404, "Broadcast not found.");
  res.json({
    message: "Broadcast restored successfully.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

router.delete("/:id/permanent", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const result = await query("DELETE FROM broadcasts WHERE id = :id AND is_deleted = TRUE", { id: req.params.id });
  if (!Number(result.affectedRows || 0)) throw new HttpError(404, "Broadcast not found in trash.");
  res.json({ message: "Broadcast permanently deleted." });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await ensureBroadcastSchema();
  const result = await query(
    `UPDATE broadcasts
     SET is_deleted = TRUE,
         deleted_at = NOW(),
         deleted_by = :deletedBy
     WHERE id = :id`,
    { id: req.params.id, deletedBy: req.user.id }
  );
  if (!Number(result.affectedRows || 0)) throw new HttpError(404, "Broadcast not found.");
  res.json({
    message: "Broadcast moved to Trash Bin.",
    ...(await getBroadcastsResponse(req.app))
  });
}));

export default router;
