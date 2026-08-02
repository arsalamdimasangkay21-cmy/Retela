const defaultOrigins = [
  "https://retela.shop",
  "https://www.retela.shop",
  "https://retela-ix3c.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5177",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5177"
];

function configuredOrigins() {
  return [
    ...defaultOrigins,
    ...(process.env.CLIENT_URL || "").split(",")
  ]
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .filter((origin, index, origins) => origins.indexOf(origin) === index);
}

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = String(origin).trim().replace(/\/$/, "");
  return configuredOrigins().includes(normalized) || isLocalhostOrigin(normalized);
}

export function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new Error("Not allowed by CORS"));
}

export function allowedOrigins() {
  return configuredOrigins();
}
