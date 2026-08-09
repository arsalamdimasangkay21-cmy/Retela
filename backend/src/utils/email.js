import {
  sendEmail as sendEmailWithResend,
  sendOtpEmail,
  validateEmailConfiguration
} from "../services/emailService.js";

export { sendOtpEmail, validateEmailConfiguration };

export function explainEmailError(error) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return "Email sending is not configured. Set RESEND_API_KEY and EMAIL_FROM.";
  }
  return error?.message || "Email could not be sent through Resend.";
}

export async function verifyEmailTransport({ throwOnFailure = false } = {}) {
  const configured = validateEmailConfiguration();
  const result = {
    configured,
    provider: "resend",
    success: configured,
    error: configured ? null : {
      code: "RESEND_NOT_CONFIGURED",
      message: "RESEND_API_KEY and EMAIL_FROM are required.",
      explanation: "Email sending is not configured. Set RESEND_API_KEY and EMAIL_FROM."
    }
  };

  if (!configured && throwOnFailure) {
    throw new Error(result.error.message);
  }

  return result;
}

export async function sendEmail(to, subject, body) {
  return sendEmailWithResend({
    to,
    subject,
    text: body
  });
}

export async function sendTestEmail(to = process.env.EMAIL_FROM) {
  const verification = await verifyEmailTransport();
  if (!verification.success) {
    return { ...verification, delivered: false };
  }

  try {
    const data = await sendEmailWithResend({
      to,
      subject: "RETELA Resend test email",
      text: `RETELA Resend test email sent at ${new Date().toISOString()}.`
    });
    return { ...verification, delivered: true, id: data?.id || null };
  } catch (error) {
    console.error("[email] Resend test email failed", {
      message: error?.message || null,
      statusCode: error?.statusCode || error?.status || null
    });
    return {
      ...verification,
      delivered: false,
      success: false,
      error: {
        code: error?.code || error?.status || null,
        message: error?.message || "Test email failed",
        explanation: explainEmailError(error)
      }
    };
  }
}
