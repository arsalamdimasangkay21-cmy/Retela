import jwt from "jsonwebtoken";
import { query } from "./config/db.js";

export function configureSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_me");
    } catch {
      socket.user = null;
    }
    next();
  });

  io.on("connection", (socket) => {
    if (socket.user?.id) socket.join(`user:${socket.user.id}`);
    if (socket.user?.role === "admin" || socket.user?.role === "staff") socket.join("admin");

    async function markActive() {
      if (!socket.user?.id) return;
      await query("UPDATE users SET last_active_at = NOW() WHERE id = :id", { id: socket.user.id }).catch(() => {});
      io.to("admin").emit("user:status", { userId: socket.user.id, status: "active", last_active_at: new Date().toISOString() });
    }

    markActive();

    socket.on("conversation:join", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("typing", ({ conversationId, isTyping }) => {
      markActive();
      socket.to(`conversation:${conversationId}`).emit("typing", { conversationId, isTyping });
    });

    socket.on("user:activity", markActive);

    socket.on("disconnect", () => {
      if (socket.user?.id) {
        io.to("admin").emit("user:status", { userId: socket.user.id, status: "offline", last_active_at: new Date().toISOString() });
      }
    });
  });
}
