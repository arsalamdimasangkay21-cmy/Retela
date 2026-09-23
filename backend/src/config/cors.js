const productionOrigins = [
  "https://www.retela.shop",
  "https://retela.shop",
  "https://retela.vercel.app"
];

const developmentOrigins = [
  "http://localhost:5173",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5175"
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

function splitOrigins(value) {
  return typeof value === "string" ? value.split(",") : [];
}

function configuredOrigins() {
  const frontendOrigins = splitOrigins(process.env.FRONTEND_URL);
  const clientOrigins = splitOrigins(process.env.CLIENT_URL);
  const corsOrigins = splitOrigins(process.env.CORS_ORIGIN);
  const corsOriginsList = splitOrigins(process.env.CORS_ORIGINS);
  const vercelOrigins = splitOrigins(process.env.VERCEL_FRONTEND_URL || process.env.VERCEL_PRODUCTION_URL || process.env.VERCEL_URL)
    .map((origin) => /^https?:\/\//i.test(origin.trim()) ? origin : `https://${origin}`);

  const envOrigins = [
    ...frontendOrigins,
    ...clientOrigins,
    ...corsOrigins,
    ...corsOriginsList,
    ...vercelOrigins
  ];

  const allOrigins = [
    ...productionOrigins,
    ...developmentOrigins,
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
  const parsed = parseOrigin(origin);
  return Boolean(parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
}

function parseOrigin(origin) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isPrivateNetworkOrigin(origin) {
  const parsed = parseOrigin(origin);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = parsed.hostname;
  return isLocalhostOrigin(origin)
    || /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)
    || /^192\.168\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname);
}

function isVercelOrigin(origin) {
  return /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(origin);
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

  const isDevelopmentPrivateNetwork =
    process.env.NODE_ENV !== "production" &&
    isPrivateNetworkOrigin(normalized);

  return isConfigured || isDevelopmentLocalhost || isDevelopmentPrivateNetwork || isVercelOrigin(normalized);
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

export const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Idempotency-Key",
    "X-Requested-With"
  ],
  exposedHeaders: [],
  optionsSuccessStatus: 204
};
