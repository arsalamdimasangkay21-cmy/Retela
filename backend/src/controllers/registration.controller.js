import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { query, safeModifyColumn, transaction } from "../config/db.js";
import { comparePassword, createOtp, hashPassword, isBcryptHash } from "../utils/auth.js";
import { sendEmail } from "../utils/email.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "../../uploads");

let verificationTablesReady;

const allowedIdTypes = [
  "National ID",
  "Passport",
  "Driver's License",
  "PhilHealth ID",
  "UMID",
  "Postal ID",
  "PRC ID",
  "Voter's ID"
];

const fieldMessages = {
  usernameTaken: "Username already exists.",
  emailTaken: "Email already exists.",
  phoneTaken: "Phone number already exists.",
  idTaken: "Government ID already exists."
};

const completeRegistrationSchema = z.object({
  email: z.string().trim().email().max(160),
  otp: z.string().trim().regex(/^\d{6}$/)
});

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || "").replace(/\D/g, "");
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === "1" || value === "on";
}

function normalizeRegistrationInput(body = {}) {
  const faceMatchScore = Number(body.faceMatchScore);
  return {
    username: String(body.username || "").trim(),
    displayName: String(body.displayName || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    phone: normalizePhoneNumber(body.phone),
    location: String(body.location || "").trim(),
    birthday: String(body.birthday || "").trim(),
    gender: String(body.gender || "").trim(),
    password: String(body.password || ""),
    confirmPassword: String(body.confirmPassword || ""),
    accepted: normalizeBoolean(body.accepted),
    idType: String(body.idType || "").trim(),
    idNumber: String(body.idNumber || "").trim(),
    selfieBlinkVerified: normalizeBoolean(body.selfieBlinkVerified),
    selfieLiveCapture: normalizeBoolean(body.selfieLiveCapture),
    idQualityVerified: normalizeBoolean(body.idQualityVerified),
    idLiveCapture: normalizeBoolean(body.idLiveCapture),
    faceMatchScore: Number.isFinite(faceMatchScore) ? faceMatchScore : 100
  };
}

function getOtpExpiry() {
  return new Date(Date.now() + getOtpTtlMinutes() * 60 * 1000);
}

function getOtpTtlMinutes() {
  const value = Number(process.env.OTP_TTL_MINUTES || 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

function getOtpTtlSeconds() {
  return getOtpTtlMinutes() * 60;
}

function getOtpMaxResends() {
  const value = Number(process.env.OTP_MAX_RESENDS || 3);
  return Number.isFinite(value) && value >= 0 ? value : 3;
}

function getResendAvailableAt() {
  return new Date(Date.now() + 60 * 1000);
}

function logRegistrationEvent(message, details = {}) {
  console.log(`[registration] ${message}`, details);
}

async function cleanupExpiredRegistrationOtps() {
  const expired = await query(
    `SELECT id_image_path, selfie_image_path
     FROM otp_codes
     WHERE purpose = 'registration'
       AND consumed_at IS NULL
       AND expires_at < NOW()`
  ).catch((error) => {
    console.warn(`[registration] Expired OTP lookup skipped: ${error.message}`);
    return [];
  });

  await query(
    `DELETE FROM otp_codes
     WHERE purpose = 'registration'
       AND (
         expires_at < NOW()
         OR (consumed_at IS NOT NULL AND consumed_at < DATE_SUB(NOW(), INTERVAL 1 DAY))
       )`
  ).catch((error) => {
    console.warn(`[registration] Expired OTP cleanup skipped: ${error.message}`);
  });

  await removeUploadedFiles(expired.flatMap((row) => [row.id_image_path, row.selfie_image_path]));
}

async function removeUploadedFiles(paths = []) {
  await Promise.allSettled(paths.filter(Boolean).map((filePath) => fs.unlink(path.join(__dirname, "../..", filePath.replace(/^\/+/, "")))));
}

async function otpMatches(inputOtp, storedOtp) {
  if (!storedOtp) return false;
  if (isBcryptHash(storedOtp)) return comparePassword(inputOtp, storedOtp);
  return storedOtp === inputOtp;
}

function normalizeBirthday(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return value.slice(0, 10);
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

function addBaseValidationErrors(input, errors, { includeIdentity = false } = {}) {
  if (!input.username) errors.username = "Username is required.";
  else if (input.username.length < 4 || input.username.length > 20) errors.username = "Username must be between 4 and 20 characters.";
  else if (!/^[A-Za-z0-9_]+$/.test(input.username)) errors.username = "Username contains invalid characters.";

  if (!input.displayName) errors.displayName = "Display Name is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.email = "Invalid email address.";
  if (!/^09\d{9}$/.test(input.phone)) errors.phone = "Invalid phone number.";
  if (!input.location) errors.location = "Location is required.";
  if (!input.birthday || !normalizeBirthday(input.birthday)) errors.birthday = "Birthday is required.";
  if (!input.gender) errors.gender = "Gender is required.";

  if (!input.password) errors.password = "Password is required.";
  else if (input.password.length < 8) errors.password = "Password must contain at least 8 characters.";
  else if (!isStrongPassword(input.password)) {
    errors.password = "Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.";
  }

  if (!input.confirmPassword || input.password !== input.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  if (!input.accepted) errors.accepted = "Please accept the Terms & Conditions.";

  if (includeIdentity) {
    if (!allowedIdTypes.includes(input.idType)) errors.idType = "Government ID type is required.";
    if (!input.idNumber || input.idNumber.length < 3) errors.idNumber = "Government ID number is required.";
    if (!input.selfieBlinkVerified) errors.selfieImage = "Please complete face recognition.";
    if (!input.selfieLiveCapture) errors.selfieImage = "Manual camera selfie capture is required.";
    if (!input.idQualityVerified) errors.idImage = "Please capture a clear government ID image.";
    if (input.faceMatchScore < 40 || input.faceMatchScore > 100) errors.selfieImage = "Face verification confidence is too low. Please recapture your selfie.";
  }
}

async function addDuplicateErrors(input, errors, run = query) {
  if (!errors.username || !errors.email || !errors.phone) {
    const rows = await run(
      `SELECT username, email, phone_number
       FROM users
       WHERE username = :username OR email = :email OR phone_number = :phoneNumber`,
      { username: input.username, email: input.email, phoneNumber: input.phone }
    );
    for (const row of rows) {
      if (row.username === input.username) errors.username = fieldMessages.usernameTaken;
      if (row.email === input.email) errors.email = fieldMessages.emailTaken;
      if (row.phone_number === input.phone) errors.phone = fieldMessages.phoneTaken;
    }
  }

  if (input.idNumber && !errors.idNumber) {
    const idRows = await run(
      "SELECT id FROM identity_verifications WHERE id_number = :idNumber LIMIT 1",
      { idNumber: input.idNumber }
    );
    if (idRows.length) errors.idNumber = fieldMessages.idTaken;
  }
}

async function getRegistrationErrors(body, options = {}) {
  const input = normalizeRegistrationInput(body);
  const errors = {};
  addBaseValidationErrors(input, errors, options);
  await addDuplicateErrors(input, errors, options.run || query);
  return { input, errors };
}

function throwValidationErrors(errors) {
  if (Object.keys(errors).length) {
    throw new HttpError(400, "Registration validation failed.", errors);
  }
}

async function saveBufferedUpload(file) {
  await fs.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return `/uploads/${filename}`;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function getImageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), type: "image/jpeg" };
      }
      offset += 2 + Math.max(length, 2);
    }
    return { width: 0, height: 0, type: "image/jpeg" };
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: "image/png" };
  }

  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        type: "image/webp"
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, type: "image/webp" };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, type: "image/webp" };
    }
    return { width: 0, height: 0, type: "image/webp" };
  }

  return null;
}

function addImageValidationError(file, errors, field, label, { minWidth, minHeight }) {
  if (!file?.buffer?.length) {
    errors[field] = `${label} image is required.`;
    return;
  }
  const dimensions = getImageDimensions(file.buffer);
  if (!dimensions || dimensions.type !== file.mimetype) {
    errors[field] = `${label} must be a valid JPG, PNG, or WebP image.`;
    return;
  }
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    errors[field] = `${label} image is too small. Please recapture a clear image.`;
  }
}

export async function ensureVerificationTables() {
  verificationTablesReady ||= (async () => {
    await safeModifyColumn("users", "email", "email nullable update", "ALTER TABLE users MODIFY email VARCHAR(160) NULL");
    await safeModifyColumn("users", "status", "status enum update", "ALTER TABLE users MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp'");
    const userRows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('display_name','phone_number','location','birthday','gender','is_verified')`
    );
    const userColumns = new Set(userRows.map((row) => row.COLUMN_NAME));
    if (!userColumns.has("display_name")) await query("ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER username");
    if (!userColumns.has("phone_number")) await query("ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL UNIQUE AFTER email");
    if (!userColumns.has("location")) await query("ALTER TABLE users ADD COLUMN location VARCHAR(255) NULL AFTER phone_number");
    if (!userColumns.has("birthday")) await query("ALTER TABLE users ADD COLUMN birthday DATE NULL AFTER location");
    if (!userColumns.has("gender")) await query("ALTER TABLE users ADD COLUMN gender VARCHAR(40) NULL AFTER birthday");
    if (!userColumns.has("is_verified")) {
      await query("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false AFTER status");
      await query("UPDATE users SET is_verified = true WHERE role IN ('admin','staff') OR status = 'approved'");
    }

    await query(
      `CREATE TABLE IF NOT EXISTS identity_verifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        id_type VARCHAR(80) NOT NULL,
        id_number VARCHAR(120) NOT NULL,
        id_image VARCHAR(255) NULL,
        selfie_image VARCHAR(255) NULL,
        face_match_score DECIMAL(5,2) NOT NULL DEFAULT 0,
        otp_verified BOOLEAN NOT NULL DEFAULT false,
        identity_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_identity_user (user_id),
        UNIQUE KEY uq_identity_id_number (id_number),
        CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    );

    const indexes = await query(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'identity_verifications'
       GROUP BY INDEX_NAME`
    );
    const hasIdNumberIndex = indexes.some((row) => row.INDEX_NAME === "uq_identity_id_number" || row.COLUMNS === "id_number");
    if (!hasIdNumberIndex) {
      await query("ALTER TABLE identity_verifications ADD UNIQUE KEY uq_identity_id_number (id_number)").catch((error) => {
        console.warn(`[schema bootstrap] Skipping identity_verifications id_number unique key: ${error.message}`);
      });
    }

    await query(
      `CREATE TABLE IF NOT EXISTS otp_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contact VARCHAR(160) NOT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT 'registration',
        otp_code VARCHAR(100) NOT NULL,
        expires_at DATETIME NOT NULL,
        resend_available_at DATETIME NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        resend_count INT NOT NULL DEFAULT 0,
        max_resends INT NOT NULL DEFAULT 3,
        consumed_at DATETIME NULL,
        registration_payload JSON NULL,
        id_image_path VARCHAR(255) NULL,
        selfie_image_path VARCHAR(255) NULL,
        face_match_score DECIMAL(5,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_otp_contact_purpose (contact, purpose),
        INDEX idx_otp_expires (expires_at)
      )`
    );
    await safeModifyColumn("otp_codes", "otp_code", "otp_code hash length update", "ALTER TABLE otp_codes MODIFY otp_code VARCHAR(100) NOT NULL");

    const otpColumns = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'otp_codes'
         AND COLUMN_NAME IN ('resend_count','max_resends')`
    );
    const otpColumnSet = new Set(otpColumns.map((row) => row.COLUMN_NAME));
    if (!otpColumnSet.has("resend_count")) await query("ALTER TABLE otp_codes ADD COLUMN resend_count INT NOT NULL DEFAULT 0 AFTER max_attempts");
    if (!otpColumnSet.has("max_resends")) await query("ALTER TABLE otp_codes ADD COLUMN max_resends INT NOT NULL DEFAULT 3 AFTER resend_count");
  })().catch((error) => {
    verificationTablesReady = undefined;
    throw error;
  });
  return verificationTablesReady;
}

export const validateRegistration = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  const { errors } = await getRegistrationErrors(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, errors });
  }
  res.json({ success: true, errors: {} });
});

export const checkRegistrationField = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  const field = String(req.body.field || "");
  const value = String(req.body.value || "").trim();
  const errors = {};

  if (field === "username") {
    if (value.length < 4 || value.length > 20) errors.username = "Username must be between 4 and 20 characters.";
    else if (!/^[A-Za-z0-9_]+$/.test(value)) errors.username = "Username contains invalid characters.";
    else if ((await query("SELECT id FROM users WHERE username = :value LIMIT 1", { value })).length) errors.username = fieldMessages.usernameTaken;
  } else if (field === "email") {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Invalid email address.";
    else if ((await query("SELECT id FROM users WHERE email = :email LIMIT 1", { email })).length) errors.email = fieldMessages.emailTaken;
  } else if (field === "phone") {
    const phone = normalizePhoneNumber(value);
    if (!/^09\d{9}$/.test(phone)) errors.phone = "Invalid phone number.";
    else if ((await query("SELECT id FROM users WHERE phone_number = :phone LIMIT 1", { phone })).length) errors.phone = fieldMessages.phoneTaken;
  } else if (field === "idNumber") {
    if (value.length < 3) errors.idNumber = "Government ID number is required.";
    else if ((await query("SELECT id FROM identity_verifications WHERE id_number = :value LIMIT 1", { value })).length) errors.idNumber = fieldMessages.idTaken;
  } else {
    throw new HttpError(400, "Invalid validation field.");
  }

  if (Object.keys(errors).length) return res.status(409).json({ success: false, errors });
  res.json({ success: true, errors: {} });
});

export const sendRegistrationOtp = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  await cleanupExpiredRegistrationOtps();
  const { input, errors } = await getRegistrationErrors(req.body, { includeIdentity: true });
  const idImage = req.files?.idImage?.[0];
  const selfieImage = req.files?.selfieImage?.[0];
  if (!idImage) errors.idImage = "Government ID image is required.";
  if (!selfieImage) errors.selfieImage = "Selfie image is required.";
  addImageValidationError(idImage, errors, "idImage", "Government ID", { minWidth: 720, minHeight: 420 });
  addImageValidationError(selfieImage, errors, "selfieImage", "Selfie", { minWidth: 480, minHeight: 480 });
  if (idImage?.buffer && selfieImage?.buffer && sha256(idImage.buffer) === sha256(selfieImage.buffer)) {
    errors.idImage = "Government ID image must be different from the selfie.";
  }
  throwValidationErrors(errors);

  const latest = await query(
    `SELECT id, resend_available_at, consumed_at
     FROM otp_codes
     WHERE contact = :email AND purpose = 'registration'
     ORDER BY id DESC
     LIMIT 1`,
    { email: input.email }
  );
  if (latest[0]?.consumed_at === null && new Date(latest[0].resend_available_at) > new Date()) {
    throw new HttpError(429, "Please wait 60 seconds before requesting another OTP");
  }

  const otp = createOtp();
  const otpHash = await hashPassword(otp);
  const payload = {
    username: input.username,
    display_name: input.displayName,
    email: input.email,
    phone_number: input.phone,
    location: input.location,
    birthday: normalizeBirthday(input.birthday),
    gender: input.gender,
    password_hash: await hashPassword(input.password),
    id_type: input.idType,
    id_number: input.idNumber
  };
  const [idImagePath, selfieImagePath] = await Promise.all([
    saveBufferedUpload(idImage),
    saveBufferedUpload(selfieImage)
  ]);

  let insertedOtpId;
  try {
    const result = await query(
      `INSERT INTO otp_codes
        (contact, purpose, otp_code, expires_at, resend_available_at, max_resends, registration_payload, id_image_path, selfie_image_path, face_match_score)
       VALUES
        (:email, 'registration', :otp, :expiresAt, :resendAvailableAt, :maxResends, :payload, :idImage, :selfieImage, :faceMatchScore)`,
      {
        email: input.email,
        otp: otpHash,
        expiresAt: getOtpExpiry(),
        resendAvailableAt: getResendAvailableAt(),
        maxResends: getOtpMaxResends(),
        payload: JSON.stringify(payload),
        idImage: idImagePath,
        selfieImage: selfieImagePath,
        faceMatchScore: input.faceMatchScore
      }
    );
    insertedOtpId = result.insertId;

    await sendEmail(
      input.email,
      "Your RETELA verification OTP",
      `Your RETELA OTP is ${otp}. It expires in ${getOtpTtlMinutes()} minutes.`
    );
    logRegistrationEvent("OTP sent", { email: input.email, otpId: insertedOtpId });
  } catch (err) {
    if (insertedOtpId) {
      await query("DELETE FROM otp_codes WHERE id = :id", { id: insertedOtpId }).catch((error) => {
        console.warn(`[registration] OTP rollback skipped: ${error.message}`);
      });
    }
    await removeUploadedFiles([idImagePath, selfieImagePath]);
    throw err;
  }

  res.status(201).json({
    message: "OTP generated successfully.",
    email: input.email,
    expiresInSeconds: getOtpTtlSeconds(),
    resendAfterSeconds: 60,
    maxAttempts: 5,
    maxResends: getOtpMaxResends()
  });
});

export const resendRegistrationOtp = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  await cleanupExpiredRegistrationOtps();
  const { email } = z.object({ email: z.string().trim().email().max(160) }).parse(req.body);
  const normalizedEmail = email.toLowerCase();
  const rows = await query(
    `SELECT *
     FROM otp_codes
     WHERE contact = :email AND purpose = 'registration'
     ORDER BY id DESC
     LIMIT 1`,
    { email: normalizedEmail }
  );
  const pending = rows[0];
  if (!pending || pending.consumed_at) throw new HttpError(404, "Pending registration OTP not found");
  if (new Date(pending.resend_available_at) > new Date()) {
    throw new HttpError(429, "Please wait 60 seconds before requesting another OTP");
  }
  if (Number(pending.resend_count || 0) >= Number(pending.max_resends ?? getOtpMaxResends())) {
    throw new HttpError(429, "Maximum OTP resends reached. Please restart registration.");
  }

  const payload = typeof pending.registration_payload === "string"
    ? JSON.parse(pending.registration_payload)
    : pending.registration_payload;
  const errors = {};
  await addDuplicateErrors({
    username: payload.username,
    email: payload.email,
    phone: payload.phone_number,
    idNumber: payload.id_number
  }, errors);
  throwValidationErrors(errors);

  const otp = createOtp();
  const otpHash = await hashPassword(otp);
  const expiresAt = getOtpExpiry();
  const resendAvailableAt = getResendAvailableAt();
  try {
    await query(
      `UPDATE otp_codes
       SET otp_code = :otp,
           expires_at = :expiresAt,
           resend_available_at = :resendAvailableAt,
           attempts = 0,
           resend_count = resend_count + 1
       WHERE id = :id`,
      { id: pending.id, otp: otpHash, expiresAt, resendAvailableAt }
    );
    await sendEmail(normalizedEmail, "Your RETELA verification OTP", `Your RETELA OTP is ${otp}. It expires in ${getOtpTtlMinutes()} minutes.`);
  } catch (error) {
    await query(
      `UPDATE otp_codes
       SET otp_code = :otp,
           expires_at = :expiresAt,
           resend_available_at = :resendAvailableAt,
           attempts = :attempts,
           resend_count = :resendCount
       WHERE id = :id`,
      {
        id: pending.id,
        otp: pending.otp_code,
        expiresAt: pending.expires_at,
        resendAvailableAt: pending.resend_available_at,
        attempts: Number(pending.attempts || 0),
        resendCount: Number(pending.resend_count || 0)
      }
    ).catch((restoreError) => {
      console.warn(`[registration] OTP resend rollback skipped: ${restoreError.message}`);
    });
    throw error;
  }
  logRegistrationEvent("OTP resent", { email: normalizedEmail, otpId: pending.id, resendCount: Number(pending.resend_count || 0) + 1 });
  res.json({
    message: "OTP resent to your Gmail address.",
    expiresInSeconds: getOtpTtlSeconds(),
    resendAfterSeconds: 60,
    maxAttempts: Number(pending.max_attempts || 5),
    maxResends: Number(pending.max_resends ?? getOtpMaxResends()),
    resendsRemaining: Math.max(0, Number(pending.max_resends ?? getOtpMaxResends()) - Number(pending.resend_count || 0) - 1)
  });
});

export const completeRegistration = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  const input = completeRegistrationSchema.parse(req.body);
  const email = input.email.toLowerCase();

  const precheckRows = await query(
    `SELECT id, consumed_at, attempts, max_attempts, expires_at, otp_code
     FROM otp_codes
     WHERE contact = :email AND purpose = 'registration'
     ORDER BY id DESC
     LIMIT 1`,
    { email }
  );
  const precheck = precheckRows[0];
  if (!precheck || precheck.consumed_at) throw new HttpError(404, "Pending registration OTP not found");
  if (Number(precheck.attempts || 0) >= Number(precheck.max_attempts || 5)) {
    throw new HttpError(429, "Maximum OTP attempts reached. Please resend a new OTP.");
  }
  if (new Date(precheck.expires_at) < new Date()) throw new HttpError(400, "OTP expired. Please resend a new OTP.");
  if (!(await otpMatches(input.otp, precheck.otp_code))) {
    await query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = :id", { id: precheck.id });
    throw new HttpError(400, "Invalid OTP");
  }

  const createdUser = await transaction(async (run) => {
    const rows = await run(
      `SELECT *
       FROM otp_codes
       WHERE id = :id AND purpose = 'registration'
       LIMIT 1
       FOR UPDATE`,
      { id: precheck.id }
    );
    const pending = rows[0];
    if (!pending || pending.consumed_at) throw new HttpError(404, "Pending registration OTP not found");
    if (Number(pending.attempts || 0) >= Number(pending.max_attempts || 5)) {
      throw new HttpError(429, "Maximum OTP attempts reached. Please resend a new OTP.");
    }
    if (new Date(pending.expires_at) < new Date()) throw new HttpError(400, "OTP expired. Please resend a new OTP.");
    if (!(await otpMatches(input.otp, pending.otp_code))) throw new HttpError(400, "Invalid OTP");

    const payload = typeof pending.registration_payload === "string"
      ? JSON.parse(pending.registration_payload)
      : pending.registration_payload;
    const errors = {};
    await addDuplicateErrors({
      username: payload.username,
      email: payload.email,
      phone: payload.phone_number,
      idNumber: payload.id_number
    }, errors, run);
    throwValidationErrors(errors);

    const result = await run(
      `INSERT INTO users
        (username, display_name, email, phone_number, location, birthday, gender, password_hash, role, status, is_verified, otp_code, otp_expires_at)
       VALUES
        (:username, :displayName, :email, :phoneNumber, :location, :birthday, :gender, :passwordHash, 'customer', 'approved', true, NULL, NULL)`,
      {
        username: payload.username,
        displayName: payload.display_name,
        email: payload.email,
        phoneNumber: payload.phone_number,
        location: payload.location,
        birthday: payload.birthday,
        gender: payload.gender,
        passwordHash: payload.password_hash
      }
    );

    await run(
      `INSERT INTO identity_verifications
        (user_id, id_type, id_number, id_image, selfie_image, face_match_score, otp_verified, identity_verified)
       VALUES
        (:userId, :idType, :idNumber, :idImage, :selfieImage, :faceMatchScore, true, true)`,
      {
        userId: result.insertId,
        idType: payload.id_type,
        idNumber: payload.id_number,
        idImage: pending.id_image_path,
        selfieImage: pending.selfie_image_path,
        faceMatchScore: pending.face_match_score
      }
    );
    await run("UPDATE otp_codes SET consumed_at = NOW(), attempts = attempts + 1 WHERE id = :id", { id: pending.id });

    return {
      id: result.insertId,
      username: payload.username,
      email: payload.email,
      phone_number: payload.phone_number,
      status: "approved"
    };
  });

  res.status(201).json({
    message: "Email OTP verified. Your RETELA account is active and ready to use.",
    user: createdUser
  });
});

export const getCustomerDocuments = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
  if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  const users = await query(
    `SELECT id, username, display_name, email, phone_number, location, birthday, gender, created_at, last_active_at, status
     FROM users
     WHERE id = :id AND role = 'customer'
     LIMIT 1`,
    { id: req.params.customerId }
  );
  if (!users.length) throw new HttpError(404, "Customer account not found");
  const verifications = await query(
    `SELECT id_type, id_number, id_image, selfie_image, face_match_score, otp_verified, identity_verified, created_at, updated_at
     FROM identity_verifications
     WHERE user_id = :id
     LIMIT 1`,
    { id: req.params.customerId }
  );
  const verification = verifications[0] || {};
  res.json({
    user: users[0],
    verification: {
      id_type: verification.id_type || "",
      id_number: verification.id_number || "",
      id_image: verification.id_image || "",
      selfie_image: verification.selfie_image || "",
      face_match_score: verification.face_match_score ?? "",
      otp_verified: Boolean(verification.otp_verified),
      identity_verified: Boolean(verification.identity_verified),
      created_at: verification.created_at || "",
      updated_at: verification.updated_at || ""
    }
  });
});
