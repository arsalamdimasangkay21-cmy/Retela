import { Resend } from "resend";
import { HttpError } from "../utils/errors.js";

let resendClient;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new HttpError(503, "Email sending is not configured. Set RESEND_API_KEY.");
  }
  resendClient ||= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function getEmailFrom() {
  const from = String(process.env.EMAIL_FROM || "").trim();
  if (!from) {
    throw new HttpError(503, "Email sending is not configured. Set EMAIL_FROM.");
  }
  return from;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toParagraphHtml(text) {
  return escapeHtml(text)
    .split(/\r?\n/)
    .filter((line) => line.trim().length)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

function normalizeRecipients(to) {
  return Array.isArray(to) ? to : [to];
}

function logResendError(prefix, error) {
  console.error(prefix, {
    message: error?.message || null,
    name: error?.name || null,
    statusCode: error?.statusCode || error?.status || null
  });
}

export function validateEmailConfiguration() {
  const configured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  if (!configured) {
    console.warn("[email] Resend is not fully configured", {
      hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
      hasEmailFrom: Boolean(process.env.EMAIL_FROM)
    });
    return false;
  }

  console.log("[email] Resend configured", {
    hasResendApiKey: true,
    emailFrom: process.env.EMAIL_FROM
  });
  return true;
}

export async function sendEmail({ to, subject, html, text }) {
  try {
    const { data, error } = await getResendClient().emails.send({
      from: getEmailFrom(),
      to: normalizeRecipients(to),
      subject,
      html: html || `<div style="font-family: Arial, sans-serif;">${toParagraphHtml(text || "")}</div>`,
      ...(text ? { text } : {})
    });

    if (error) {
      logResendError("Failed to send email with Resend:", error);
      throw new HttpError(502, error.message || "Failed to send email with Resend.");
    }

    console.log("Email sent with Resend:", data?.id || null);
    return data;
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logResendError("Failed to send email with Resend:", error);
      throw new HttpError(502, error.message || "Failed to send email with Resend.");
    }
    throw error;
  }
}

export async function sendOtpEmail(email, otp) {
  try {
    const data = await sendEmail({
      to: [email],
      subject: "Your Retela Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
          <h2>Retela Email Verification</h2>
          <p>Your verification code is:</p>
          <h1 style="letter-spacing: 0.2em;">${escapeHtml(otp)}</h1>
          <p>This code will expire soon.</p>
          <p>If you did not request this code, you can ignore this email.</p>
        </div>
      `,
      text: `Your Retela verification code is ${otp}. This code will expire soon.`
    });
    return data;
  } catch (error) {
    logResendError("Failed to send OTP with Resend:", error);
    if (error instanceof HttpError && error.status === 503) {
      throw error;
    }
    throw new HttpError(502, "Failed to send verification email");
  }
}
