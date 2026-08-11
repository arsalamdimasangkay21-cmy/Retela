import { API_URL } from "../api/client";

function normalizeStoredImagePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "null" || normalized === "undefined") return null;
  return normalized.replace(/^public\/+/i, "");
}

export function getProductImageValue(productOrValue) {
  if (typeof productOrValue === "string") return normalizeStoredImagePath(productOrValue);
  if (!productOrValue || typeof productOrValue !== "object") return null;

  return normalizeStoredImagePath(
    productOrValue.imageUrl
      ?? productOrValue.image_url
      ?? null
  );
}

export function resolveProductImageUrl(productOrValue) {
  const value = getProductImageValue(productOrValue);
  if (!value) return null;
  if (/^(https?:|blob:|data:)/i.test(value)) return value;

  const apiBase = String(API_URL || import.meta.env.VITE_API_URL || "")
    .replace(/\/api\/?$/, "")
    .replace(/\/$/, "");

  if (!apiBase) return `/${value.replace(/^\/+/, "")}`;
  return `${apiBase}/${value.replace(/^\/+/, "")}`;
}

export function normalizeProductImageFields(product = {}) {
  const imageValue = getProductImageValue(product);
  return {
    ...product,
    imageUrl: imageValue,
    image_url: imageValue
  };
}

export function logProductImageDebug(product, resolvedImageUrl) {
  if (!import.meta.env.DEV || !product || typeof product !== "object") return;
  console.log("[PRODUCT IMAGE]", {
    id: product.id,
    imageUrl: product.imageUrl,
    image_url: product.image_url,
    resolvedImageUrl
  });
}
