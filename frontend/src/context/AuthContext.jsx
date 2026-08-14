import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearGetCache } from "../api/client";
import { disconnectSocket } from "../api/socket";

const AuthContext = createContext(null);

function readStoredUser() {
  const raw = localStorage.getItem("retela_user");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("retela_user");
    localStorage.removeItem("retela_token");
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("retela_token"));
  const [user, setUser] = useState(readStoredUser);

  async function loadCurrentUser() {
    clearGetCache("/users/me");
    const { data } = await api.get("/users/me");
    localStorage.setItem("retela_user", JSON.stringify(data));
    console.log("[profile] loaded authenticated user", { userId: data?.id, role: data?.role });
    return data;
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    loadCurrentUser()
      .then((data) => {
        if (cancelled) return;
        setUser(data);
      })
      .catch(() => {
        if (cancelled) return;
        disconnectSocket("auth verification failed");
        localStorage.removeItem("retela_token");
        localStorage.removeItem("retela_user");
        setToken(null);
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    function handleAuthExpired() {
      disconnectSocket("auth expired");
      localStorage.removeItem("retela_token");
      localStorage.removeItem("retela_user");
      setToken(null);
      setUser(null);
    }
    window.addEventListener("retela:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("retela:auth-expired", handleAuthExpired);
  }, []);

  async function login(credentials) {
    const { data } = await api.post("/auth/login", credentials);
    localStorage.setItem("retela_token", data.token);
    const guestCart = localStorage.getItem("retela_guest_cart");
    if (guestCart && data.user?.role === "customer") {
      try {
        const items = JSON.parse(guestCart);
        if (Array.isArray(items) && items.length) {
          await api.post("/cart/merge", { items });
        }
        localStorage.removeItem("retela_guest_cart");
      } catch {
        localStorage.removeItem("retela_guest_cart");
      }
    }
    setToken(data.token);
    const freshUser = await loadCurrentUser();
    setUser(freshUser);
  }

  function logout() {
    disconnectSocket("logout");
    localStorage.removeItem("retela_token");
    localStorage.removeItem("retela_user");
    setToken(null);
    setUser(null);
  }

  const value = useMemo(() => ({ token, user, login, logout, setUser }), [token, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
