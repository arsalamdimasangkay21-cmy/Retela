import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import "../env.js";

const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const fallbackJwtSecret = "dev_secret_change_me";
let jwtSecretWarningLogged = false;

export function isBcryptHash(value) {
  return bcryptHashPattern.test(String(value || ""));
}

export async function hashPassword(password) {
  if (isBcryptHash(password)) return password;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export const comparePassword = (password, hash) => bcrypt.compare(password, hash);

export function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (secret) return secret;

  if (!jwtSecretWarningLogged) {
    console.warn("[auth] JWT_SECRET is not configured; using development fallback secret.");
    jwtSecretWarningLogged = true;
  }
  return fallbackJwtSecret;
}

export function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN || "7d";
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, status: user.status },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() }
  );
}

export function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}
