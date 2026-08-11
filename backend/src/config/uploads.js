import fs from "fs";
import path from "path";

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(process.cwd(), "uploads");
export const PRODUCT_UPLOAD_DIR = path.join(UPLOAD_ROOT, "products");

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });

export function logUploadConfig() {
  console.log("[uploads]", {
    root: UPLOAD_ROOT,
    productRoot: PRODUCT_UPLOAD_DIR
  });
}
