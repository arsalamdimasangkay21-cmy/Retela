import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

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

  useEffect(() => {
    if (!token) return;
    api.get("/users/me")
      .then(({ data }) => {
        localStorage.setItem("retela_user", JSON.stringify(data));
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem("retela_token");
        localStorage.removeItem("retela_user");
        setToken(null);
        setUser(null);
      });
  }, [token]);

  async function login(credentials) {
    const { data } = await api.post("/auth/login", credentials);
    localStorage.setItem("retela_token", data.token);
    localStorage.setItem("retela_user", JSON.stringify(data.user));
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
    setUser(data.user);
  }

  function logout() {
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
