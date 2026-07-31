import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { analyticsReportTypes, defaultReportOptions, reportDateRangeLabel } from "./ReportService";

export function AnalyticsReportModal({ state, message, onClose }) {
  const open = Boolean(state);
  const Icon = state === "loading" ? Loader2 : state === "success" ? CheckCircle2 : XCircle;
  const tone = state === "success" ? "text-neonbrand" : state === "error" ? "text-rose-300" : "text-white";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[140] grid place-items-center bg-black/65 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="w-full max-w-sm rounded-[26px] border border-green-400/20 bg-white/5 p-5 text-center shadow-[0_24px_90px_rgba(0,0,0,0.45),0_0_40px_rgba(56,255,136,0.12)] backdrop-blur-xl" initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 12 }}>
            <Icon className={`mx-auto ${state === "loading" ? "animate-spin" : ""} ${tone}`} size={36} />
            <h3 className="mt-4 font-display text-xl font-bold text-white">{state === "loading" ? "Generating Report" : state === "success" ? "Report Ready" : "Report Failed"}</h3>
            <p className="mt-2 text-sm leading-6 text-white/60">{message}</p>
            {state !== "loading" ? <button type="button" onClick={onClose} className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/70 transition hover:border-neonbrand/35 hover:text-neonbrand">Close</button> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function AnalyticsPrintOptionsModal({ open, title = "Print Analytics Report", primaryLabel = "Print", options, busy, onClose, onChange, onPreview, onPrimary }) {
  const selected = options?.selectedReports || [];
  const allSelected = selected.length === analyticsReportTypes.length;
  const canSubmit = selected.length > 0;

  function update(next) {
    onChange({ ...defaultReportOptions, ...options, ...next });
  }

  function toggleReport(reportId) {
    const nextSelected = selected.includes(reportId)
      ? selected.filter((id) => id !== reportId)
      : [...selected, reportId];
    update({ selectedReports: nextSelected });
  }

  function toggleAll() {
    update({ selectedReports: allSelected ? [] : analyticsReportTypes.map((item) => item.id) });
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[145] grid place-items-center bg-black/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[26px] border border-green-400/20 bg-[#101712]/95 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.45),0_0_40px_rgba(56,255,136,0.12)]" initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 12 }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl font-bold text-white">{title}</h3>
                <p className="mt-1 text-sm text-white/50">Choose the report sections and print format.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close report options" className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand">
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 grid gap-5">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Report Type</h4>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-neonbrand/25 bg-neonbrand/10 px-3 py-2 text-sm font-bold text-neonbrand">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[#38ff88]" />
                    Select All
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {analyticsReportTypes.map((report) => (
                    <label key={report.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2.5 text-sm font-semibold text-white/75 transition hover:border-neonbrand/30">
                      <input type="checkbox" checked={selected.includes(report.id)} onChange={() => toggleReport(report.id)} className="h-4 w-4 accent-[#38ff88]" />
                      {report.label}
                    </label>
                  ))}
                </div>
              </section>

              <section className="grid gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/38">Date Range</span>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white">
                  {reportDateRangeLabel(options || defaultReportOptions)}
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/38">Paper Size</span>
                  <select value={options?.paperSize || defaultReportOptions.paperSize} onChange={(event) => update({ paperSize: event.target.value })} className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white outline-none transition focus:border-neonbrand/60">
                    <option value="a4">A4</option>
                    <option value="letter">Letter</option>
                    <option value="legal">Legal</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/38">Orientation</span>
                  <select value={options?.orientation || defaultReportOptions.orientation} onChange={(event) => update({ orientation: event.target.value })} className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-white outline-none transition focus:border-neonbrand/60">
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </section>

              {!canSubmit ? <p className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100">Select at least one report.</p> : null}
            </div>

            <div className="mt-5 flex flex-col justify-end gap-3 sm:flex-row">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
              <button type="button" onClick={onPreview} disabled={busy || !canSubmit} className="rounded-2xl border border-neonbrand/25 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-neonbrand transition hover:border-neonbrand/60 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Preparing..." : "Preview"}</button>
              <button type="button" onClick={onPrimary} disabled={busy || !canSubmit} className="gradient-btn rounded-2xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Preparing..." : primaryLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
