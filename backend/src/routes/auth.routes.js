import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { comparePassword, createOtp, hashPassword, signToken } from "../utils/auth.js";
import { sendOtpEmail } from "../utils/email.js";
import { sendSms } from "../utils/sms.js";
import { registrationUpload } from "../middleware/upload.js";
import { checkRegistrationField, completeRegistration, ensureVerificationTables, resendRegistrationOtp, sendRegistrationOtp, validateRegistration } from "../controllers/registration.controller.js";

const router = Router();
const adminUsername = "AdministratorRetela";
const adminPassword = "Retela2026";
let phoneColumnReady;
let resetColumnsReady;
let recaptchaConfigWarningLogged = false;
const RECAPTCHA_TIMEOUT_MS = Math.min(Math.max(Number(process.env.RECAPTCHA_TIMEOUT_MS || 7000), 1000), 8000);

function normalizeAdminCredential(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function isAdministratorCredential(username, password) {
  return normalizeAdminCredential(username) === normalizeAdminCredential(adminUsername)
    && normalizeAdminCredential(password) === normalizeAdminCredential(adminPassword);
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

function captchaRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RECAPTCHA_SECRET_KEY);
}

async function verifyRecaptchaToken(token, remoteIp) {
  if (!captchaRequired()) return;
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    if (!recaptchaConfigWarningLogged) {
      console.error("[auth] RECAPTCHA_SECRET_KEY is required for login CAPTCHA verification in production.");
      recaptchaConfigWarningLogged = true;
    }
    throw new HttpError(500, "CAPTCHA verification is not configured.");
  }
  if (!token) throw new HttpError(400, "Please complete the CAPTCHA first.");

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RECAPTCHA_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new HttpError(408, "CAPTCHA verification timed out. Please try again.");
    }
    throw new HttpError(400, "CAPTCHA verification failed. Please try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new HttpError(400, "CAPTCHA verification failed. Please try again.");
  const data = await response.json().catch(() => ({}));
  if (!data.success) throw new HttpError(400, "CAPTCHA verification failed. Please try again.");
}

const registerSchema = z.object({
  username: z.string().trim().min(3, "Username must contain at least 3 letters or numbers").max(80),
  email: z.string().trim().email("Enter a valid email address").max(160),
  phone: z.string().trim().regex(/^09\d{9}$/, "Phone number must be 11 digits and start with 09"),
  location: z.string().trim().max(255).optional().default(""),
  password: z.string().min(8)
});

const contactSchema = z.string().trim().min(7).max(160);

router.post("/register/validate", validateRegistration);
router.post("/register/check", checkRegistrationField);
router.post("/register/send-otp", registrationUpload.fields([{ name: "idImage", maxCount: 1 }, { name: "selfieImage", maxCount: 1 }]), sendRegistrationOtp);
router.post("/register/resend-otp", resendRegistrationOtp);
router.post("/register/complete", completeRegistration);

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || "").replace(/\D/g, "");
}

function formatSmsPhoneNumber(phoneNumber) {
  if (phoneNumber.startsWith("+")) return phoneNumber;
  if (phoneNumber.startsWith("09") && phoneNumber.length === 11) return `+63${phoneNumber.slice(1)}`;
  return phoneNumber;
}

function isEmailContact(contact) {
  return contact.includes("@");
}

function parseContact(contact) {
  const value = contact.trim();
  if (isEmailContact(value)) {
    return { email: z.string().email().parse(value.toLowerCase()), phoneNumber: null, channel: "email" };
  }
  return { email: null, phoneNumber: normalizePhoneNumber(value), channel: "sms" };
}

async function sendOtpToContact(contact, channel, otp) {
  if (channel === "email") {
    await sendOtpEmail(contact, otp);
    return true;
  }
  const body = `Your Retela OTP is ${otp}. It expires in 5 minutes.`;
  return sendSms(formatSmsPhoneNumber(contact), body);
}

function getLoginIdentifiers(username) {
  const value = username.trim();
  const identifiers = new Set([value]);
  if (value.includes("@")) identifiers.add(value.toLowerCase());

  const phone = normalizePhoneNumber(value);
  if (/^\+?\d{7,15}$/.test(phone)) {
    identifiers.add(phone);
    if (phone.startsWith("+63")) identifiers.add(`0${phone.slice(3)}`);
    if (phone.startsWith("63") && phone.length === 12) identifiers.add(`0${phone.slice(2)}`);
    if (phone.startsWith("09") && phone.length === 11) {
      identifiers.add(`+63${phone.slice(1)}`);
      identifiers.add(`63${phone.slice(1)}`);
    }
  }

  return [...identifiers];
}

function getOtpExpiry() {
  return new Date(Date.now() + 5 * 60 * 1000);
}

async function ensurePhoneNumberColumn() {
  phoneColumnReady ||= (async () => {
    await safeModifyColumn("users", "email", "email nullable update", "ALTER TABLE users MODIFY email VARCHAR(160) NULL");
    await safeModifyColumn("users", "status", "status enum update", "ALTER TABLE users MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp'");
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('phone_number', 'display_name', 'location', 'is_verified')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("phone_number")) {
      await query("ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL UNIQUE AFTER email");
    }
    if (!columns.has("display_name")) {
      await query("ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER username");
    }
    if (!columns.has("location")) {
      await query("ALTER TABLE users ADD COLUMN location VARCHAR(255) NULL AFTER phone_number");
    }
    if (!columns.has("is_verified")) {
      await query("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false AFTER status");
      await query("UPDATE users SET is_verified = true WHERE role IN ('admin','staff') OR status = 'approved'");
    }
    await safeModifyColumn("users", "role", "role enum update", "ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
  })().catch((error) => {
    phoneColumnReady = undefined;
    throw error;
  });
  return phoneColumnReady;
}

async function ensurePasswordResetColumns() {
  resetColumnsReady ||= (async () => {
    await ensurePhoneNumberColumn();
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('password_reset_otp_code', 'password_reset_otp_expires_at', 'password_reset_verified_until')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("password_reset_otp_code")) {
      await query("ALTER TABLE users ADD COLUMN password_reset_otp_code VARCHAR(6) NULL AFTER otp_expires_at");
    }
    if (!columns.has("password_reset_otp_expires_at")) {
      await query("ALTER TABLE users ADD COLUMN password_reset_otp_expires_at DATETIME NULL AFTER password_reset_otp_code");
    }
    if (!columns.has("password_reset_verified_until")) {
      await query("ALTER TABLE users ADD COLUMN password_reset_verified_until DATETIME NULL AFTER password_reset_otp_expires_at");
    }
  })();
  return resetColumnsReady;
}

async function getOrCreateAdministrator() {
  await ensurePhoneNumberColumn();
  const passwordHash = await hashPassword(adminPassword);
  const conflicts = await query(
    "SELECT id FROM users WHERE username = :username OR email = 'administrator@retela.local' ORDER BY id ASC",
    { username: adminUsername }
  );
  if (conflicts[0]) {
    for (const duplicate of conflicts.slice(1)) {
      await query(
        "UPDATE users SET username = CONCAT(username, '_old_', id), email = NULL WHERE id = :id",
        { id: duplicate.id }
      );
    }
    await query(
      `UPDATE users
       SET username = :username,
           display_name = COALESCE(display_name, 'RETELA Admin'),
           email = COALESCE(email, 'administrator@retela.local'),
           password_hash = :passwordHash,
           role = 'admin',
           status = 'approved',
           is_verified = true
       WHERE id = :id`,
      { id: conflicts[0].id, username: adminUsername, passwordHash }
    );
  } else {
    await query(
      `INSERT INTO users (username, display_name, email, password_hash, role, status, is_verified)
       VALUES (:username, 'RETELA Admin', 'administrator@retela.local', :passwordHash, 'admin', 'approved', true)`,
      { username: adminUsername, passwordHash }
    );
  }
  const users = await query("SELECT id, username, display_name, email, role, status, is_verified, is_verified AS isVerified FROM users WHERE username = :username", { username: adminUsername });
  return users[0];
}

async function getAdministratorCount() {
  const rows = await query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  return Number(rows[0]?.count || 0);
}

async function findLoginUser(username) {
  const identifiers = getLoginIdentifiers(username).slice(0, 8);
  const placeholders = identifiers.map((_, index) => `:identifier${index}`).join(", ");
  const params = Object.fromEntries(identifiers.map((identifier, index) => [`identifier${index}`, identifier]));
  const users = await query(
    `SELECT id, username, display_name, email, password_hash, role, status, is_verified, is_verified AS isVerified
     FROM users
     WHERE username IN (${placeholders})
        OR email IN (${placeholders})
        OR phone_number IN (${placeholders})
     LIMIT 1`,
    params
  );
  return users[0];
}

function hideLoginReason() {
  throw new HttpError(401, "Invalid username or password.");
}

router.post("/register", asyncHandler(async (req, res) => {
  await ensurePhoneNumberColumn();
  const input = registerSchema.parse(req.body);
  if (isAdministratorCredential(input.username, input.password)) {
    if (await getAdministratorCount() > 0) {
      throw new HttpError(400, "Customer registration must use the verified RETELA KYC registration flow.");
    }
    const user = await getOrCreateAdministrator();
    return res.json({ token: signToken(user), user });
  }
  throw new HttpError(400, "Customer registration must use the verified RETELA KYC registration flow.");
  if (!isStrongPassword(input.password)) {
    throw new HttpError(400, "Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
  }
  const username = input.username;
  const email = input.email;
  const phoneNumber = normalizePhoneNumber(input.phone);

  const existingUsername = await query("SELECT id FROM users WHERE username = :username LIMIT 1", { username });
  if (existingUsername.length) {
    throw new HttpError(409, "Username already exists");
  }
  const existingEmail = await query("SELECT id FROM users WHERE email = :email LIMIT 1", { email });
  if (existingEmail.length) {
    throw new HttpError(409, "Email already exists");
  }
  const existingPhone = await query("SELECT id FROM users WHERE phone_number = :phoneNumber LIMIT 1", { phoneNumber });
  if (existingPhone.length) {
    throw new HttpError(409, "Phone number already exists");
  }
  const existingPending = await query(
    `SELECT id
     FROM users
     WHERE status IN ('pending_otp', 'pending')
       AND (username = :username OR email = :email OR phone_number = :phoneNumber)
     LIMIT 1`,
    { username, email, phoneNumber }
  );
  if (existingPending.length) {
    throw new HttpError(409, "This registration is already waiting for email OTP verification");
  }

  const passwordHash = await hashPassword(input.password);
  const otp = createOtp();
  const otpExpiresAt = getOtpExpiry();
  const result = await query(
    `INSERT INTO users (username, email, phone_number, location, password_hash, role, status, is_verified, otp_code, otp_expires_at)
     VALUES (:username, :email, :phoneNumber, :location, :passwordHash, 'customer', 'pending_otp', false, :otp, :otpExpiresAt)`,
    {
      username,
      email,
      phoneNumber,
      location: input.location || null,
      passwordHash,
      otp,
      otpExpiresAt
    }
  );
  const users = await query(
    `SELECT id, username, email, phone_number, location, status, created_at
     FROM users
     WHERE id = :id
     LIMIT 1`,
    { id: result.insertId }
  );
  const user = users[0];
  const registration = {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    phone: user.phone_number,
    phone_number: user.phone_number,
    location: user.location || "",
    status: user.status,
    created_at: user.created_at
  };
  console.log("[auth otp] sending registration OTP", { hasEmail: Boolean(email) });
  try {
    await sendOtpToContact(email, "email", otp);
  } catch (error) {
    console.error("Failed to send OTP with Resend:", {
      message: error?.message || null,
      code: error?.code || null,
      statusCode: error?.statusCode || error?.status || null
    });

    throw new HttpError(
      500,
      "Unable to send verification code. Please try again."
    );
  }
  console.log("[auth otp] OTP email successfully sent", { hasEmail: Boolean(email) });

  res.status(201).json({
    message: "Registration received. Enter the OTP sent to your email to activate your account.",
    registration
  });
}));

router.post("/verify-otp", asyncHandler(async (req, res) => {
  const schema = z.object({
    contact: contactSchema.optional(),
    phoneNumber: z.string().optional(),
    otp: z.string().length(6)
  }).refine((value) => (value.contact || value.phoneNumber || "").trim().length >= 7, {
    message: "Enter a phone number or email address",
    path: ["contact"]
  });
  const { contact: rawContact, phoneNumber: rawPhoneNumber, otp } = schema.parse(req.body);
  const contact = parseContact(rawContact || rawPhoneNumber || "");
  const users = await query(
    "SELECT id, username, otp_code, otp_expires_at FROM users WHERE (:phoneNumber IS NOT NULL AND phone_number = :phoneNumber) OR (:email IS NOT NULL AND email = :email)",
    { phoneNumber: contact.phoneNumber, email: contact.email }
  );
  if (!users.length) throw new HttpError(404, "Account not found");
  const user = users[0];
  if (user.otp_code !== otp || new Date(user.otp_expires_at) < new Date()) {
    throw new HttpError(400, "Invalid or expired OTP");
  }
  await query(
    "UPDATE users SET status = 'approved', is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = :id",
    { id: user.id }
  );
  res.json({ message: "Email verified. Your account is ready. You can log in now." });
}));

router.post("/resend-otp", asyncHandler(async (req, res) => {
  await ensurePhoneNumberColumn();
  const schema = z.object({ contact: contactSchema });
  const { contact: rawContact } = schema.parse(req.body);
  const contact = parseContact(rawContact);
  const users = await query(
    "SELECT id, status FROM users WHERE (:phoneNumber IS NOT NULL AND phone_number = :phoneNumber) OR (:email IS NOT NULL AND email = :email)",
    { phoneNumber: contact.phoneNumber, email: contact.email }
  );
  if (!users.length) throw new HttpError(404, "Account not found");
  if (users[0].status !== "pending_otp") throw new HttpError(400, "This account does not need OTP verification");
  const otp = createOtp();
  const otpExpiresAt = getOtpExpiry();
  await query("UPDATE users SET otp_code = :otp, otp_expires_at = :otpExpiresAt WHERE id = :id", {
    id: users[0].id,
    otp,
    otpExpiresAt
  });
  if (contact.channel !== "email") {
    throw new HttpError(400, "Customer registration OTP is sent by email. Enter your email address.");
  }
  await sendOtpToContact(contact.email, "email", otp);
  res.json({ message: "OTP sent to your email address." });
}));

const passwordResetOtpPurpose = "password_reset";

async function issuePasswordResetOtp(email) {
  await ensureVerificationTables();
  const users = await query("SELECT id FROM users WHERE email = :email LIMIT 1", { email });
  if (!users.length) return false;
  const latest = await query(
    `SELECT id, resend_available_at FROM otp_codes
     WHERE contact = :email AND purpose = :purpose AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    { email, purpose: passwordResetOtpPurpose }
  );
  if (latest[0] && new Date(latest[0].resend_available_at) > new Date()) throw new HttpError(429, "Please wait 60 seconds before requesting another OTP");
  if (latest[0]) await query("DELETE FROM otp_codes WHERE id = :id", { id: latest[0].id });

  const otp = createOtp();
  const otpId = (await query(
    `INSERT INTO otp_codes (contact, purpose, otp_code, expires_at, resend_available_at, max_attempts, max_resends)
     VALUES (:email, :purpose, :otp, :expiresAt, DATE_ADD(NOW(), INTERVAL 60 SECOND), 5, 3)`,
    { email, purpose: passwordResetOtpPurpose, otp: await hashPassword(otp), expiresAt: getOtpExpiry() }
  )).insertId;
  try {
    await sendOtpEmail(email, otp);
  } catch {
    await query("DELETE FROM otp_codes WHERE id = :id", { id: otpId }).catch(() => {});
    throw new HttpError(500, "Unable to send password reset code. Please try again.");
  }
  return true;
}

const passwordResetEmailSchema = z.object({ email: z.string().trim().email().max(160) });

router.post("/password-reset/request", asyncHandler(async (req, res) => {
  const { email: rawEmail } = passwordResetEmailSchema.parse(req.body);
  await issuePasswordResetOtp(rawEmail.toLowerCase());
  res.json({ message: "If an account uses that email, an OTP was sent to your email address." });
}));

router.post("/password-reset/resend", asyncHandler(async (req, res) => {
  const { email: rawEmail } = passwordResetEmailSchema.parse(req.body);
  await issuePasswordResetOtp(rawEmail.toLowerCase());
  res.json({ message: "If an account uses that email, a new OTP was sent to your email address." });
}));

router.post("/password-reset/verify", asyncHandler(async (req, res) => {
  await ensurePasswordResetColumns();
  const schema = passwordResetEmailSchema.extend({ otp: z.string().trim().regex(/^\d{6}$/) });
  const { email: rawEmail, otp } = schema.parse(req.body);
  const email = rawEmail.toLowerCase();
  const rows = await query(
    `SELECT id, otp_code, expires_at, attempts, max_attempts FROM otp_codes
     WHERE contact = :email AND purpose = :purpose AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    { email, purpose: passwordResetOtpPurpose }
  );
  const pending = rows[0];
  if (!pending || Number(pending.attempts || 0) >= Number(pending.max_attempts || 5) || new Date(pending.expires_at) < new Date()) throw new HttpError(400, "Invalid or expired OTP");
  if (!(await comparePassword(otp, pending.otp_code))) {
    await query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = :id", { id: pending.id });
    throw new HttpError(400, "Invalid or expired OTP");
  }
  await query("UPDATE otp_codes SET consumed_at = NOW(), attempts = attempts + 1 WHERE id = :id", { id: pending.id });
  await query("UPDATE users SET password_reset_verified_until = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE email = :email", { email });
  res.json({ message: "Email verified. You can now create a new password." });
}));

router.post("/password-reset/complete", asyncHandler(async (req, res) => {
  await ensurePasswordResetColumns();
  const schema = passwordResetEmailSchema.extend({ password: z.string().min(8) });
  const { email: rawEmail, password } = schema.parse(req.body);
  const email = rawEmail.toLowerCase();
  const users = await query("SELECT id, password_reset_verified_until FROM users WHERE email = :email LIMIT 1", { email });
  if (!users.length || !users[0].password_reset_verified_until || new Date(users[0].password_reset_verified_until) < new Date()) throw new HttpError(400, "Verify the OTP before changing your password");
  if (!isStrongPassword(password)) throw new HttpError(400, "Use a stronger password with 8+ characters, uppercase, lowercase, number, and symbol");
  await query("UPDATE users SET password_hash = :passwordHash, password_reset_verified_until = NULL WHERE id = :id", { id: users[0].id, passwordHash: await hashPassword(password) });
  res.json({ message: "Password reset successfully. You can log in now." });
}));

router.post("/login", asyncHandler(async (req, res) => {
  await ensurePhoneNumberColumn();
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
    captchaToken: z.string().trim().optional().default("")
  });
  const { username, password, captchaToken } = schema.parse(req.body);
  await verifyRecaptchaToken(captchaToken, req.ip);

  const user = await findLoginUser(username);
  if (!user && isAdministratorCredential(username, password) && await getAdministratorCount() === 0) {
    const user = await getOrCreateAdministrator();
    return res.json({ token: signToken(user), user });
  }
  if (!user) hideLoginReason();
  if (!user.password_hash) hideLoginReason();
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) hideLoginReason();
  if (!["admin", "staff"].includes(user.role) && (user.status === "pending_otp" || !user.is_verified)) {
    throw new HttpError(403, "Please verify your email before logging in.");
  }
  if (user.role !== "admin" && user.status !== "approved") hideLoginReason();

  delete user.password_hash;
  res.json({ token: signToken(user), user });
}));

router.get("/me", asyncHandler(async (req, res) => {
  res.json({ message: "Use /api/auth/login to authenticate." });
}));

export default router;
