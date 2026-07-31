import jwt from "jsonwebtoken";
import { HttpError } from "../utils/errors.js";
import { query } from "../config/db.js";

let authUserColumnsReady;

async function ensureAuthUserColumns() {
  authUserColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('display_name', 'is_verified')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("display_name")) {
      await query("ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER username");
    }
    if (!columns.has("is_verified")) {
      await query("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false AFTER status");
      await query("UPDATE users SET is_verified = true WHERE role IN ('admin','staff') OR status = 'approved'");
    }
    await query("ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
  })();
  return authUserColumnsReady;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "Missing token");

    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_me");
    await ensureAuthUserColumns();
    const users = await query(
      "SELECT id, username, display_name, email, role, status, is_verified, is_verified AS isVerified FROM users WHERE id = :id",
      { id: payload.id }
    );
    if (!users.length) throw new HttpError(401, "Invalid token");
    req.user = users[0];
    await query("UPDATE users SET last_active_at = NOW() WHERE id = :id", { id: payload.id }).catch(() => {});
    next();
  } catch (error) {
    next(new HttpError(401, "Unauthorized"));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return next(new HttpError(403, "Forbidden"));
    next();
  };
}

export function requireApproved(req, res, next) {
  if (req.user?.role === "admin" || req.user?.role === "staff") return next();
  if (req.user?.status !== "approved" || !req.user?.is_verified) {
    return next(new HttpError(403, "Verify your email OTP before using this feature"));
  }
  next();
}
