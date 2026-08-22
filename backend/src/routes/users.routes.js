import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { comparePassword, hashPassword } from "../utils/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();
let userColumnsReady;

const SAFE_USER_SELECT = `
  SELECT id, username, display_name, email, phone_number, location,
    formatted_address, delivery_barangay, delivery_municipality, delivery_province,
    delivery_region, delivery_postal_code, delivery_place_id, delivery_location_source,
    delivery_latitude, delivery_longitude, delivery_landmark, delivery_notes,
    DATE_FORMAT(birthday, '%Y-%m-%d') AS birthday,
    gender, shop_description, profile_photo_url, gcash_number, debit_account_name, debit_account_number,
    role, status, is_verified, is_verified AS isVerified
  FROM users
  WHERE id = :id
  LIMIT 1`;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nullableTrim(value) {
  if (value === undefined) return undefined;
  const next = String(value ?? "").trim();
  return next || null;
}

function normalizeBirthday(value) {
  const next = nullableTrim(value);
  if (!next) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(next);
  if (!match) throw new HttpError(400, "Birthday must use YYYY-MM-DD format");
  const birthday = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) {
    throw new HttpError(400, "Birthday must be a valid date");
  }
  return birthday;
}

function nullableCoordinate(min, max) {
  return z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().min(min).max(max).nullable()
  ).optional();
}

function nullableString(max) {
  return z.string().trim().max(max).nullable().optional();
}

async function getSafeUser(userId) {
  const users = await query(SAFE_USER_SELECT, { id: userId });
  if (!users.length) throw new HttpError(404, "Account not found");
  return users[0];
}

async function assertUniqueUserField(field, value, userId, message) {
  if (!value) return;
  const rows = await query(
    `SELECT id FROM users WHERE ${field} = :value AND id <> :userId LIMIT 1`,
    { value, userId }
  );
  if (rows.length) throw new HttpError(409, message);
}

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
         AND COLUMN_NAME IN ('display_name', 'phone_number', 'location', 'formatted_address', 'delivery_barangay', 'delivery_municipality', 'delivery_province', 'delivery_region', 'delivery_postal_code', 'delivery_place_id', 'delivery_location_source', 'delivery_latitude', 'delivery_longitude', 'delivery_landmark', 'delivery_notes', 'birthday', 'gender', 'shop_description', 'profile_photo_url', 'gcash_number', 'debit_account_name', 'debit_account_number', 'preferences', 'last_active_at', 'is_verified')`
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
    if (!columns.has("formatted_address")) await query("ALTER TABLE users ADD COLUMN formatted_address VARCHAR(500) NULL AFTER location");
    if (!columns.has("delivery_barangay")) await query("ALTER TABLE users ADD COLUMN delivery_barangay VARCHAR(160) NULL AFTER formatted_address");
    if (!columns.has("delivery_municipality")) await query("ALTER TABLE users ADD COLUMN delivery_municipality VARCHAR(160) NULL AFTER delivery_barangay");
    if (!columns.has("delivery_province")) await query("ALTER TABLE users ADD COLUMN delivery_province VARCHAR(160) NULL AFTER delivery_municipality");
    if (!columns.has("delivery_region")) await query("ALTER TABLE users ADD COLUMN delivery_region VARCHAR(160) NULL AFTER delivery_province");
    if (!columns.has("delivery_postal_code")) await query("ALTER TABLE users ADD COLUMN delivery_postal_code VARCHAR(20) NULL AFTER delivery_region");
    if (!columns.has("delivery_place_id")) await query("ALTER TABLE users ADD COLUMN delivery_place_id VARCHAR(255) NULL AFTER delivery_postal_code");
    if (!columns.has("delivery_location_source")) await query("ALTER TABLE users ADD COLUMN delivery_location_source VARCHAR(40) NULL AFTER delivery_place_id");
    if (!columns.has("delivery_latitude")) {
      await query("ALTER TABLE users ADD COLUMN delivery_latitude DECIMAL(10,7) NULL AFTER location");
    }
    if (!columns.has("delivery_longitude")) {
      await query("ALTER TABLE users ADD COLUMN delivery_longitude DECIMAL(10,7) NULL AFTER delivery_latitude");
    }
    if (!columns.has("delivery_landmark")) {
      await query("ALTER TABLE users ADD COLUMN delivery_landmark VARCHAR(255) NULL AFTER delivery_longitude");
    }
    if (!columns.has("delivery_notes")) {
      await query("ALTER TABLE users ADD COLUMN delivery_notes TEXT NULL AFTER delivery_landmark");
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
  res.json(await getSafeUser(req.user.id));
}));

router.patch("/me", upload.single("profilePhoto"), asyncHandler(async (req, res) => {
  await ensureUserColumns();
  const schema = z.object({
    username: z.string().trim().min(3, "Username must contain at least 3 characters").max(80, "Username must contain at most 80 characters").optional(),
    display_name: z.string().trim().max(120).optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone_number: z.string().trim().optional(),
    location: nullableString(255),
    formatted_address: nullableString(500),
    delivery_barangay: nullableString(160),
    delivery_municipality: nullableString(160),
    delivery_province: nullableString(160),
    delivery_region: nullableString(160),
    delivery_postal_code: nullableString(20),
    delivery_place_id: nullableString(255),
    delivery_location_source: z.preprocess(
      (value) => value === "" || value === null ? null : value,
      z.enum(["google", "nominatim", "geolocation", "map", "manual", "saved"]).nullable()
    ).optional(),
    delivery_latitude: nullableCoordinate(-90, 90),
    delivery_longitude: nullableCoordinate(-180, 180),
    delivery_landmark: nullableString(255),
    delivery_notes: nullableString(1000),
    birthday: z.string().trim().optional().or(z.literal("")),
    gender: z.string().trim().max(40).optional(),
    shop_description: z.string().trim().optional(),
    profile_photo_url: z.string().optional().nullable(),
    gcash_number: z.string().trim().optional(),
    debit_account_name: z.string().trim().optional(),
    debit_account_number: z.string().trim().optional()
  });
  const input = schema.parse(req.body);
  const structuredLocationFields = [
    "formatted_address",
    "delivery_barangay",
    "delivery_municipality",
    "delivery_province",
    "delivery_region",
    "delivery_postal_code",
    "delivery_place_id",
    "delivery_location_source",
    "delivery_latitude",
    "delivery_longitude"
  ];
  const hasStructuredLocationUpdate = structuredLocationFields.some((field) => hasOwn(input, field));
  if (req.user.role === "customer" && hasStructuredLocationUpdate) {
    const requiredFields = ["formatted_address", "delivery_location_source", "delivery_latitude", "delivery_longitude"];
    if (requiredFields.some((field) => !hasOwn(input, field))) {
      throw new HttpError(400, "Submit the complete selected delivery location.");
    }
    if (!nullableTrim(input.formatted_address)) throw new HttpError(400, "Delivery location is required.");
    const hasLatitude = input.delivery_latitude !== null;
    const hasLongitude = input.delivery_longitude !== null;
    if (hasLatitude !== hasLongitude) throw new HttpError(400, "Submit both delivery coordinates.");
    if (input.delivery_location_source !== "manual" && (!hasLatitude || !hasLongitude)) {
      throw new HttpError(400, "Please select a location from the suggestions.");
    }
    if (input.delivery_location_source === "manual") {
      input.delivery_barangay = null;
      input.delivery_municipality = null;
      input.delivery_province = null;
      input.delivery_region = null;
      input.delivery_postal_code = null;
      input.delivery_place_id = null;
      input.delivery_latitude = null;
      input.delivery_longitude = null;
    }
  }
  const updates = [];
  const params = { id: req.user.id };

  if (hasOwn(input, "username")) {
    const username = nullableTrim(input.username);
    if (!username) throw new HttpError(400, "Username is required");
    await assertUniqueUserField("username", username, req.user.id, "Username already exists");
    updates.push("username = :username");
    params.username = username;
  }

  if (hasOwn(input, "display_name")) {
    updates.push("display_name = :displayName");
    params.displayName = nullableTrim(input.display_name);
  }

  if (hasOwn(input, "email")) {
    const email = nullableTrim(input.email)?.toLowerCase() || null;
    await assertUniqueUserField("email", email, req.user.id, "Email already exists");
    updates.push("email = :email");
    params.email = email;
  }

  if (hasOwn(input, "phone_number")) {
    const phoneNumber = nullableTrim(input.phone_number);
    await assertUniqueUserField("phone_number", phoneNumber, req.user.id, "Phone number already exists");
    updates.push("phone_number = :phoneNumber");
    params.phoneNumber = phoneNumber;
  }

  if (hasOwn(input, "location")) {
    updates.push("location = :location");
    params.location = nullableTrim(input.location);
    if (req.user.role === "customer" && !hasStructuredLocationUpdate) {
      updates.push(
        "formatted_address = :legacyFormattedAddress",
        "delivery_barangay = NULL",
        "delivery_municipality = NULL",
        "delivery_province = NULL",
        "delivery_region = NULL",
        "delivery_postal_code = NULL",
        "delivery_place_id = NULL",
        "delivery_location_source = :legacyLocationSource",
        "delivery_latitude = NULL",
        "delivery_longitude = NULL"
      );
      params.legacyFormattedAddress = params.location;
      params.legacyLocationSource = params.location ? "manual" : null;
    }
  }

  if (hasOwn(input, "formatted_address")) {
    const formattedAddress = nullableTrim(input.formatted_address);
    updates.push("formatted_address = :formattedAddress");
    params.formattedAddress = formattedAddress;
    if (!hasOwn(input, "location")) {
      updates.push("location = :location");
      params.location = formattedAddress?.slice(0, 255) || null;
    }
  }

  for (const [field, column, parameter] of [
    ["delivery_barangay", "delivery_barangay", "deliveryBarangay"],
    ["delivery_municipality", "delivery_municipality", "deliveryMunicipality"],
    ["delivery_province", "delivery_province", "deliveryProvince"],
    ["delivery_region", "delivery_region", "deliveryRegion"],
    ["delivery_postal_code", "delivery_postal_code", "deliveryPostalCode"],
    ["delivery_place_id", "delivery_place_id", "deliveryPlaceId"],
    ["delivery_location_source", "delivery_location_source", "deliveryLocationSource"]
  ]) {
    if (hasOwn(input, field)) {
      updates.push(`${column} = :${parameter}`);
      params[parameter] = nullableTrim(input[field]);
    }
  }

  if (hasOwn(input, "delivery_latitude")) {
    updates.push("delivery_latitude = :deliveryLatitude");
    params.deliveryLatitude = input.delivery_latitude ?? null;
  }

  if (hasOwn(input, "delivery_longitude")) {
    updates.push("delivery_longitude = :deliveryLongitude");
    params.deliveryLongitude = input.delivery_longitude ?? null;
  }

  if (hasOwn(input, "delivery_landmark")) {
    updates.push("delivery_landmark = :deliveryLandmark");
    params.deliveryLandmark = nullableTrim(input.delivery_landmark);
  }

  if (hasOwn(input, "delivery_notes")) {
    updates.push("delivery_notes = :deliveryNotes");
    params.deliveryNotes = nullableTrim(input.delivery_notes);
  }

  if (hasOwn(input, "birthday")) {
    updates.push("birthday = :birthday");
    params.birthday = normalizeBirthday(input.birthday);
  }

  if (hasOwn(input, "gender")) {
    updates.push("gender = :gender");
    params.gender = nullableTrim(input.gender);
  }

  if (req.file) {
    updates.push("profile_photo_url = :profilePhotoUrl");
    params.profilePhotoUrl = `/uploads/${req.file.filename}`;
  } else if (hasOwn(input, "profile_photo_url")) {
    const profilePhotoUrl = nullableTrim(input.profile_photo_url);
    if (!profilePhotoUrl || (!profilePhotoUrl.startsWith("blob:") && !profilePhotoUrl.startsWith("data:"))) {
      updates.push("profile_photo_url = :profilePhotoUrl");
      params.profilePhotoUrl = profilePhotoUrl;
    }
  }

  if (req.user.role === "admin") {
    if (hasOwn(input, "shop_description")) {
      updates.push("shop_description = :shopDescription");
      params.shopDescription = nullableTrim(input.shop_description);
    }
    if (hasOwn(input, "gcash_number")) {
      updates.push("gcash_number = :gcashNumber");
      params.gcashNumber = nullableTrim(input.gcash_number);
    }
    if (hasOwn(input, "debit_account_name")) {
      updates.push("debit_account_name = :debitAccountName");
      params.debitAccountName = nullableTrim(input.debit_account_name);
    }
    if (hasOwn(input, "debit_account_number")) {
      updates.push("debit_account_number = :debitAccountNumber");
      params.debitAccountNumber = nullableTrim(input.debit_account_number);
    }
  }

  if (updates.length) {
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = :id`, params);
  }
  const updatedUser = await getSafeUser(req.user.id);
  console.log("[profile] updated user", { userId: updatedUser.id, role: updatedUser.role });
  res.json(updatedUser);
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
    `SELECT id, username, display_name, email, phone_number, location, formatted_address,
      delivery_barangay, delivery_municipality, delivery_province, delivery_region,
      delivery_postal_code, delivery_place_id, delivery_location_source,
      delivery_latitude, delivery_longitude, status, birthday, gender,
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
