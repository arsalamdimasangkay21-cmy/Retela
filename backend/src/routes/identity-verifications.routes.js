import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { verificationUpload } from "../middleware/upload.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { saveVerificationUpload, sendVerificationImage, verificationFileStatus } from "../utils/verificationFiles.js";

const router = Router();

async function getVerification(id) {
  const rows = await query(
    `SELECT id, user_id, id_image, selfie_image, otp_verified, identity_verified
     FROM identity_verifications
     WHERE id = :id
     LIMIT 1`,
    { id }
  );
  if (!rows.length) throw new HttpError(404, "Verification record not found.");
  return rows[0];
}

async function getCustomerVerification(userId) {
  const rows = await query(
    `SELECT id, user_id, id_image, selfie_image, otp_verified, identity_verified
     FROM identity_verifications
     WHERE user_id = :userId
     ORDER BY id DESC
     LIMIT 1`,
    { userId }
  );
  if (!rows.length) throw new HttpError(404, "Verification record not found.");
  return rows[0];
}

function logVerificationPaths(verification) {
  const governmentIdStatus = verificationFileStatus(verification.id_image);
  const selfieStatus = verificationFileStatus(verification.selfie_image);
  console.log("[verification paths]", {
    verificationId: verification.id,
    customerId: verification.user_id,
    governmentIdPath: governmentIdStatus.path,
    governmentIdExists: governmentIdStatus.exists,
    selfiePath: selfieStatus.path,
    selfieExists: selfieStatus.exists
  });
}

function verificationPayload(verification) {
  return {
    id: verification.id,
    user_id: verification.user_id,
    government_id_image: verificationFileStatus(verification.id_image),
    selfie_verification_image: verificationFileStatus(verification.selfie_image),
    otp_verified: Boolean(verification.otp_verified),
    identity_verified: Boolean(verification.identity_verified)
  };
}

function sendMissingImageStatus(res, status) {
  return res.status(404).json({
    success: false,
    exists: false,
    reason: status.reason || "FILE_MISSING",
    message: "Verification image unavailable."
  });
}

router.use(requireAuth);

router.get("/me", asyncHandler(async (req, res) => {
  if (req.user.role !== "customer") throw new HttpError(403, "Forbidden");
  const verification = await getCustomerVerification(req.user.id);
  logVerificationPaths(verification);
  res.set("Cache-Control", "no-store");
  res.json({ verification: verificationPayload(verification) });
}));

router.get("/:id/government-id", requireRole("admin"), asyncHandler(async (req, res) => {
  const verification = await getVerification(req.params.id);
  logVerificationPaths(verification);
  const status = verificationFileStatus(verification.id_image);
  if (!status.exists) return sendMissingImageStatus(res, status);
  return sendVerificationImage(res, verification.id_image);
}));

router.get("/:id/selfie", requireRole("admin"), asyncHandler(async (req, res) => {
  const verification = await getVerification(req.params.id);
  logVerificationPaths(verification);
  const status = verificationFileStatus(verification.selfie_image);
  if (!status.exists) return sendMissingImageStatus(res, status);
  return sendVerificationImage(res, verification.selfie_image);
}));

router.put("/:id/government-id", verificationUpload.single("governmentId"), asyncHandler(async (req, res) => {
  const verification = await getVerification(req.params.id);
  const isAdmin = req.user.role === "admin";
  const isOwner = Number(req.user.id) === Number(verification.user_id);
  if (!isAdmin && !isOwner) throw new HttpError(403, "Forbidden");
  if (!req.file) throw new HttpError(400, "Government ID image is required.");

  const idImage = await saveVerificationUpload({
    file: req.file,
    customerId: verification.user_id,
    kind: "government-id"
  });
  await query(
    `UPDATE identity_verifications
     SET id_image = :idImage,
         updated_at = NOW()
     WHERE id = :id`,
    { id: verification.id, idImage }
  );
  const updated = await getVerification(verification.id);
  logVerificationPaths(updated);
  res.json({
    message: "Government ID image updated.",
    verification: {
      ...verificationPayload(updated)
    }
  });
}));

router.put("/:id/selfie", verificationUpload.single("selfie"), asyncHandler(async (req, res) => {
  const verification = await getVerification(req.params.id);
  if (req.user.role !== "customer" || Number(req.user.id) !== Number(verification.user_id)) {
    throw new HttpError(403, "Only the customer can recapture their own verification selfie.");
  }
  if (!req.file) throw new HttpError(400, "Selfie image is required.");

  const selfieImage = await saveVerificationUpload({
    file: req.file,
    customerId: verification.user_id,
    kind: "selfie"
  });
  await query(
    `UPDATE identity_verifications
     SET selfie_image = :selfieImage,
         updated_at = NOW()
     WHERE id = :id`,
    { id: verification.id, selfieImage }
  );
  const updated = await getVerification(verification.id);
  logVerificationPaths(updated);
  res.json({
    message: "Selfie image updated.",
    verification: {
      ...verificationPayload(updated)
    }
  });
}));

export default router;
