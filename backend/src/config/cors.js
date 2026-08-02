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

function configuredOrigins() {
  const envOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.CLIENT_URL || "").split(",")
  ];
  return [
    ...productionOrigins,
    ...envOrigins,
    ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins)
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
  return configuredOrigins().includes(normalized) || (process.env.NODE_ENV !== "production" && isLocalhostOrigin(normalized));
}

export function corsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new Error("Not allowed by CORS"));
}

export function allowedOrigins() {
  return configuredOrigins();
}
