import { HttpError } from "./errors.js";
import nodemailer from "nodemailer";

async function sendViaGmail(to, subject, body) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  console.log("EMAIL_USER:", process.env.EMAIL_USER);
  console.log("EMAIL_PASS EXISTS:", !!process.env.EMAIL_PASS);
  if (!user || !pass) return false;

  const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user,
    pass
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000
});

  try {
    const info = await transporter.sendMail({
      from: `"RETELA" <${user}>`,
      to,
      subject,
      text: body
    });

    console.log("Email sent:", info.response);
    return true;
  } catch (error) {
    console.error("EMAIL ERROR:", error);
    throw error;
  }
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
  return true;
}

export async function sendEmail(to, subject, body) {
  if (await sendViaResend(to, subject, body)) return;
  if (await sendViaGenericProvider(to, subject, body)) return;
  if (await sendViaGmail(to, subject, body)) return;

  throw new HttpError(
    503,
    "Email sending is not configured."
  );
}
