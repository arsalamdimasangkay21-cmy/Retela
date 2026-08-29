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
  // Socket connectivity is optional; REST actions must remain usable while it reconnects.
  timeout: 5000,
  autoConnect: false
};

function handleConnectError(error) {
  console.warn("[socket] connect_error (REST actions remain available)", {
    message: error?.message || "Socket connection failed",
    description: error?.description || null
  });
}

function connectSocketNonBlocking(instance) {
  globalThis.setTimeout(() => {
    if (!consumers || instance !== socket || instance.connected || instance.active) return;
    try {
      instance.connect();
    } catch (error) {
      console.warn("[socket] connect failed (REST actions remain available)", {
        message: error?.message || "Socket connection failed"
      });
    }
  }, 0);
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
    connectSocketNonBlocking(socket);
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
