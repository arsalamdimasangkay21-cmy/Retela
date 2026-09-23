import jwt from "jsonwebtoken";
import { query } from "./config/db.js";
import { getJwtSecret } from "./utils/auth.js";

export function configureSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    try {
      socket.user = jwt.verify(token, getJwtSecret());
    } catch (error) {
      console.warn("[socket] Invalid auth token", {
        socketId: socket.id,
        message: error.message
      });
      socket.user = null;
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log("[socket] connected", {
      socketId: socket.id,
      userId: socket.user?.id || null,
      role: socket.user?.role || null,
      transport: socket.conn.transport.name
    });

    socket.conn.on("upgrade", (transport) => {
      console.log("[socket] transport upgraded", {
        socketId: socket.id,
        transport: transport.name
      });
    });

    if (socket.user?.id) socket.join(`user:${socket.user.id}`);
    if (socket.user?.role === "admin" || socket.user?.role === "staff") socket.join("admin");

    async function markActive() {
      if (!socket.user?.id) return;
      await query("UPDATE users SET last_active_at = NOW() WHERE id = :id", { id: socket.user.id }).catch((error) => {
        console.error("[socket] Failed to mark user active", {
          socketId: socket.id,
          userId: socket.user?.id || null,
          code: error.code || null,
          message: error.message
        });
      });
      io.to("admin").emit("user:status", { userId: socket.user.id, status: "active", last_active_at: new Date().toISOString() });
    }

    markActive();

    socket.on("conversation:join", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("order-live:join", async (orderIdInput, ack) => {
      const orderId = Number(orderIdInput);
      if (!socket.user?.id || !Number.isInteger(orderId) || orderId <= 0) {
        ack?.({ ok: false, message: "A valid order is required." });
        return;
      }
      try {
        const rows = await query("SELECT id, user_id FROM orders WHERE id = :orderId LIMIT 1", { orderId });
        const order = rows[0];
        const isAdmin = socket.user.role === "admin" || socket.user.role === "staff";
        const isOwner = Number(order?.user_id) === Number(socket.user.id);
        if (!order || (!isAdmin && !isOwner)) {
          ack?.({ ok: false, message: "Not authorized for this order." });
          return;
        }
        socket.join(`order-live:${orderId}`);
        socket.join(`order:${orderId}`);
        ack?.({ ok: true });
      } catch (error) {
        console.error("[socket] Failed to join order live room", {
          socketId: socket.id,
          userId: socket.user?.id || null,
          orderId,
          message: error.message
        });
        ack?.({ ok: false, message: "Could not join live route." });
      }
    });

    socket.on("order-live:leave", (orderIdInput) => {
      const orderId = Number(orderIdInput);
      if (Number.isInteger(orderId) && orderId > 0) {
        socket.leave(`order-live:${orderId}`);
        socket.leave(`order:${orderId}`);
      }
    });

    socket.on("typing", ({ conversationId, isTyping }) => {
      markActive();
      socket.to(`conversation:${conversationId}`).emit("typing", { conversationId, isTyping });
    });

    socket.on("user:activity", markActive);
    socket.on("error", (error) => {
      console.error("[socket] error", {
        socketId: socket.id,
        userId: socket.user?.id || null,
        message: error.message
      });
    });

    socket.on("disconnect", (reason) => {
      console.log("[socket] disconnected", {
        socketId: socket.id,
        userId: socket.user?.id || null,
        reason
      });
      if (socket.user?.id) {
        io.to("admin").emit("user:status", { userId: socket.user.id, status: "offline", last_active_at: new Date().toISOString() });
      }
    });
  });
}
