import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, clearGetCache, getStoredAuthToken } from "../api/client";
import { disconnectSocket } from "../api/socket";

const AuthContext = createContext(null);

function readStoredUser() {
  if (!localStorage.getItem("retela_token")) {
    localStorage.removeItem("retela_user");
    return null;
  }
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
  const [authReady, setAuthReady] = useState(!localStorage.getItem("retela_token"));
  const skipNextBlockingRefresh = useRef(false);

  async function loadCurrentUser() {
    clearGetCache("/users/me");
    const { data } = await api.get("/users/me");
    localStorage.setItem("retela_user", JSON.stringify(data));
    console.log("[profile] loaded authenticated user", { userId: data?.id, role: data?.role });
    return data;
  }

  function mergeGuestCartInBackground() {
    const guestCart = localStorage.getItem("retela_guest_cart");
    if (!guestCart) return;

    let items = [];
    try {
      items = JSON.parse(guestCart);
    } catch {
      localStorage.removeItem("retela_guest_cart");
      return;
    }

    if (!Array.isArray(items) || !items.length) {
      localStorage.removeItem("retela_guest_cart");
      return;
    }

    api.post("/cart/merge", { items })
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem("retela_guest_cart");
      });
  }

  useEffect(() => {
    if (!token) {
      setAuthReady(true);
      setUser(null);
      return;
    }
    let cancelled = false;
    if (skipNextBlockingRefresh.current) {
      skipNextBlockingRefresh.current = false;
      loadCurrentUser()
        .then((data) => {
          if (!cancelled) setUser(data);
        })
        .catch(() => {
          if (cancelled) return;
          disconnectSocket("auth verification failed");
          localStorage.removeItem("retela_token");
          localStorage.removeItem("retela_user");
          setToken(null);
          setUser(null);
          setAuthReady(true);
        });
      return () => {
        cancelled = true;
      };
    }
    setAuthReady(false);
    loadCurrentUser()
      .then((data) => {
        if (cancelled) return;
        setUser(data);
        setAuthReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        disconnectSocket("auth verification failed");
        localStorage.removeItem("retela_token");
        localStorage.removeItem("retela_user");
        setToken(null);
        setUser(null);
        setAuthReady(true);
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
      setAuthReady(true);
    }
    window.addEventListener("retela:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("retela:auth-expired", handleAuthExpired);
  }, []);

  async function login(credentials) {
    const { data } = await api.post("/auth/login", credentials, { timeout: 12000 });
    localStorage.setItem("retela_token", data.token);
    localStorage.setItem("retela_user", JSON.stringify(data.user));
    setUser(data.user);
    setAuthReady(true);
    skipNextBlockingRefresh.current = true;
    setToken(data.token);

    if (data.user?.role === "customer") mergeGuestCartInBackground();
  }

  function logout() {
    if (user?.role === "admin") {
      const authToken = getStoredAuthToken();
      if (authToken) {
        void api.patch(
          "/messages/release-takeovers",
          {},
          {
            timeout: 5000,
            headers: { Authorization: `Bearer ${authToken}` }
          }
        ).then(({ data }) => {
          console.info("[auth] released admin chat takeovers on logout", data);
        }).catch((error) => {
          console.warn("[auth] could not release admin chat takeovers on logout", {
            status: error?.response?.status || null,
            message: error?.message || "Release request failed"
          });
        });
      }
    }
    disconnectSocket("logout");
    localStorage.removeItem("retela_token");
    localStorage.removeItem("retela_user");
    setToken(null);
    setUser(null);
    setAuthReady(true);
  }

  const value = useMemo(() => ({ token, user, authReady, login, logout, setUser }), [token, user, authReady]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
