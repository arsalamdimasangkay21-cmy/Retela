import { sendOtpEmail } from "./email.js";

export const sendOTP = async (email, otp) => {
  await sendOtpEmail(email, otp);
};
