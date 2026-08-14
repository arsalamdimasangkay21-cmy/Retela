import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import { z } from "zod";
import { query, safeModifyColumn, transaction } from "../config/db.js";
import { UPLOAD_ROOT } from "../config/uploads.js";
import { comparePassword, createOtp, hashPassword, isBcryptHash } from "../utils/auth.js";
import { sendOtpEmail } from "../utils/email.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { createAdminNotification } from "../utils/adminNotifications.js";
import { readVerificationImageFile, verificationFileStatus } from "../utils/verificationFiles.js";

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
  await Promise.allSettled(paths.filter(Boolean).map((filePath) => {
    const relativePath = String(filePath).replace(/^\/+/, "").replace(/^uploads\/+/i, "");
    return fs.unlink(path.join(UPLOAD_ROOT, relativePath));
  }));
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
    throw new HttpError(400, Object.values(errors).find(Boolean) || "Please check your registration details.", errors);
  }
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
        government_id_data LONGBLOB NULL,
        government_id_mime VARCHAR(100) NULL,
        selfie_image VARCHAR(255) NULL,
        selfie_data LONGBLOB NULL,
        selfie_mime VARCHAR(100) NULL,
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
    const identityColumns = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'identity_verifications'
         AND COLUMN_NAME IN ('government_id_data','government_id_mime','selfie_data','selfie_mime')`
    );
    const identityColumnSet = new Set(identityColumns.map((row) => row.COLUMN_NAME));
    if (!identityColumnSet.has("government_id_data")) await query("ALTER TABLE identity_verifications ADD COLUMN government_id_data LONGBLOB NULL AFTER id_image");
    if (!identityColumnSet.has("government_id_mime")) await query("ALTER TABLE identity_verifications ADD COLUMN government_id_mime VARCHAR(100) NULL AFTER government_id_data");
    if (!identityColumnSet.has("selfie_data")) await query("ALTER TABLE identity_verifications ADD COLUMN selfie_data LONGBLOB NULL AFTER selfie_image");
    if (!identityColumnSet.has("selfie_mime")) await query("ALTER TABLE identity_verifications ADD COLUMN selfie_mime VARCHAR(100) NULL AFTER selfie_data");

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
        id_image_data LONGBLOB NULL,
        id_image_mime VARCHAR(100) NULL,
        selfie_image_path VARCHAR(255) NULL,
        selfie_image_data LONGBLOB NULL,
        selfie_image_mime VARCHAR(100) NULL,
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
         AND COLUMN_NAME IN ('resend_count','max_resends','id_image_data','id_image_mime','selfie_image_data','selfie_image_mime')`
    );
    const otpColumnSet = new Set(otpColumns.map((row) => row.COLUMN_NAME));
    if (!otpColumnSet.has("resend_count")) await query("ALTER TABLE otp_codes ADD COLUMN resend_count INT NOT NULL DEFAULT 0 AFTER max_attempts");
    if (!otpColumnSet.has("max_resends")) await query("ALTER TABLE otp_codes ADD COLUMN max_resends INT NOT NULL DEFAULT 3 AFTER resend_count");
    if (!otpColumnSet.has("id_image_data")) await query("ALTER TABLE otp_codes ADD COLUMN id_image_data LONGBLOB NULL AFTER id_image_path");
    if (!otpColumnSet.has("id_image_mime")) await query("ALTER TABLE otp_codes ADD COLUMN id_image_mime VARCHAR(100) NULL AFTER id_image_data");
    if (!otpColumnSet.has("selfie_image_data")) await query("ALTER TABLE otp_codes ADD COLUMN selfie_image_data LONGBLOB NULL AFTER selfie_image_path");
    if (!otpColumnSet.has("selfie_image_mime")) await query("ALTER TABLE otp_codes ADD COLUMN selfie_image_mime VARCHAR(100) NULL AFTER selfie_image_data");
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
  try {
    console.log("[registration otp] request received", {
      hasEmail: Boolean(req.body?.email),
      purpose: req.body?.purpose || "registration",
      hasIdImage: Boolean(req.files?.idImage?.[0]),
      hasSelfieImage: Boolean(req.files?.selfieImage?.[0]),
      hasIdType: Boolean(req.body?.idType),
      hasIdNumber: Boolean(req.body?.idNumber),
      selfieManualCaptureVerified: normalizeBoolean(req.body?.selfieBlinkVerified),
      governmentIdVerified: normalizeBoolean(req.body?.idQualityVerified)
    });

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
    if (Object.keys(errors).length) {
      console.warn("[registration otp] validation failed", { fields: Object.keys(errors), message: Object.values(errors).find(Boolean) });
    }
    throwValidationErrors(errors);

    const latest = await query(
      `SELECT id, resend_available_at, consumed_at, id_image_path, selfie_image_path
       FROM otp_codes
       WHERE contact = :email AND purpose = 'registration'
       ORDER BY id DESC
       LIMIT 1`,
      { email: input.email }
    );
    if (latest[0]?.consumed_at === null && new Date(latest[0].resend_available_at) > new Date()) {
      throw new HttpError(429, "Please wait 60 seconds before requesting another OTP");
    }
    if (latest[0]?.consumed_at === null) {
      await query(
        `DELETE FROM otp_codes
         WHERE contact = :email
           AND purpose = 'registration'
           AND consumed_at IS NULL`,
        { email: input.email }
      );
      await removeUploadedFiles([latest[0].id_image_path, latest[0].selfie_image_path]);
      console.log("[registration otp] previous pending OTP invalidated", { hasEmail: Boolean(input.email) });
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
    const idImagePath = null;
    const selfieImagePath = null;

    let insertedOtpId;
    try {
      const result = await query(
        `INSERT INTO otp_codes
          (contact,
           purpose,
           otp_code,
           expires_at,
           resend_available_at,
           max_resends,
           registration_payload,
           id_image_path,
           id_image_data,
           id_image_mime,
           selfie_image_path,
           selfie_image_data,
           selfie_image_mime,
           face_match_score)
         VALUES
          (:email,
           'registration',
           :otp,
           :expiresAt,
           :resendAvailableAt,
           :maxResends,
           :payload,
           :idImagePath,
           :idImageData,
           :idImageMime,
           :selfieImagePath,
           :selfieImageData,
           :selfieImageMime,
           :faceMatchScore)`,
        {
          email: input.email,
          otp: otpHash,
          expiresAt: getOtpExpiry(),
          resendAvailableAt: getResendAvailableAt(),
          maxResends: getOtpMaxResends(),
          payload: JSON.stringify(payload),
          idImagePath,
          idImageData: idImage.buffer,
          idImageMime: idImage.mimetype,
          selfieImagePath,
          selfieImageData: selfieImage.buffer,
          selfieImageMime: selfieImage.mimetype,
          faceMatchScore: input.faceMatchScore
        }
      );
      insertedOtpId = result.insertId;
      console.log("[registration otp] pending registration saved", { otpId: insertedOtpId, hasEmail: Boolean(input.email) });

      await sendOtpEmail(input.email, otp);
      logRegistrationEvent("OTP sent", { hasEmail: Boolean(input.email), otpId: insertedOtpId });
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
      success: true,
      message: "OTP generated successfully.",
      email: input.email,
      expiresInSeconds: getOtpTtlSeconds(),
      resendAfterSeconds: 60,
      maxAttempts: 5,
      maxResends: getOtpMaxResends()
    });
  } catch (error) {
    console.error("[registration otp] failed", {
      message: error.message,
      code: error.code,
      errno: error.errno,
      responseCode: error.responseCode,
      command: error.command,
      stack: error.stack
    });

    if (error instanceof HttpError && error.status < 500) {
      throw error;
    }

    if (error instanceof HttpError && [502, 503].includes(error.status)) {
      throw new HttpError(500, "Unable to send verification code. Please try again.");
    }

    throw error;
  }
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
    await sendOtpEmail(normalizedEmail, otp);
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
    message: "OTP resent to your email address.",
    expiresInSeconds: getOtpTtlSeconds(),
    resendAfterSeconds: 60,
    maxAttempts: Number(pending.max_attempts || 5),
    maxResends: Number(pending.max_resends ?? getOtpMaxResends()),
    resendsRemaining: Math.max(0, Number(pending.max_resends ?? getOtpMaxResends()) - Number(pending.resend_count || 0) - 1)
  });
});

async function getPendingVerificationImage(pending, { pathColumn, dataColumn, mimeColumn }) {
  const storedBuffer = pending[dataColumn];
  if (Buffer.isBuffer(storedBuffer) && storedBuffer.length > 0) {
    return {
      path: pending[pathColumn] || null,
      buffer: storedBuffer,
      mime: pending[mimeColumn] || "image/jpeg",
      source: "database"
    };
  }

  const file = await readVerificationImageFile(pending[pathColumn]);
  if (file.exists && file.buffer?.length) {
    return {
      path: pending[pathColumn] || null,
      buffer: file.buffer,
      mime: file.mime,
      source: "legacy_file"
    };
  }

  throw new HttpError(410, "Registration verification images are unavailable. Please restart registration.");
}

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
    const governmentIdImage = await getPendingVerificationImage(pending, {
      pathColumn: "id_image_path",
      dataColumn: "id_image_data",
      mimeColumn: "id_image_mime"
    });
    const selfieImage = await getPendingVerificationImage(pending, {
      pathColumn: "selfie_image_path",
      dataColumn: "selfie_image_data",
      mimeColumn: "selfie_image_mime"
    });

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
        (user_id,
         id_type,
         id_number,
         id_image,
         government_id_data,
         government_id_mime,
         selfie_image,
         selfie_data,
         selfie_mime,
         face_match_score,
         otp_verified,
         identity_verified)
       VALUES
        (:userId,
         :idType,
         :idNumber,
         :idImage,
         :governmentIdData,
         :governmentIdMime,
         :selfieImage,
         :selfieData,
         :selfieMime,
         :faceMatchScore,
         true,
         true)`,
      {
        userId: result.insertId,
        idType: payload.id_type,
        idNumber: payload.id_number,
        idImage: governmentIdImage.path,
        governmentIdData: governmentIdImage.buffer,
        governmentIdMime: governmentIdImage.mime,
        selfieImage: selfieImage.path,
        selfieData: selfieImage.buffer,
        selfieMime: selfieImage.mime,
        faceMatchScore: pending.face_match_score
      }
    );
    console.log("[verification image storage]", {
      verificationId: null,
      customerId: result.insertId,
      hasGovernmentId: true,
      governmentIdBytes: governmentIdImage.buffer.length,
      governmentIdSource: governmentIdImage.source,
      hasSelfie: true,
      selfieBytes: selfieImage.buffer.length,
      selfieSource: selfieImage.source
    });
    await run("UPDATE otp_codes SET consumed_at = NOW(), attempts = attempts + 1 WHERE id = :id", { id: pending.id });

    return {
      id: result.insertId,
      username: payload.username,
      email: payload.email,
      phone_number: payload.phone_number,
      status: "approved"
    };
  });

  await createAdminNotification({
    type: "registration",
    title: "New customer registration",
    body: `${createdUser.username} registered and is awaiting review.`,
    customerId: createdUser.id,
    app: req.app
  });

  res.status(201).json({
    message: "Email OTP verified. Your RETELA account is active and ready to use.",
    user: createdUser
  });
});

async function verificationImageMetadata(verification, kind) {
  const isSelfie = kind === "selfie";
  const bytesKey = isSelfie ? "selfie_bytes" : "government_id_bytes";
  const pathKey = isSelfie ? "selfie_image" : "id_image";
  const endpoint = verification.id ? `/identity-verifications/${verification.id}/${isSelfie ? "selfie" : "government-id"}` : null;
  const bytes = Number(verification[bytesKey] || 0);

  if (bytes > 0) {
    return {
      path: verification[pathKey] || null,
      exists: true,
      reason: null,
      source: "database",
      bytes,
      endpoint
    };
  }

  const file = await readVerificationImageFile(verification[pathKey]);
  if (file.exists && file.buffer?.length && verification.id) {
    await query(
      `UPDATE identity_verifications
       SET ${isSelfie ? "selfie_data" : "government_id_data"} = :imageData,
           ${isSelfie ? "selfie_mime" : "government_id_mime"} = :imageMime,
           updated_at = NOW()
       WHERE id = :id`,
      { id: verification.id, imageData: file.buffer, imageMime: file.mime }
    );
    console.log("[verification image storage]", {
      verificationId: verification.id,
      customerId: verification.user_id,
      migratedFromFile: true,
      kind,
      bytes: file.buffer.length
    });
    return {
      path: verification[pathKey] || null,
      exists: true,
      reason: null,
      source: "migrated_file",
      bytes: file.buffer.length,
      endpoint
    };
  }

  const status = verificationFileStatus(verification[pathKey]);
  return {
    path: status.path,
    exists: false,
    reason: status.reason || "FILE_MISSING",
    source: "missing",
    bytes: 0,
    endpoint: null
  };
}

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
    `SELECT id,
            user_id,
            id_type,
            id_number,
            id_image,
            OCTET_LENGTH(government_id_data) AS government_id_bytes,
            government_id_mime,
            selfie_image,
            OCTET_LENGTH(selfie_data) AS selfie_bytes,
            selfie_mime,
            face_match_score,
            otp_verified,
            identity_verified,
            created_at,
            updated_at
     FROM identity_verifications
     WHERE user_id = :id
     LIMIT 1`,
    { id: req.params.customerId }
  );
  const verification = verifications[0] || {};
  const governmentIdStatus = await verificationImageMetadata(verification, "government-id");
  const selfieStatus = await verificationImageMetadata(verification, "selfie");
  console.log("[verification paths]", {
    verificationId: verification.id || null,
    customerId: Number(req.params.customerId),
    governmentIdPath: governmentIdStatus.path,
    governmentIdExists: governmentIdStatus.exists,
    governmentIdBytes: governmentIdStatus.bytes || 0,
    selfiePath: selfieStatus.path,
    selfieExists: selfieStatus.exists,
    selfieBytes: selfieStatus.bytes || 0
  });
  res.json({
    user: users[0],
    verification: {
      id: verification.id || null,
      user_id: verification.user_id || Number(req.params.customerId),
      id_type: verification.id_type || "",
      id_number: verification.id_number || "",
      id_image: governmentIdStatus.exists ? verification.id_image || "" : "",
      selfie_image: selfieStatus.exists ? verification.selfie_image || "" : "",
      government_id_image: {
        path: governmentIdStatus.path,
        exists: governmentIdStatus.exists,
        reason: governmentIdStatus.reason,
        source: governmentIdStatus.source,
        bytes: governmentIdStatus.bytes,
        endpoint: governmentIdStatus.endpoint
      },
      selfie_verification_image: {
        path: selfieStatus.path,
        exists: selfieStatus.exists,
        reason: selfieStatus.reason,
        source: selfieStatus.source,
        bytes: selfieStatus.bytes,
        endpoint: selfieStatus.endpoint
      },
      face_match_score: verification.face_match_score ?? "",
      otp_verified: Boolean(verification.otp_verified),
      identity_verified: Boolean(verification.identity_verified),
      created_at: verification.created_at || "",
      updated_at: verification.updated_at || ""
    }
  });
});
