import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "../../uploads");
const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const originalExt = path.extname(file.originalname || "").toLowerCase();
    const ext = allowedImageTypes.get(file.mimetype) || ([".jpg", ".jpeg", ".png", ".webp"].includes(originalExt) ? originalExt.replace(".jpeg", ".jpg") : "");
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

const memoryStorage = multer.memoryStorage();

const imageOnly = (req, file, cb) => {
  const originalExt = path.extname(file.originalname || "").toLowerCase();
  const allowedExt = [".jpg", ".jpeg", ".png", ".webp"].includes(originalExt);
  if (!allowedImageTypes.has(file.mimetype) || !allowedExt) {
    return cb(new Error("Only jpg, jpeg, png, and webp images are allowed."));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});

export const registrationUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageOnly
});
