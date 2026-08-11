import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, Gauge, IdCard, Loader2, Mail, Maximize2, Search, ShieldCheck, Upload, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, getApiErrorMessage } from "../api/client";
import { getCustomerDocuments } from "../api/registration";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui";
import "./CustomerDocumentsModal.css";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(value)}\n${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function statusText(value) {
  if (value === "approved") return "Active";
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : "";
}

function userCode(id) {
  return id ? `USR-${String(id).padStart(7, "0")}` : "USR-0000000";
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function fullName(user) {
  return user.display_name || user.username || "Customer";
}

function initials(name) {
  return String(name || "C")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
}

export default function CustomerDocumentsModal({ customerId, open, onClose }) {
  const { user: viewer } = useAuth();
  const modalRef = useRef(null);
  const idUploadRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageState, setImageState] = useState({
    id: { loading: false, url: "", exists: false, reason: "" },
    selfie: { loading: false, url: "", exists: false, reason: "" }
  });
  const [uploadingId, setUploadingId] = useState(false);
  const [zoom, setZoom] = useState({ id: 1, selfie: 1 });

  const revokeObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const loadProtectedImage = useCallback(async (endpoint) => {
    if (!endpoint) return { loading: false, url: "", exists: false, reason: "FILE_MISSING" };
    const response = await api.get(endpoint, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    objectUrlsRef.current.push(url);
    return { loading: false, url, exists: true, reason: "" };
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError("");
    revokeObjectUrls();
    setImageState({
      id: { loading: true, url: "", exists: false, reason: "" },
      selfie: { loading: true, url: "", exists: false, reason: "" }
    });
    try {
      const { data: response } = await getCustomerDocuments(customerId);
      setData(response);
      const verification = response?.verification || {};
      const [idImage, selfieImage] = await Promise.all([
        verification.government_id_image?.exists
          ? loadProtectedImage(verification.government_id_image.endpoint).catch((requestError) => ({ loading: false, url: "", exists: false, reason: requestError?.response?.data?.reason || "FILE_MISSING" }))
          : Promise.resolve({ loading: false, url: "", exists: false, reason: verification.government_id_image?.reason || "FILE_MISSING" }),
        verification.selfie_verification_image?.exists
          ? loadProtectedImage(verification.selfie_verification_image.endpoint).catch((requestError) => ({ loading: false, url: "", exists: false, reason: requestError?.response?.data?.reason || "FILE_MISSING" }))
          : Promise.resolve({ loading: false, url: "", exists: false, reason: verification.selfie_verification_image?.reason || "FILE_MISSING" })
      ]);
      setImageState({ id: idImage, selfie: selfieImage });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not load verification documents"));
      setImageState({
        id: { loading: false, url: "", exists: false, reason: "LOAD_FAILED" },
        selfie: { loading: false, url: "", exists: false, reason: "LOAD_FAILED" }
      });
    } finally {
      setLoading(false);
    }
  }, [customerId, loadProtectedImage, revokeObjectUrls]);

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    loadDocuments().catch(() => {
      if (!cancelled) setError("Could not load verification documents");
    });
    return () => {
      cancelled = true;
      revokeObjectUrls();
    };
  }, [customerId, loadDocuments, open, revokeObjectUrls]);

  if (!open) return null;

  function fullscreen() {
    modalRef.current?.requestFullscreen?.();
  }

  const user = data?.user || {};
  const verification = data?.verification || {};
  const isAdmin = viewer?.role === "admin";
  const faceRate = clampPercent(verification.face_match_score);
  const governmentIdRate = verification.identity_verified ? 100 : 0;
  const overallRate = Math.round((governmentIdRate + faceRate) / 2);
  const isActive = user.status === "approved";
  const verificationDate = verification.updated_at || verification.created_at || user.created_at;
  const badges = [
    { label: "Email OTP Verified", active: Boolean(verification.otp_verified), icon: Mail },
    { label: "Face Verification Passed", active: faceRate > 0, icon: ShieldCheck },
    { label: "Identity Verified", active: Boolean(verification.identity_verified), icon: IdCard },
    { label: "Account Active", active: isActive, icon: BadgeCheck }
  ];
  const verificationRows = [
    { type: "Email OTP", status: verification.otp_verified ? "Verified" : "Not verified", rate: verification.otp_verified ? 100 : 0, lastVerified: verification.otp_verified ? verificationDate : "", attempts: verification.otp_verified ? "1" : "0" },
    { type: "Face Verification", status: faceRate > 0 ? "Passed" : "Pending", rate: faceRate, lastVerified: faceRate > 0 ? verificationDate : "", attempts: faceRate > 0 ? "2" : "0" },
    { type: "Identity Verification", status: verification.identity_verified ? "Verified" : "Pending", rate: governmentIdRate, lastVerified: verification.identity_verified ? verificationDate : "", attempts: verification.id_number ? "1" : "0" },
    { type: "Account Status", status: isActive ? "Active" : statusText(user.status) || "Pending", rate: isActive ? 100 : 0, lastVerified: user.created_at, attempts: "-" }
  ];

  async function uploadGovernmentId(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !verification.id) return;
    const formData = new FormData();
    formData.append("governmentId", file);
    setUploadingId(true);
    try {
      await api.put(`/identity-verifications/${verification.id}/government-id`, formData);
      await loadDocuments();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not update Government ID image."));
    } finally {
      setUploadingId(false);
    }
  }

  return createPortal(
    <div className="customer-docs-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={modalRef} className="customer-docs-modal" role="dialog" aria-modal="true" aria-labelledby="customer-docs-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="customer-docs-header">
          <div>
            <p className="customer-docs-kicker">Verification Documents</p>
            <h2 id="customer-docs-title">Customer Verification Details</h2>
          </div>
          <button type="button" className="customer-docs-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <CustomerDocumentsSkeleton />
        ) : error ? (
          <div className="customer-docs-error">{error}</div>
        ) : (
          <div className="customer-docs-content">
            <section className="customer-profile-card">
              <div className="customer-profile-identity">
                <div className="customer-avatar">{initials(fullName(user))}</div>
                <div className="customer-profile-copy">
                  <h3>{fullName(user)}</h3>
                  <div className="customer-profile-meta">
                    <span>User ID</span>
                    <strong>{userCode(user.id || customerId)}</strong>
                  </div>
                  <p>{user.email || "No email provided"}</p>
                  <span className={`customer-status-pill ${isActive ? "is-active" : "is-pending"}`}>
                    <CheckCircle2 size={15} />
                    {isActive ? "Active Account" : `${statusText(user.status) || "Pending"} Account`}
                  </span>
                </div>
              </div>
              <div className="customer-profile-facts">
                <ProfileFact label="Role" value="Customer" icon={UserRound} />
                <ProfileFact label="Joined" value={formatDate(user.created_at) || "Not provided"} icon={CalendarDays} />
                <ProfileFact label="Last Login" value={formatDateTime(user.last_active_at) || "Not recorded"} icon={Clock3} />
              </div>
            </section>

            <section className="customer-verification-card">
              <div className="customer-verification-header">
                <div>
                  <p className="customer-docs-kicker">Verification Status</p>
                  <h3>Verification Status</h3>
                  <p>Overview of user verification progress and accuracy.</p>
                </div>
                {isAdmin ? <CircularRate value={overallRate} /> : null}
              </div>

              <div className="customer-docs-badges">
                {badges.map(({ label, active, icon: Icon }) => (
                  <span key={label} className={active ? "is-verified" : "is-unverified"}>
                    <Icon size={16} />
                    {label}
                  </span>
                ))}
              </div>

              {isAdmin ? (
                <>
                  <div className="customer-verification-table-wrap">
                    <table className="customer-verification-table">
                      <thead>
                        <tr>
                          <th>Verification Type</th>
                          <th>Status</th>
                          <th>Verification Rate</th>
                          <th>Last Verified</th>
                          <th>Attempts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verificationRows.map((row) => (
                          <tr key={row.type}>
                            <td>
                              <div className="verification-type-cell">
                                <FileCheck2 size={17} />
                                <span>{row.type}</span>
                              </div>
                            </td>
                            <td><StatusBadge status={row.status} /></td>
                            <td>
                              <div className="verification-rate-cell">
                                <strong>{row.rate}%</strong>
                                <span className="verification-progress" aria-label={`${row.rate}% verified`}>
                                  <span style={{ width: `${row.rate}%` }} />
                                </span>
                              </div>
                            </td>
                            <td>{formatDate(row.lastVerified) || "Not verified"}</td>
                            <td>{row.attempts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="customer-docs-info">
                    <Gauge size={17} />
                    <p>Overall Verification Rate is calculated using the combined confidence score from Face Verification and Government ID Verification.</p>
                  </div>
                </>
              ) : null}
            </section>

            <DetailSection title="Customer Information" items={[
              ["Username", user.username],
              ["Phone Number", user.phone_number],
              ["Location", user.location],
              ["Birthday", formatDate(user.birthday)],
              ["Gender", user.gender],
              ["Government ID Type", verification.id_type],
              ["Government ID Number", verification.id_number]
            ]} />

            <ImageSection
              title="Government ID"
              imageState={imageState.id}
              zoom={zoom.id}
              onZoomIn={() => setZoom((value) => ({ ...value, id: Math.min(2.5, value.id + 0.25) }))}
              onZoomOut={() => setZoom((value) => ({ ...value, id: Math.max(1, value.id - 0.25) }))}
              onFullscreen={fullscreen}
              filename={`retela-government-id-${user.id || customerId}.jpg`}
              missingText="Government ID image unavailable"
              recoveryLabel={isAdmin ? (uploadingId ? "Uploading..." : "Re-upload Government ID") : ""}
              onRecovery={isAdmin && !uploadingId ? () => idUploadRef.current?.click() : null}
            />
            <input ref={idUploadRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={uploadGovernmentId} />

            <ImageSection
              title="Selfie Verification"
              imageState={imageState.selfie}
              zoom={zoom.selfie}
              onZoomIn={() => setZoom((value) => ({ ...value, selfie: Math.min(2.5, value.selfie + 0.25) }))}
              onZoomOut={() => setZoom((value) => ({ ...value, selfie: Math.max(1, value.selfie - 0.25) }))}
              onFullscreen={fullscreen}
              filename={`retela-selfie-${user.id || customerId}.jpg`}
              missingText="Selfie image unavailable"
              recoveryLabel="Customer must recapture verification selfie."
            />

          </div>
        )}

        <footer className="customer-docs-footer">
          {isAdmin ? <button type="button" className="customer-docs-outline-button">View Verification Logs</button> : null}
          <Button type="button" onClick={onClose}>Close</Button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function ProfileFact({ label, value, icon: Icon }) {
  return (
    <div className="customer-profile-fact">
      <span><Icon size={16} /> {label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CircularRate({ value }) {
  const rate = clampPercent(value);
  return (
    <div className="customer-circular-rate" style={{ "--rate": `${rate}%` }}>
      <div>
        <span>Overall Verification Rate</span>
        <strong>{rate}%</strong>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "").toLowerCase();
  const positive = normalized === "verified" || normalized === "passed" || normalized === "active";
  return <span className={`verification-status-badge ${positive ? "is-positive" : "is-neutral"}`}>{status}</span>;
}

function DetailSection({ title, items }) {
  return (
    <section className="customer-docs-section">
      <h3>{title}</h3>
      <div className="customer-docs-details">
        {items.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value || "Not provided"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerDocumentsSkeleton() {
  return (
    <div className="customer-docs-skeleton">
      <div className="customer-skeleton-header">
        <span />
        <div>
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="customer-skeleton-grid">
        {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
      </div>
      <div className="customer-docs-loading"><Loader2 className="animate-spin" size={22} /> Loading documents</div>
    </div>
  );
}

function ImageSection({ title, imageState, zoom, onZoomIn, onZoomOut, onFullscreen, filename, missingText, recoveryLabel, onRecovery }) {
  const imageUrl = imageState?.url || "";
  const loading = Boolean(imageState?.loading);
  return (
    <section className="customer-docs-section">
      <div className="customer-docs-section-heading">
        <h3>{title}</h3>
        <div className="customer-docs-image-actions">
          <button type="button" onClick={onZoomIn} disabled={!imageUrl} title="Zoom"><ZoomIn size={16} /></button>
          <button type="button" onClick={onZoomOut} disabled={!imageUrl} title="Zoom out"><ZoomOut size={16} /></button>
          {imageUrl ? <a href={imageUrl} download={filename} title="Download"><Download size={16} /></a> : <button type="button" disabled title="Download"><Download size={16} /></button>}
          <button type="button" onClick={onFullscreen} disabled={!imageUrl} title="Fullscreen"><Maximize2 size={16} /></button>
        </div>
      </div>
      {loading ? (
        <div className="customer-docs-missing"><Loader2 className="animate-spin" size={22} /> Loading image</div>
      ) : imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" className="customer-docs-image-frame" title="Open image preview">
          <img src={imageUrl} alt={title} style={{ transform: `scale(${zoom})` }} />
        </a>
      ) : (
        <div className="customer-docs-missing">
          <Search size={22} />
          <span>{missingText || "Image unavailable"}</span>
          {onRecovery ? (
            <button type="button" className="customer-docs-recovery-button" onClick={onRecovery}>
              <Upload size={16} /> {recoveryLabel}
            </button>
          ) : recoveryLabel ? (
            <p>{recoveryLabel}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
