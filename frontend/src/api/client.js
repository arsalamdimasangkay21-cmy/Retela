import axios from "axios";

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function socketUrlFromApiUrl(apiUrl) {
  return stripTrailingSlash(apiUrl).replace(/\/api$/, "");
}

export const API_URL = stripTrailingSlash(import.meta.env.VITE_API_URL || "http://localhost:5000/api");
export const SOCKET_URL = socketUrlFromApiUrl(import.meta.env.VITE_SOCKET_URL || API_URL);

export const api = axios.create({
  baseURL: API_URL
});

export function getApiErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.response?.status === 400) return "Invalid details. Please check your input and try again.";
  if (error?.response?.status === 401) return "Invalid credentials or email OTP is not verified yet.";
  if (error?.response?.status === 404) return "Record not found.";
  if (error?.code === "ERR_NETWORK") return "Cannot connect to the server. Make sure the API is running.";
  if (error instanceof SyntaxError) return "Invalid syntax. Please check the input and try again.";
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("retela_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => {
  const payload = response.data;
  if (
    payload &&
    typeof payload === "object" &&
    payload.success === true &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    response.data = payload.data;
  }
  return response;
});
