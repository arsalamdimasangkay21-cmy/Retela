import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { comparePassword, hashPassword } from "../utils/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();
let userColumnsReady;

function getPasswordBlueprint(password) {
  const value = String(password || "");
  return {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value)
  };
}

function isStrongPassword(password) {
  return Object.values(getPasswordBlueprint(password)).every(Boolean);
}

async function ensureUserColumns() {
  userColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('display_name', 'phone_number', 'location', 'birthday', 'gender', 'shop_description', 'profile_photo_url', 'gcash_number', 'debit_account_name', 'debit_account_number', 'preferences', 'last_active_at', 'is_verified')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("display_name")) {
      await query("ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER username");
    }
    if (!columns.has("phone_number")) {
      await query("ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL UNIQUE AFTER email");
    }
    if (!columns.has("location")) {
      await query("ALTER TABLE users ADD COLUMN location VARCHAR(255) NULL AFTER phone_number");
    }
    if (!columns.has("birthday")) {
      await query("ALTER TABLE users ADD COLUMN birthday DATE NULL AFTER location");
    }
    if (!columns.has("gender")) {
      await query("ALTER TABLE users ADD COLUMN gender VARCHAR(40) NULL AFTER birthday");
    }
    if (!columns.has("profile_photo_url")) {
      await query("ALTER TABLE users ADD COLUMN profile_photo_url VARCHAR(255) NULL AFTER gender");
    }
    if (!columns.has("gcash_number")) {
      await query("ALTER TABLE users ADD COLUMN gcash_number VARCHAR(20) NULL AFTER profile_photo_url");
    }
    if (!columns.has("debit_account_name")) {
      await query("ALTER TABLE users ADD COLUMN debit_account_name VARCHAR(120) NULL AFTER gcash_number");
    }
    if (!columns.has("debit_account_number")) {
      await query("ALTER TABLE users ADD COLUMN debit_account_number VARCHAR(40) NULL AFTER debit_account_name");
    }
    if (!columns.has("preferences")) {
      await query("ALTER TABLE users ADD COLUMN preferences JSON NULL");
    }
    if (!columns.has("last_active_at")) {
      await query("ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL AFTER preferences");
    }
    if (!columns.has("shop_description")) {
      await query("ALTER TABLE users ADD COLUMN shop_description TEXT NULL AFTER location");
    }
    if (!columns.has("is_verified")) {
      await query("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false AFTER status");
      await query("UPDATE users SET is_verified = true WHERE role IN ('admin','staff') OR status = 'approved'");
    }
    await safeModifyColumn("users", "role", "role enum update", "ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
    await safeModifyColumn("users", "email", "email nullable update", "ALTER TABLE users MODIFY email VARCHAR(160) NULL");
    await safeModifyColumn("users", "status", "status enum update", "ALTER TABLE users MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp'");
  })().catch((error) => {
    userColumnsReady = undefined;
    throw error;
  });
  return userColumnsReady;
}

router.get("/admin/payment-profile", asyncHandler(async (req, res) => {
  await ensureUserColumns();
  const users = await query(
    `SELECT username, display_name, phone_number, location, shop_description, gcash_number, debit_account_name, debit_account_number
     FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
  );
  res.json(users[0] || {
    username: "Retela Admin",
    display_name: "Retela Admin",
    phone_number: null,
    location: null,
    shop_description: null,
    gcash_number: null,
    debit_account_name: null,
    debit_account_number: null
  });
}));

router.use(requireAuth);

router.get("/me", asyncHandler(async (req, res) => {
  await ensureUserColumns();
  const users = await query(
    "SELECT id, username, display_name, email, phone_number, location, birthday, gender, shop_description, profile_photo_url, gcash_number, debit_account_name, debit_account_number, role, status, is_verified, is_verified AS isVerified FROM users WHERE id = :id",
    { id: req.user.id }
  );
  res.json(users[0]);
}));

router.patch("/me", upload.single("profilePhoto"), asyncHandler(async (req, res) => {
  await ensureUserColumns();
  const schema = z.object({
    username: z.string().trim().min(3).optional(),
    display_name: z.string().trim().max(120).optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone_number: z.string().trim().optional(),
    location: z.string().trim().optional(),
    birthday: z.string().trim().optional().or(z.literal("")),
    gender: z.string().trim().max(40).optional(),
    shop_description: z.string().trim().optional(),
    profile_photo_url: z.string().optional().nullable(),
    gcash_number: z.string().trim().optional(),
    debit_account_name: z.string().trim().optional(),
    debit_account_number: z.string().trim().optional()
  });
  const input = schema.parse(req.body);
  const profilePhotoUrl = req.file ? `/uploads/${req.file.filename}` : input.profile_photo_url;
  await query(
    `UPDATE users SET
      username = CASE WHEN :role = 'admin' THEN username ELSE COALESCE(:username, username) END,
      display_name = COALESCE(NULLIF(:displayName, ''), display_name),
      email = COALESCE(NULLIF(:email, ''), email),
      phone_number = :phone_number,
      location = :location,
      birthday = :birthday,
      gender = :gender,
      shop_description = :shop_description,
      profile_photo_url = COALESCE(:profilePhotoUrl, profile_photo_url),
      gcash_number = :gcash_number,
      debit_account_name = :debit_account_name,
      debit_account_number = :debit_account_number
     WHERE id = :id`,
    {
      id: req.user.id,
      role: req.user.role,
      username: input.username || null,
      displayName: input.display_name || null,
      email: input.email || "",
      phone_number: input.phone_number || null,
      location: input.location || null,
      birthday: input.birthday || null,
      gender: input.gender || null,
      shop_description: req.user.role === "admin" ? input.shop_description || null : null,
      profilePhotoUrl: profilePhotoUrl || null,
      gcash_number: req.user.role === "admin" ? input.gcash_number || null : null,
      debit_account_name: req.user.role === "admin" ? input.debit_account_name || null : null,
      debit_account_number: req.user.role === "admin" ? input.debit_account_number || null : null
    }
  );
  const users = await query(
    "SELECT id, username, display_name, email, phone_number, location, birthday, gender, shop_description, profile_photo_url, gcash_number, debit_account_name, debit_account_number, role, status, is_verified, is_verified AS isVerified FROM users WHERE id = :id",
    { id: req.user.id }
  );
  res.json(users[0]);
}));

router.patch("/me/password", asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
  });
  const input = schema.parse(req.body);
  if (!isStrongPassword(input.newPassword)) {
    throw new HttpError(400, "Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
  }
  if (input.currentPassword === input.newPassword) {
    throw new HttpError(400, "New password must be different from the current password");
  }
  const users = await query("SELECT id, password_hash FROM users WHERE id = :id", { id: req.user.id });
  if (!users.length) throw new HttpError(404, "Account not found");
  const valid = await comparePassword(input.currentPassword, users[0].password_hash);
  if (!valid) throw new HttpError(401, "Current password is incorrect");
  const passwordHash = await hashPassword(input.newPassword);
  await query("UPDATE users SET password_hash = :passwordHash WHERE id = :id", {
    id: req.user.id,
    passwordHash
  });
  res.json({ message: "Password changed successfully" });
}));

router.get("/", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureUserColumns();
  const users = await query(
    `SELECT id, username, display_name, email, phone_number, location, status, birthday, gender,
      CASE
        WHEN last_active_at >= (NOW() - INTERVAL 5 MINUTE) THEN 'active'
        WHEN last_active_at >= (NOW() - INTERVAL 15 MINUTE) THEN 'away'
        ELSE 'offline'
      END AS presence_status,
      last_active_at >= (NOW() - INTERVAL 5 MINUTE) AS is_online
      , last_active_at, created_at
     FROM users
     WHERE role = 'customer'
     ORDER BY FIELD(status, 'pending', 'approved', 'rejected', 'suspended'), created_at DESC`
  );
  res.json(users);
}));

router.patch("/me/deactivate", asyncHandler(async (req, res) => {
  await ensureUserColumns();
  if (req.user.role !== "customer") return res.status(403).json({ message: "Only customer accounts can be deactivated here." });
  await query(
    `UPDATE users
     SET status = 'suspended',
         otp_code = NULL,
         otp_expires_at = NULL,
         password_reset_otp_code = NULL,
         password_reset_otp_expires_at = NULL,
         password_reset_verified_until = NULL
     WHERE id = :id AND role = 'customer'`,
    { id: req.user.id }
  );
  await query(
    "INSERT INTO notifications (type, title, body) VALUES ('approval', 'Customer account deactivated', :body)",
    { body: `${req.user.username} deactivated their customer account.` }
  );
  req.app.get("io")?.to("admin").emit("user:status", {
    userId: Number(req.user.id),
    status: "suspended",
    last_active_at: new Date().toISOString()
  });
  res.json({ message: "Your account has been deactivated.", status: "suspended" });
}));

router.patch("/:id/status", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureUserColumns();
  const schema = z.object({ status: z.enum(["pending", "approved", "rejected", "suspended"]) });
  const { status } = schema.parse(req.body);
  const users = await query("SELECT id, username, status FROM users WHERE id = :id AND role = 'customer'", {
    id: req.params.id
  });
  if (!users.length) throw new HttpError(404, "Customer account not found");
  const currentStatus = users[0].status;
  const lockedStatuses = new Set(["approved", "rejected"]);
  if (lockedStatuses.has(currentStatus)) {
    if (currentStatus !== status) {
      throw new HttpError(409, `Customer status is already ${currentStatus} and cannot be changed.`);
    }
    const updatedUsers = await query(
      "SELECT id, username, email, phone_number, location, status, created_at FROM users WHERE id = :id",
      { id: req.params.id }
    );
    return res.json({ message: `Customer status is already ${currentStatus}`, user: updatedUsers[0] });
  }

  const result = await query("UPDATE users SET status = :status WHERE id = :id AND role = 'customer'", {
    id: req.params.id,
    status
  });
  if (Number(result.affectedRows || 0) === 0) throw new HttpError(404, "Customer account not found");
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:id, 'approval', 'Account update', :body)",
    { id: req.params.id, body: `Your account status is now ${status}.` }
  );
  req.app.get("io")?.to(`user:${req.params.id}`).emit("notification:new", { type: "approval", title: "Account update", body: `Your account status is now ${status}.` });
  req.app.get("io")?.to("admin").emit("user:status", {
    userId: Number(req.params.id),
    status,
    last_active_at: new Date().toISOString()
  });
  const updatedUsers = await query(
    "SELECT id, username, email, phone_number, location, status, created_at FROM users WHERE id = :id",
    { id: req.params.id }
  );
  res.json({ message: "Customer status updated", user: updatedUsers[0] });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  await ensureUserColumns();
  const users = await query("SELECT id, username, status FROM users WHERE id = :id AND role = 'customer'", {
    id: req.params.id
  });
  if (!users.length) throw new HttpError(404, "Customer account not found");

  const result = await query(
    `UPDATE users
     SET status = 'suspended',
         otp_code = NULL,
         otp_expires_at = NULL,
         password_reset_otp_code = NULL,
         password_reset_otp_expires_at = NULL,
         password_reset_verified_until = NULL
     WHERE id = :id
       AND role = 'customer'`,
    { id: req.params.id }
  );
  if (Number(result.affectedRows || 0) === 0) throw new HttpError(404, "Customer account not found");
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:id, 'approval', 'Account disabled', :body)",
    { id: req.params.id, body: "Your customer sign-in has been disabled by the admin. Your order history and records were kept in the system." }
  );
  req.app.get("io")?.to(`user:${req.params.id}`).emit("notification:new", {
    type: "approval",
    title: "Account disabled",
    body: "Your customer sign-in has been disabled by the admin."
  });
  req.app.get("io")?.to("admin").emit("user:status", {
    userId: Number(req.params.id),
    status: "suspended",
    last_active_at: new Date().toISOString()
  });
  res.json({
    message: "Customer sign-in disabled. Historical data was preserved.",
    id: Number(req.params.id),
    status: "suspended"
  });
}));

export default router;
