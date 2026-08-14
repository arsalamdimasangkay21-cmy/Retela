import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { UPLOAD_ROOT } from "../config/uploads.js";
import { HttpError } from "./errors.js";

const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

const extensionTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

function normalizeStoredVerificationPath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return "";
  return raw.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\/+/i, "");
}

export function resolveVerificationPath(value) {
  const relativePath = normalizeStoredVerificationPath(value);
  if (!relativePath) return { relativePath: "", resolvedPath: "", valid: false, reason: "NO_PATH" };
  if (relativePath.split("/").includes("..")) return { relativePath, resolvedPath: "", valid: false, reason: "INVALID_PATH" };

  const root = path.resolve(UPLOAD_ROOT);
  const resolvedPath = path.resolve(root, relativePath);
  const rootWithSeparator = `${root}${path.sep}`;
  if (resolvedPath !== root && !resolvedPath.startsWith(rootWithSeparator)) {
    return { relativePath, resolvedPath: "", valid: false, reason: "INVALID_PATH" };
  }
  return { relativePath, resolvedPath, valid: true, reason: "" };
}

export function verificationFileStatus(value) {
  const resolved = resolveVerificationPath(value);
  if (!resolved.valid) {
    return {
      path: resolved.relativePath || null,
      exists: false,
      reason: resolved.reason
    };
  }
  const exists = fs.existsSync(resolved.resolvedPath);
  return {
    path: resolved.relativePath,
    exists,
    reason: exists ? null : "FILE_MISSING"
  };
}

export function sendVerificationImage(res, storedPath) {
  const resolved = resolveVerificationPath(storedPath);
  if (!resolved.valid) throw new HttpError(404, "Verification image unavailable.");
  if (!fs.existsSync(resolved.resolvedPath)) throw new HttpError(404, "Verification image file is missing.");
  const ext = path.extname(resolved.resolvedPath).toLowerCase();
  res.set("Cache-Control", "private, no-store");
  res.type(extensionTypes.get(ext) || "application/octet-stream");
  return res.sendFile(resolved.resolvedPath);
}

export async function readVerificationImageFile(storedPath) {
  const status = verificationFileStatus(storedPath);
  if (!status.exists) return { ...status, buffer: null, mime: null };

  const resolved = resolveVerificationPath(storedPath);
  const ext = path.extname(resolved.resolvedPath).toLowerCase();
  const buffer = await fsp.readFile(resolved.resolvedPath);
  return {
    ...status,
    buffer,
    mime: extensionTypes.get(ext) || "image/jpeg"
  };
}

export async function saveVerificationUpload({ file, customerId, kind }) {
  if (!allowedImageTypes.has(file?.mimetype)) {
    throw new HttpError(400, "Only JPEG, PNG, and WebP images are allowed.");
  }
  const safeKind = kind === "selfie" ? "selfie" : "government-id";
  const ext = allowedImageTypes.get(file.mimetype);
  const relativeDir = `verifications/customer-${Number(customerId)}`;
  const filename = `${safeKind}-${crypto.randomUUID()}${ext}`;
  const absoluteDir = path.resolve(UPLOAD_ROOT, relativeDir);
  const root = path.resolve(UPLOAD_ROOT);
  if (!absoluteDir.startsWith(`${root}${path.sep}`)) throw new HttpError(400, "Invalid verification upload path.");
  await fsp.mkdir(absoluteDir, { recursive: true });
  await fsp.writeFile(path.join(absoluteDir, filename), file.buffer);
  return `${relativeDir}/${filename}`;
}
