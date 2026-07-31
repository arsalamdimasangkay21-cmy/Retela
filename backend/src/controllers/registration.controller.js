import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { query, transaction } from "../config/db.js";
import { createOtp, hashPassword } from "../utils/auth.js";
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
    faceMatchScore: Number.isFinite(faceMatchScore) ? faceMatchScore : 100
  };
}

function getOtpExpiry() {
  return new Date(Date.now() + 5 * 60 * 1000);
}

function getResendAvailableAt() {
  return new Date(Date.now() + 60 * 1000);
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

export async function ensureVerificationTables() {
  verificationTablesReady ||= (async () => {
    await query("ALTER TABLE users MODIFY email VARCHAR(160) NULL");
    await query("ALTER TABLE users MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp'");
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
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'identity_verifications'
         AND INDEX_NAME = 'uq_identity_id_number'
       LIMIT 1`
    );
    if (!indexes.length) {
      await query("ALTER TABLE identity_verifications ADD UNIQUE KEY uq_identity_id_number (id_number)");
    }

    await query(
      `CREATE TABLE IF NOT EXISTS otp_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contact VARCHAR(160) NOT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT 'registration',
        otp_code VARCHAR(6) NOT NULL,
        expires_at DATETIME NOT NULL,
        resend_available_at DATETIME NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
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
  const { input, errors } = await getRegistrationErrors(req.body, { includeIdentity: true });
  const idImage = req.files?.idImage?.[0];
  const selfieImage = req.files?.selfieImage?.[0];
  if (!idImage) errors.idImage = "Government ID image is required.";
  if (!selfieImage) errors.selfieImage = "Selfie image is required.";
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

  await query(
    `INSERT INTO otp_codes
      (contact, purpose, otp_code, expires_at, resend_available_at, registration_payload, id_image_path, selfie_image_path, face_match_score)
     VALUES
      (:email, 'registration', :otp, :expiresAt, :resendAvailableAt, :payload, :idImage, :selfieImage, :faceMatchScore)`,
    {
      email: input.email,
      otp,
      expiresAt: getOtpExpiry(),
      resendAvailableAt: getResendAvailableAt(),
      payload: JSON.stringify(payload),
      idImage: idImagePath,
      selfieImage: selfieImagePath,
      faceMatchScore: input.faceMatchScore
    }
  );

  await sendEmail(input.email, "Your RETELA verification OTP", `Your RETELA OTP is ${otp}. It expires in 5 minutes.`);
  res.status(201).json({
    message: "Enter the OTP sent to your Gmail address.",
    email: input.email,
    expiresInSeconds: 300,
    resendAfterSeconds: 60,
    maxAttempts: 5
  });
});

export const resendRegistrationOtp = asyncHandler(async (req, res) => {
  await ensureVerificationTables();
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
  await query(
    `UPDATE otp_codes
     SET otp_code = :otp,
         expires_at = :expiresAt,
         resend_available_at = :resendAvailableAt,
         attempts = 0
     WHERE id = :id`,
    { id: pending.id, otp, expiresAt: getOtpExpiry(), resendAvailableAt: getResendAvailableAt() }
  );
  await sendEmail(normalizedEmail, "Your RETELA verification OTP", `Your RETELA OTP is ${otp}. It expires in 5 minutes.`);
  res.json({ message: "OTP resent to your Gmail address.", resendAfterSeconds: 60 });
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
  if (precheck.otp_code !== input.otp) {
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
    if (pending.otp_code !== input.otp) throw new HttpError(400, "Invalid OTP");

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
