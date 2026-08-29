const DEFAULT_RETELA_LOGO_PATH = "/uploads/1779171517392-168464057.jpg";

export function resolveAssetUrl(url) {
  if (!url) return "";
  if (url.startsWith("http") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  return `${apiUrl.replace(/\/api$/, "")}${url}`;
}

export const DEFAULT_RETELA_LOGO_URL = resolveAssetUrl(DEFAULT_RETELA_LOGO_PATH);
export const RETELA_LOGO_URL = DEFAULT_RETELA_LOGO_URL;

export function logoFromSettings(settings) {
  const configured = String(settings?.general?.shopLogoUrl || "").trim();
  const resolved = resolveAssetUrl(configured);
  if (!resolved) return DEFAULT_RETELA_LOGO_URL;
  if (/^(?:blob:|data:)/i.test(resolved)) return resolved;
  const version = settings?.general?.shopLogoUpdatedAt || settings?.general?.shopLogoVersion || Date.now();
  const separator = resolved.includes("?") ? "&" : "?";
  return `${resolved}${separator}v=${encodeURIComponent(version)}`;
}
