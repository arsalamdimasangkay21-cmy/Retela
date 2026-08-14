import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { verificationUpload } from "../middleware/upload.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { readVerificationImageFile, verificationFileStatus } from "../utils/verificationFiles.js";

const router = Router();

async function getVerification(id) {
  const rows = await query(
    `SELECT id,
            user_id,
            id_image,
            OCTET_LENGTH(government_id_data) AS government_id_bytes,
            government_id_mime,
            selfie_image,
            OCTET_LENGTH(selfie_data) AS selfie_bytes,
            selfie_mime,
            otp_verified,
            identity_verified
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
    `SELECT id,
            user_id,
            id_image,
            OCTET_LENGTH(government_id_data) AS government_id_bytes,
            government_id_mime,
            selfie_image,
            OCTET_LENGTH(selfie_data) AS selfie_bytes,
            selfie_mime,
            otp_verified,
            identity_verified
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
    governmentIdBytes: Number(verification.government_id_bytes || 0),
    selfiePath: selfieStatus.path,
    selfieExists: selfieStatus.exists,
    selfieBytes: Number(verification.selfie_bytes || 0)
  });
}

function hasStoredBytes(value) {
  return Number(value || 0) > 0;
}

function imageStatus(verification, kind) {
  const isSelfie = kind === "selfie";
  const bytes = Number(verification[isSelfie ? "selfie_bytes" : "government_id_bytes"] || 0);
  if (bytes > 0) {
    return {
      path: verification[isSelfie ? "selfie_image" : "id_image"] || null,
      exists: true,
      reason: null,
      source: "database",
      bytes,
      endpoint: `/identity-verifications/${verification.id}/${isSelfie ? "selfie" : "government-id"}`
    };
  }

  const status = verificationFileStatus(verification[isSelfie ? "selfie_image" : "id_image"]);
  return {
    ...status,
    reason: status.exists ? null : "FILE_MISSING",
    source: status.exists ? "filesystem" : "missing",
    bytes: 0,
    endpoint: verification.id && status.exists ? `/identity-verifications/${verification.id}/${isSelfie ? "selfie" : "government-id"}` : null
  };
}

function logVerificationStorage(verification) {
  console.log("[verification image storage]", {
    verificationId: verification.id,
    customerId: verification.user_id,
    hasGovernmentId: hasStoredBytes(verification.government_id_bytes),
    governmentIdBytes: Number(verification.government_id_bytes || 0),
    hasSelfie: hasStoredBytes(verification.selfie_bytes),
    selfieBytes: Number(verification.selfie_bytes || 0)
  });
}

function verificationPayload(verification) {
  return {
    id: verification.id,
    user_id: verification.user_id,
    government_id_image: imageStatus(verification, "government-id"),
    selfie_verification_image: imageStatus(verification, "selfie"),
    otp_verified: Boolean(verification.otp_verified),
    identity_verified: Boolean(verification.identity_verified)
  };
}

async function getVerificationImage(id, kind) {
  const isSelfie = kind === "selfie";
  const rows = await query(
    `SELECT id,
            user_id,
            ${isSelfie ? "selfie_image" : "id_image"} AS legacy_path,
            ${isSelfie ? "selfie_data" : "government_id_data"} AS image_data,
            ${isSelfie ? "selfie_mime" : "government_id_mime"} AS image_mime
     FROM identity_verifications
     WHERE id = :id
     LIMIT 1`,
    { id }
  );
  if (!rows.length) throw new HttpError(404, "Verification record not found.");

  const row = rows[0];
  if (Buffer.isBuffer(row.image_data) && row.image_data.length > 0) {
    return {
      verification: row,
      image: {
        buffer: row.image_data,
        mime: row.image_mime || "image/jpeg",
        source: "database"
      }
    };
  }

  const file = await readVerificationImageFile(row.legacy_path);
  if (!file.exists || !file.buffer?.length) {
    return {
      verification: row,
      image: null,
      status: {
        path: file.path,
        exists: false,
        reason: file.reason || "FILE_MISSING"
      }
    };
  }

  await query(
    `UPDATE identity_verifications
     SET ${isSelfie ? "selfie_data" : "government_id_data"} = :imageData,
         ${isSelfie ? "selfie_mime" : "government_id_mime"} = :imageMime,
         updated_at = NOW()
     WHERE id = :id`,
    { id: row.id, imageData: file.buffer, imageMime: file.mime }
  );

  console.log("[verification image storage]", {
    verificationId: row.id,
    customerId: row.user_id,
    migratedFromFile: true,
    kind,
    bytes: file.buffer.length
  });

  return {
    verification: row,
    image: {
      buffer: file.buffer,
      mime: file.mime,
      source: "migrated_file"
    }
  };
}

function sendVerificationBlob(res, image) {
  res.set("Cache-Control", "private, no-store");
  res.type(image.mime || "image/jpeg");
  return res.send(image.buffer);
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
  logVerificationStorage(verification);
  res.set("Cache-Control", "no-store");
  res.json({ verification: verificationPayload(verification) });
}));

router.get("/:id/government-id", requireRole("admin"), asyncHandler(async (req, res) => {
  const { image, status } = await getVerificationImage(req.params.id, "government-id");
  if (!image) return sendMissingImageStatus(res, status);
  return sendVerificationBlob(res, image);
}));

router.get("/:id/selfie", requireRole("admin"), asyncHandler(async (req, res) => {
  const { image, status } = await getVerificationImage(req.params.id, "selfie");
  if (!image) return sendMissingImageStatus(res, status);
  return sendVerificationBlob(res, image);
}));

router.put("/:id/government-id", verificationUpload.single("governmentId"), asyncHandler(async (req, res) => {
  const verification = await getVerification(req.params.id);
  const isAdmin = req.user.role === "admin";
  const isOwner = Number(req.user.id) === Number(verification.user_id);
  if (!isAdmin && !isOwner) throw new HttpError(403, "Forbidden");
  if (!req.file) throw new HttpError(400, "Government ID image is required.");

  await query(
    `UPDATE identity_verifications
     SET government_id_data = :imageData,
         government_id_mime = :imageMime,
         updated_at = NOW()
     WHERE id = :id`,
    { id: verification.id, imageData: req.file.buffer, imageMime: req.file.mimetype }
  );
  const updated = await getVerification(verification.id);
  logVerificationPaths(updated);
  logVerificationStorage(updated);
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

  await query(
    `UPDATE identity_verifications
     SET selfie_data = :imageData,
         selfie_mime = :imageMime,
         updated_at = NOW()
     WHERE id = :id`,
    { id: verification.id, imageData: req.file.buffer, imageMime: req.file.mimetype }
  );
  const updated = await getVerification(verification.id);
  logVerificationPaths(updated);
  logVerificationStorage(updated);
  res.json({
    message: "Selfie image updated.",
    verification: {
      ...verificationPayload(updated)
    }
  });
}));

export default router;
