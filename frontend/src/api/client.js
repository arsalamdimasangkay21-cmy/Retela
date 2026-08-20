import axios from "axios";

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function socketUrlFromApiUrl(apiUrl) {
  return stripTrailingSlash(apiUrl).replace(/\/api$/, "");
}

function normalizeApiUrl(value) {
  const fallbackApiUrl = import.meta.env.PROD ? "https://api.retela.shop" : "http://localhost:5000";
  const raw = stripTrailingSlash(value || fallbackApiUrl);
  return `${raw.replace(/(\/api)+$/, "")}/api`;
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);
export const SOCKET_URL = socketUrlFromApiUrl(import.meta.env.VITE_SOCKET_URL || API_URL);

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

const DEFAULT_GET_CACHE_MS = 8000;
const DEFAULT_GET_RETRIES = 1;
const RETRY_DELAY_MS = 450;
const inFlightGetRequests = new Map();
const getResponseCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableSerialize(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return String(value);
}

function getRequestKey(url, config = {}) {
  return `${url}?${stableSerialize(config.params || {})}`;
}

function isCancelledRequest(error) {
  return axios.isCancel?.(error) || error?.code === "ERR_CANCELED";
}

function shouldRetryGet(error, attempt, maxRetries) {
  if (attempt >= maxRetries || isCancelledRequest(error)) return false;
  const status = error?.response?.status;
  if (status >= 400 && status < 500) return false;
  return !error?.response || error?.code === "ERR_NETWORK" || error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT";
}

export function clearGetCache(urlPrefix = "") {
  const prefix = String(urlPrefix || "");
  for (const key of [...getResponseCache.keys()]) {
    if (!prefix || key.startsWith(prefix)) getResponseCache.delete(key);
  }
  for (const key of [...inFlightGetRequests.keys()]) {
    if (!prefix || key.startsWith(prefix)) inFlightGetRequests.delete(key);
  }
}

export function cachedGet(url, config = {}, options = {}) {
  const cacheMs = Number.isFinite(options.cacheMs) ? options.cacheMs : DEFAULT_GET_CACHE_MS;
  const retries = Number.isFinite(options.retries) ? options.retries : DEFAULT_GET_RETRIES;
  const force = Boolean(options.force);
  const key = getRequestKey(url, config);
  const cached = getResponseCache.get(key);
  const now = Date.now();

  if (!force && cached && cached.expiresAt > now) {
    return Promise.resolve({ ...cached.response, data: cached.response.data });
  }

  if (!force && inFlightGetRequests.has(key)) {
    return inFlightGetRequests.get(key);
  }

  const request = async () => {
    let attempt = 0;
    while (true) {
      try {
        const response = await api.get(url, config);
        if (cacheMs > 0) {
          getResponseCache.set(key, { response, expiresAt: Date.now() + cacheMs });
        }
        return response;
      } catch (error) {
        if (!shouldRetryGet(error, attempt, retries)) throw error;
        attempt += 1;
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  };

  const promise = request().finally(() => {
    inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, promise);
  return promise;
}

export function getApiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.response?.status === 400) return "Invalid details. Please check your input and try again.";
  if (error?.response?.status === 401) return "Invalid username or password.";
  if (error?.response?.status === 404) return "Record not found.";
  if (error?.code === "ERR_NETWORK") return "Cannot connect to the server. Make sure the API is running.";
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") return fallback;
  if (error instanceof SyntaxError) return "Invalid syntax. Please check the input and try again.";
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("retela_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    if (typeof config.headers?.delete === "function") {
      config.headers.delete("Content-Type");
      config.headers.delete("content-type");
    } else {
      delete config.headers["Content-Type"];
      delete config.headers["content-type"];
    }
  }
  return config;
});

api.interceptors.response.use((response) => {
  const payload = response.data;
  if (
    payload &&
    typeof payload === "object" &&
    payload.success === true &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    response.data = payload.data;
  }
  return response;
}, (error) => {
  const status = error?.response?.status;
  if (status === 401) {
    localStorage.removeItem("retela_token");
    localStorage.removeItem("retela_user");
    window.dispatchEvent(new CustomEvent("retela:auth-expired"));
  }
  return Promise.reject(error);
});

export default api;
