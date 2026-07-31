import { HttpError } from "./errors.js";

async function sendViaTwilio(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) return false;

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpError(502, `SMS provider rejected the message: ${errorBody.slice(0, 180)}`);
  }
  return true;
}

async function sendViaGenericProvider(to, body) {
  const url = process.env.SMS_API_URL;
  if (!url) return false;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMS_API_TOKEN ? { Authorization: `Bearer ${process.env.SMS_API_TOKEN}` } : {})
    },
    body: JSON.stringify({ to, message: body })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpError(502, `SMS provider rejected the message: ${errorBody.slice(0, 180)}`);
  }
  return true;
}

export async function sendSms(to, body) {
  if (await sendViaTwilio(to, body)) return true;
  if (await sendViaGenericProvider(to, body)) return true;
  console.info(`[sms:disabled] ${to}: ${body}`);
  return false;
}
