import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import { PRODUCT_UPLOAD_DIR, UPLOAD_ROOT } from "../config/uploads.js";

const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });

function safeImageFilename(file) {
  const ext = allowedImageTypes.get(file.mimetype);
  return `${crypto.randomUUID()}${ext}`;
}

const storage = multer.diskStorage({
  destination: UPLOAD_ROOT,
  filename: (req, file, cb) => {
    cb(null, safeImageFilename(file));
  }
});

const productStorage = multer.diskStorage({
  destination: PRODUCT_UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, safeImageFilename(file));
  }
});

const memoryStorage = multer.memoryStorage();

const imageOnly = (req, file, cb) => {
  if (!allowedImageTypes.has(file.mimetype)) {
    return cb(new Error("Only jpg, jpeg, png, and webp images are allowed."));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});

export const productUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: imageOnly
});

export const settingsUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});

export const registrationUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});

export const verificationUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});
