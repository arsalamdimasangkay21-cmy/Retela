import "./env.js";
import { createServer } from "http";
import { Server } from "socket.io";

import { createApp } from "./app.js";
import { initializeDatabase } from "./config/db.js";
import { corsOrigin } from "./config/cors.js";
import { configureSocket } from "./socket.js";
import { validateEmailConfiguration } from "./services/emailService.js";

if (!process.env.PAYMONGO_SECRET_KEY && !globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__) {
  globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__ = true;
  console.error("PAYMONGO_SECRET_KEY is missing");
}

const PORT = Number(process.env.PORT) || 5000;
const HOST = "0.0.0.0";

async function initializeDatabaseOrExit() {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("[database] Startup initialization failed. Shutting down backend.", {
      code: error.code || null,
      message: error.message
    });
    process.exit(1);
  }
}

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

httpServer.on("error", (error) => {
  console.error("[server] Unable to start HTTP server.", {
    code: error.code || null,
    message: error.message,
    port: PORT
  });
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[server] RETELA backend listening on port ${PORT}`);

  initializeDatabaseOrExit()
    .then(() => {
      validateEmailConfiguration();
      console.log("[database] Startup initialization completed.");
    })
    .catch(() => {});
});
