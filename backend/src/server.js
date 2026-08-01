import "./env.js";
import dotenv from "dotenv";
import http from "http";
import express from "express";
import { Server } from "socket.io";

import { createApp } from "./app.js";
import { initializeDatabase } from "./config/db.js";
import { configureSocket } from "./socket.js";

dotenv.config();

if (!process.env.PAYMONGO_SECRET_KEY && !globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__) {
  globalThis.__RETELA_PAYMONGO_WARNING_LOGGED__ = true;
  console.error("PAYMONGO_SECRET_KEY is missing");
}

const port = process.env.PORT || 5000;

const configuredOrigins = (
  process.env.CLIENT_URL ||
  "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5177"
)
  .split(",")
  .map((origin) => origin.trim());

const server = http.createServer();

const io = new Server(server, {
  cors: {
    origin: configuredOrigins,
    credentials: true,
  },
});

await initializeDatabase();

const app = createApp(io);

app.use(express.json());

server.removeAllListeners("request");
server.on("request", app);

configureSocket(io);

server.listen(port, () => {
  console.log(`Retela API running on http://localhost:${port}`);
});
