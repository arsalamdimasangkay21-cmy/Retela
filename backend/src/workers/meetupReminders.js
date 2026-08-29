import { query } from "../config/db.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { getShippingPolicy } from "../utils/shippingSettings.js";
import { haversineDistanceKm, normalizeMunicipality, validCoordinates } from "../utils/shippingCalculator.js";

const TIME_ZONE = "Asia/Manila";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let columnsReady;

function addressMatchesMunicipality(address, municipality) {
  const target = normalizeMunicipality(municipality);
  const source = normalizeMunicipality(address);
  if (!target || !source) return false;
  const segments = source.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  if (segments.includes(target)) return true;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(source);
}

function isEligibleLocalCodMeetup(order, shopMunicipality, shopCoordinates, meetupRangeKm) {
  const method = String(order.payment_method || "").trim().toLowerCase();
  if (!(method === "cod" || method === "cash" || method === "cash_on_delivery") || order.fulfillment_method !== "delivery") return false;
  const municipality = normalizeMunicipality(order.delivery_municipality);
  const sameMunicipality = municipality
    ? municipality === normalizeMunicipality(shopMunicipality)
    : addressMatchesMunicipality(order.delivery_address, shopMunicipality);
  if (!sameMunicipality || !validCoordinates(order.delivery_latitude, order.delivery_longitude) || !validCoordinates(shopCoordinates.latitude, shopCoordinates.longitude)) return false;
  const distance = haversineDistanceKm(shopCoordinates, { latitude: order.delivery_latitude, longitude: order.delivery_longitude });
  return distance !== null && distance <= meetupRangeKm;
}

async function ensureReminderColumns() {
  columnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
       AND COLUMN_NAME IN ('meetup_24h_reminder_sent_at', 'meetup_1h_reminder_sent_at')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("meetup_24h_reminder_sent_at")) await query("ALTER TABLE orders ADD COLUMN meetup_24h_reminder_sent_at DATETIME NULL AFTER meetup_customer_note");
    if (!columns.has("meetup_1h_reminder_sent_at")) await query("ALTER TABLE orders ADD COLUMN meetup_1h_reminder_sent_at DATETIME NULL AFTER meetup_24h_reminder_sent_at");
  })().catch((error) => {
    columnsReady = undefined;
    throw error;
  });
  return columnsReady;
}

function meetupDateInManila(dateValue, timeValue) {
  const date = dateValue instanceof Date
    ? new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(dateValue)
    : String(dateValue || "").slice(0, 10);
  const time = String(timeValue || "").slice(0, 5);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const [, year, month, day] = match.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);
  if (hours > 23 || minutes > 59) return null;
  // Asia/Manila is UTC+08:00 and has no DST. Store/compare the instant in UTC.
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes));
}

function displayTime(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
}

function displayDate(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "long", day: "numeric" }).format(date);
}

async function sendReminder(order, kind, meetupAt, io) {
  const isOneHour = kind === "1h";
  const marker = isOneHour ? "meetup_1h_reminder_sent_at" : "meetup_24h_reminder_sent_at";
  const title = isOneHour ? "Meetup in 1 Hour" : "Meetup Tomorrow";
  const adminTitle = isOneHour ? "Meetup in 1 Hour" : "Customer Meetup Tomorrow";
  const place = order.meeting_place || "the confirmed meetup place";
  const time = displayTime(meetupAt);
  const date = displayDate(meetupAt);
  const customerBody = isOneHour
    ? `Your meetup for Order #${order.id} is scheduled at ${time} at ${place}.`
    : `Your meetup for Order #${order.id} is scheduled tomorrow, ${date} at ${time} at ${place}.`;
  const adminBody = isOneHour
    ? `Order #${order.id} meetup with ${order.username || "the customer"} is scheduled in one hour at ${place}.`
    : `Order #${order.id} meetup with ${order.username || "the customer"} is scheduled tomorrow, ${date} at ${time} at ${place}.`;
  const sentAt = new Date();
  const result = await query(
    `UPDATE orders SET ${marker} = :sentAt
     WHERE id = :id AND meetup_confirmation_status = 'agreed' AND ${marker} IS NULL
       AND status NOT IN ('completed', 'cancelled', 'payment_failed', 'returned', 'rejected')`,
    { id: order.id, sentAt }
  );
  if (!result?.affectedRows) return false;
  await query("INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', :title, :body)", { userId: order.user_id, title, body: customerBody });
  await query("INSERT INTO notifications (type, title, body) VALUES ('order', :title, :body)", { title: adminTitle, body: adminBody });
  io?.to(`user:${order.user_id}`).emit("notification:new", { type: "order", title, body: customerBody, orderId: order.id });
  io?.to("admin").emit("notification:new", { type: "order", title: adminTitle, body: adminBody, orderId: order.id });
  console.info("[meetup-reminder] sent", { orderId: order.id, kind, timeZone: TIME_ZONE });
  return true;
}

export async function runMeetupReminderCheck(io) {
  await ensureReminderColumns();
  const [{ config }, shippingPolicy] = await Promise.all([loadSystemSettings(), getShippingPolicy()]);
  const settings = config.notifications || {};
  const shopMunicipality = shippingPolicy.shopMunicipality || config.general.shopMunicipality;
  const shopCoordinates = {
    latitude: shippingPolicy.shopLatitude ?? config.general.shopLatitude,
    longitude: shippingPolicy.shopLongitude ?? config.general.shopLongitude
  };
  const configuredRange = Number(shippingPolicy.freeDeliveryRadiusKm ?? config.payment.freeDeliveryRadiusKm ?? 15);
  const meetupRangeKm = Number.isFinite(configuredRange) ? Math.max(0, configuredRange) : 15;
  const now = new Date();
  const orders = await query(
    `SELECT o.id, o.user_id, o.status, o.payment_method, o.fulfillment_method,
            o.delivery_address, o.delivery_latitude, o.delivery_longitude, o.delivery_municipality,
            o.meeting_place,
            DATE_FORMAT(o.meetup_date, '%Y-%m-%d') AS meetup_date,
            TIME_FORMAT(o.meetup_time, '%H:%i') AS meetup_time,
            o.meetup_confirmation_status, o.meetup_24h_reminder_sent_at, o.meetup_1h_reminder_sent_at,
            u.username
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.meetup_confirmation_status = 'agreed'
       AND o.meetup_date IS NOT NULL AND o.meetup_time IS NOT NULL
       AND o.status NOT IN ('completed', 'cancelled', 'payment_failed', 'returned', 'rejected')`
  );
  for (const order of orders) {
    if (!isEligibleLocalCodMeetup(order, shopMunicipality, shopCoordinates, meetupRangeKm)) continue;
    const meetupAt = meetupDateInManila(order.meetup_date, order.meetup_time);
    if (!meetupAt || meetupAt <= now) continue;
    if (settings.meetup24HourReminder !== false && !order.meetup_24h_reminder_sent_at && now >= new Date(meetupAt.getTime() - 24 * 60 * 60 * 1000)) {
      await sendReminder(order, "24h", meetupAt, io);
    }
    if (settings.meetup1HourReminder !== false && !order.meetup_1h_reminder_sent_at && now >= new Date(meetupAt.getTime() - 60 * 60 * 1000)) {
      await sendReminder(order, "1h", meetupAt, io);
    }
  }
}

export function startMeetupReminderWorker(io) {
  const run = () => runMeetupReminderCheck(io).catch((error) => console.error("[meetup-reminder] check failed", { code: error?.code, message: error?.message }));
  run();
  const timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
