import { sendEmail } from "./mailer.js";

export const sendOTP = async (email, otp) => {
  await sendEmail({
    to: email,
    subject: "Retela OTP Verification",
    html: `
      <h2>Verify Your Account</h2>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    `,
  });
};