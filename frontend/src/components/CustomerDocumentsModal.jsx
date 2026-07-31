import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, Gauge, IdCard, Loader2, Mail, Maximize2, Search, ShieldCheck, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { API_URL, getApiErrorMessage } from "../api/client";
import { getCustomerDocuments } from "../api/registration";
import { resolveAssetUrl } from "../config/branding";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui";
import "./CustomerDocumentsModal.css";

const assetUrl = (url) => resolveAssetUrl(url) || (!url ? "" : `${API_URL.replace(/\/api$/, "")}${url}`);

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState({ id: 1, selfie: 1 });

  useEffect(() => {
    if (!open || !customerId) return;
    setLoading(true);
    setError("");
    getCustomerDocuments(customerId)
      .then(({ data: response }) => setData(response))
      .catch((requestError) => setError(getApiErrorMessage(requestError, "Could not load verification documents")))
      .finally(() => setLoading(false));
  }, [customerId, open]);

  if (!open) return null;

  function fullscreen() {
    modalRef.current?.requestFullscreen?.();
  }

  const user = data?.user || {};
  const verification = data?.verification || {};
  const idImageUrl = assetUrl(verification.id_image);
  const selfieUrl = assetUrl(verification.selfie_image);
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
              imageUrl={idImageUrl}
              zoom={zoom.id}
              onZoomIn={() => setZoom((value) => ({ ...value, id: Math.min(2.5, value.id + 0.25) }))}
              onZoomOut={() => setZoom((value) => ({ ...value, id: Math.max(1, value.id - 0.25) }))}
              onFullscreen={fullscreen}
              filename={`retela-government-id-${user.id || customerId}.jpg`}
            />

            <ImageSection
              title="Selfie Verification"
              imageUrl={selfieUrl}
              zoom={zoom.selfie}
              onZoomIn={() => setZoom((value) => ({ ...value, selfie: Math.min(2.5, value.selfie + 0.25) }))}
              onZoomOut={() => setZoom((value) => ({ ...value, selfie: Math.max(1, value.selfie - 0.25) }))}
              onFullscreen={fullscreen}
              filename={`retela-selfie-${user.id || customerId}.jpg`}
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

function ImageSection({ title, imageUrl, zoom, onZoomIn, onZoomOut, onFullscreen, filename }) {
  return (
    <section className="customer-docs-section">
      <div className="customer-docs-section-heading">
        <h3>{title}</h3>
        <div className="customer-docs-image-actions">
          <button type="button" onClick={onZoomIn} title="Zoom"><ZoomIn size={16} /></button>
          <button type="button" onClick={onZoomOut} title="Zoom out"><ZoomOut size={16} /></button>
          {imageUrl ? <a href={imageUrl} download={filename} title="Download"><Download size={16} /></a> : <button type="button" disabled title="Download"><Download size={16} /></button>}
          <button type="button" onClick={onFullscreen} title="Fullscreen"><Maximize2 size={16} /></button>
        </div>
      </div>
      {imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" className="customer-docs-image-frame" title="Open image preview">
          <img src={imageUrl} alt={title} style={{ transform: `scale(${zoom})` }} />
        </a>
      ) : (
        <div className="customer-docs-missing"><Search size={22} /> No image available</div>
      )}
    </section>
  );
}
