const productionOrigins = [
  "https://retela.shop",
  "https://www.retela.shop"
];

const developmentOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5177",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5177"
];

function normalizeOrigin(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\/+$/, "");

  return normalized || null;
}

function configuredOrigins() {
  const clientOrigins =
    typeof process.env.CLIENT_URL === "string"
      ? process.env.CLIENT_URL.split(",")
      : [];

  const envOrigins = [
    process.env.FRONTEND_URL,
    ...clientOrigins
  ];

  const allOrigins = [
    ...productionOrigins,
    ...envOrigins,
    ...(process.env.NODE_ENV === "production"
      ? []
      : developmentOrigins)
  ];

  return [
    ...new Set(
      allOrigins
        .map(normalizeOrigin)
        .filter(Boolean)
    )
  ];
}

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
    origin
  );
}

export function isAllowedOrigin(origin) {
  // Allow health checks, Postman, curl, and server-to-server requests.
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);

  if (!normalized) {
    return false;
  }

  const isConfigured =
    configuredOrigins().includes(normalized);

  const isDevelopmentLocalhost =
    process.env.NODE_ENV !== "production" &&
    isLocalhostOrigin(normalized);

  return isConfigured || isDevelopmentLocalhost;
}

export function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) {
    return callback(null, true);
  }

  console.warn("[cors] Blocked origin:", normalizeOrigin(origin) || "<missing-or-invalid-origin>");

  const error = new Error("Origin is not allowed by CORS");
  error.status = 403;
  error.code = "CORS_ORIGIN_DENIED";

  return callback(error);
}

export function allowedOrigins() {
  return configuredOrigins();
}
