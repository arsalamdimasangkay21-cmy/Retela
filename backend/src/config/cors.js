const productionOrigins = [
  "https://www.retela.shop",
  "https://retela.shop",
  "https://retela.vercel.app"
];

const developmentOrigins = [
  "http://localhost:5173"
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
  const vercelOrigins = splitOrigins(process.env.VERCEL_FRONTEND_URL || process.env.VERCEL_PRODUCTION_URL || process.env.VERCEL_URL)
    .map((origin) => /^https?:\/\//i.test(origin.trim()) ? origin : `https://${origin}`);

  const envOrigins = [
    ...frontendOrigins,
    ...clientOrigins,
    ...corsOrigins,
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
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
    origin
  );
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

  return isConfigured || isDevelopmentLocalhost || isVercelOrigin(normalized);
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
    "X-Requested-With"
  ],
  exposedHeaders: [],
  optionsSuccessStatus: 204
};
