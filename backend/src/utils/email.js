import nodemailer from "nodemailer";
import { HttpError } from "./errors.js";

const SMTP_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.EMAIL_PORT || 587);
const SMTP_SECURE = String(process.env.EMAIL_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS || 30000);
const SMTP_FAMILY = Number(process.env.EMAIL_FAMILY || 4);

let gmailTransporter;
let gmailVerifyStarted = false;

function hasGmailCredentials() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getGmailTransporter() {
  if (!hasGmailCredentials()) return null;
  gmailTransporter ||= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    ...(Number.isFinite(SMTP_FAMILY) ? { family: SMTP_FAMILY } : {}),
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS
  });
  if (!gmailVerifyStarted) {
    gmailVerifyStarted = true;
    gmailTransporter.verify()
      .then(() => console.log("[email] SMTP verified before first send", {
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        family: Number.isFinite(SMTP_FAMILY) ? SMTP_FAMILY : null
      }))
      .catch((error) => logEmailError("[email] SMTP verification diagnostic failed", error));
  }
  return gmailTransporter;
}

function logEmailError(prefix, error) {
  console.error(prefix);
  console.error("error.code:", error?.code || null);
  console.error("error.message:", error?.message || null);
  console.error("error.stack:", error?.stack || null);
}

export function explainEmailError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  const lowerMessage = message.toLowerCase();

  if (code === "EAUTH" || lowerMessage.includes("invalid login")) {
    return "Gmail SMTP authentication failed. Check EMAIL_USER and EMAIL_PASS, and use a Gmail App Password.";
  }
  if (code === "ECONNECTION") {
    return "Could not connect to Gmail SMTP. Check network access, SMTP host, and SMTP port.";
  }
  if (code === "ETIMEDOUT") {
    return "Timed out while connecting to Gmail SMTP. Check network/firewall access and try again.";
  }
  if (code === "ENETUNREACH") {
    return "The server cannot reach the Gmail SMTP network. Check hosting network restrictions.";
  }
  if (code === "ESOCKET") {
    return "The Gmail SMTP socket failed. Check secure/port settings and network stability.";
  }
  if (!hasGmailCredentials()) {
    return "Email sending is not configured. Set EMAIL_USER and EMAIL_PASS.";
  }
  return "Email could not be sent. Check SMTP configuration and server logs.";
}

export async function verifyEmailTransport({ throwOnFailure = false } = {}) {
  const configured = hasGmailCredentials();
  const result = {
    configured,
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    smtpConnection: false,
    authenticated: false,
    success: false,
    error: null
  };

  if (!configured) {
    result.error = {
      code: "EMAIL_NOT_CONFIGURED",
      message: "EMAIL_USER and EMAIL_PASS are required for Gmail SMTP.",
      explanation: explainEmailError({ code: "EMAIL_NOT_CONFIGURED" })
    };
    if (throwOnFailure) throw new HttpError(503, result.error.message);
    return result;
  }

  try {
    await getGmailTransporter().verify();
    result.smtpConnection = true;
    result.authenticated = true;
    result.success = true;
    console.log("[email] SMTP verified");
    return result;
  } catch (error) {
    logEmailError("[email] SMTP verification failed", error);
    result.error = {
      code: error?.code || null,
      message: error?.message || "SMTP verification failed",
      stack: error?.stack || null,
      explanation: explainEmailError(error)
    };
    if (throwOnFailure) throw new HttpError(503, result.error.explanation);
    return result;
  }
}

async function sendViaGmail(to, subject, body) {
  if (!hasGmailCredentials()) return false;
  const transporter = getGmailTransporter();
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const info = await transporter.sendMail({
        from: `"RETELA" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text: body
      });
      console.log(`[email] Email sent via Gmail SMTP on attempt ${attempt}:`, info.response || info.messageId);
      return true;
    } catch (error) {
      lastError = error;
      logEmailError(`[email] Gmail send failed on attempt ${attempt}`, error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  throw new HttpError(502, explainEmailError(lastError));
}

async function sendViaResend(to, subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to, subject, text: body })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpError(502, `Email provider rejected the message: ${errorBody.slice(0, 180)}`);
  }
  console.log("[email] Email sent via Resend");
  return true;
}

async function sendViaGenericProvider(to, subject, body) {
  const url = process.env.EMAIL_API_URL;
  if (!url) return false;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EMAIL_API_TOKEN ? { Authorization: `Bearer ${process.env.EMAIL_API_TOKEN}` } : {})
    },
    body: JSON.stringify({ to, subject, message: body })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpError(502, `Email provider rejected the message: ${errorBody.slice(0, 180)}`);
  }
  console.log("[email] Email sent via generic provider");
  return true;
}

export async function sendEmail(to, subject, body) {
  const errors = [];

  for (const sender of [sendViaGmail, sendViaResend, sendViaGenericProvider]) {
    try {
      if (await sender(to, subject, body)) return;
    } catch (error) {
      errors.push(error);
    }
  }

  const lastError = errors.at(-1);
  if (lastError) throw lastError;
  throw new HttpError(503, "Email sending is not configured. Set EMAIL_USER and EMAIL_PASS.");
}

export async function sendTestEmail(to = process.env.EMAIL_USER) {
  const verification = await verifyEmailTransport();
  if (!verification.success) {
    return { ...verification, delivered: false };
  }

  try {
    await sendViaGmail(
      to,
      "RETELA SMTP test email",
      `RETELA SMTP test email sent at ${new Date().toISOString()}.`
    );
    return { ...verification, delivered: true };
  } catch (error) {
    logEmailError("[email] Test email failed", error);
    return {
      ...verification,
      delivered: false,
      success: false,
      error: {
        code: error?.code || error?.status || null,
        message: error?.message || "Test email failed",
        stack: error?.stack || null,
        explanation: explainEmailError(error)
      }
    };
  }
}
