import { sendEmail as sendEmailWithResend } from "../services/emailService.js";

export async function sendEmail({ to, subject, html, text }) {
  return sendEmailWithResend({ to, subject, html, text });
}
