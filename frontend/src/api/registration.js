import { api } from "./client";

export function validateRegistration(payload) {
  return api.post("/auth/register/validate", payload);
}

export function checkRegistrationField(field, value) {
  return api.post("/auth/register/check", { field, value });
}

export function sendRegistrationOtp(payload, config = {}) {
  const formData = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) formData.append(key, value);
  });
  return api.post("/auth/register/send-otp", formData, {
    ...config,
    headers: { "Content-Type": "multipart/form-data" }
  });
}

export function completeRegistrationOtp({ email, otp }) {
  return api.post("/auth/register/complete", { email, otp });
}

export function resendRegistrationOtp(email) {
  return api.post("/auth/register/resend-otp", { email });
}

export function getCustomerDocuments(customerId) {
  return api.get(`/admin/customer-documents/${customerId}`);
}
