import jwt from "jsonwebtoken";
import { HttpError } from "../utils/errors.js";
import { query, safeModifyColumn } from "../config/db.js";
import { getJwtSecret } from "../utils/auth.js";

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
    await safeModifyColumn("users", "role", "role enum update", "ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
  })();
  return authUserColumnsReady;
}

function authDebug(req, message, details = {}, logger = console) {
  const method = req.method || "UNKNOWN";
  const route = req.originalUrl || req.url || "unknown route";
  logger.debug?.("[auth]", { method, route, message, ...details });
}

function bearerTokenFromHeader(header) {
  if (!header) throw new HttpError(401, "Missing Authorization header");
  const [scheme, token, ...extra] = String(header).trim().split(/\s+/);
  if (scheme !== "Bearer" || extra.length || !token) {
    throw new HttpError(401, "Invalid Authorization header format. Expected Bearer token.");
  }
  return token;
}

function verifyBearerToken(token, verifyToken) {
  try {
    return verifyToken(token);
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      throw new HttpError(401, "Token expired. Please log in again.");
    }
    throw new HttpError(401, "Invalid token. Please log in again.");
  }
}

export function createRequireAuth({
  queryFn = query,
  ensureColumns = ensureAuthUserColumns,
  verifyToken = (token) => jwt.verify(token, getJwtSecret()),
  logger = console
} = {}) {
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    authDebug(req, "Authorization header received", { hasAuthorizationHeader: Boolean(header) }, logger);

    try {
      const token = bearerTokenFromHeader(header);
      const payload = verifyBearerToken(token, verifyToken);
      authDebug(req, "Token verification succeeded", {
        userId: payload.id,
        role: payload.role || null
      }, logger);

      await ensureColumns();
      const users = await queryFn(
        "SELECT id, username, display_name, email, role, status, is_verified, is_verified AS isVerified FROM users WHERE id = :id",
        { id: payload.id }
      );
      if (!users.length) throw new HttpError(401, "Invalid token. Account no longer exists.");
      req.user = users[0];
      await queryFn("UPDATE users SET last_active_at = NOW() WHERE id = :id", { id: payload.id }).catch(() => {});
      next();
    } catch (error) {
      authDebug(req, "Authentication failed", {
        reason: error?.message || "Unauthorized"
      }, logger);
      next(error instanceof HttpError ? error : new HttpError(401, "Unauthorized"));
    }
  };
}

export const requireAuth = createRequireAuth();

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
