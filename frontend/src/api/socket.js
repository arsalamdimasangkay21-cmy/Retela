import { io } from "socket.io-client";
import { SOCKET_URL } from "./client";

let socket = null;
let socketToken = "";
let consumers = 0;
let disconnectTimer = null;

const socketOptions = {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 8,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.5,
  timeout: 12000,
  autoConnect: true
};

export function acquireSocket(token) {
  const nextToken = String(token || "").trim();
  if (!nextToken) return null;

  if (disconnectTimer) {
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (socket && socketToken !== nextToken) {
    socket.disconnect();
    socket = null;
    consumers = 0;
  }

  if (!socket) {
    socket = io(SOCKET_URL, {
      ...socketOptions,
      auth: { token: nextToken }
    });
    socketToken = nextToken;
  }

  consumers += 1;
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

export function releaseSocket(instance) {
  if (!instance || instance !== socket) return;
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0) return;

  disconnectTimer = window.setTimeout(() => {
    if (consumers === 0 && socket) {
      socket.disconnect();
      socket = null;
      socketToken = "";
    }
    disconnectTimer = null;
  }, 500);
}
