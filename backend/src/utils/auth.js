import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value) {
  return bcryptHashPattern.test(String(value || ""));
}

export async function hashPassword(password) {
  if (isBcryptHash(password)) return password;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export const comparePassword = (password, hash) => bcrypt.compare(password, hash);

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, status: user.status },
    process.env.JWT_SECRET || "dev_secret_change_me",
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

export function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
