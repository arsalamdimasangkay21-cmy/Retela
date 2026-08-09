import { io } from "socket.io-client";
import { SOCKET_URL } from "./client";

let socket = null;
let socketToken = "";
let consumers = 0;

const socketOptions = {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 8000,
  randomizationFactor: 0.5,
  timeout: 12000,
  autoConnect: false
};

function handleConnectError(error) {
  console.error("[socket] connect_error", {
    message: error?.message || "Socket connection failed",
    description: error?.description || null
  });
}

function handleConnect() {
  console.info("[socket] connected", {
    socketId: socket?.id || null
  });
}

function handleDisconnect(reason) {
  console.info("[socket] disconnected", {
    reason
  });
}

function handleReconnectAttempt(attempt) {
  console.info("[socket] reconnecting", {
    attempt
  });
}

function bindLifecycleLogging(instance) {
  instance.on("connect", handleConnect);
  instance.on("disconnect", handleDisconnect);
  instance.on("connect_error", handleConnectError);
  instance.io?.on("reconnect_attempt", handleReconnectAttempt);
}

function unbindLifecycleLogging(instance) {
  instance.off("connect", handleConnect);
  instance.off("disconnect", handleDisconnect);
  instance.off("connect_error", handleConnectError);
  instance.io?.off("reconnect_attempt", handleReconnectAttempt);
}

export function acquireSocket(token) {
  const nextToken = String(token || "").trim();
  if (!nextToken) return null;

  if (socket && socketToken !== nextToken) {
    disconnectSocket("auth token changed");
  }

  if (!socket) {
    socket = io(SOCKET_URL, {
      ...socketOptions,
      auth: { token: nextToken }
    });
    bindLifecycleLogging(socket);
    socketToken = nextToken;
  }

  consumers += 1;
  if (!socket.connected && !socket.active) {
    socket.connect();
  }
  return socket;
}

export function releaseSocket(instance) {
  if (!instance || instance !== socket) return;
  consumers = Math.max(0, consumers - 1);
}

export function disconnectSocket(reason = "explicit disconnect") {
  if (!socket) return;
  const current = socket;
  unbindLifecycleLogging(current);
  current.disconnect();
  console.info("[socket] disconnected", {
    reason
  });
  if (current === socket) {
    socket = null;
    socketToken = "";
    consumers = 0;
  }
}
