import "./env.js";
import { createServer } from "http";
import { Server } from "socket.io";

import { createApp } from "./app.js";
import { initializeDatabase } from "./config/db.js";
import { corsOrigin } from "./config/cors.js";
import { configureSocket } from "./socket.js";

if (!process.env.PAYMONGO_SECRET_KEY && !globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__) {
  globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__ = true;
  console.error("PAYMONGO_SECRET_KEY is missing");
}

const port = process.env.PORT || 5000;

async function initializeDatabaseWithRetry(delayMs = 15000) {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("[database] Bootstrap failed. API will stay online and retry.", {
      code: error.code || null,
      message: error.message
    });
    setTimeout(() => initializeDatabaseWithRetry(delayMs), delayMs).unref?.();
  }
}

await initializeDatabaseWithRetry();

const app = createApp();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  allowUpgrades: true
});

app.set("io", io);
configureSocket(io);

httpServer.listen(port, () => {
  console.log(`Retela API running on port ${port}`);
});
