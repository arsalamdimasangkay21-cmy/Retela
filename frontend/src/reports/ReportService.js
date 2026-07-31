import { api } from "../api/client";

export const analyticsReportTypes = [
  { id: "salesSummary", label: "Sales Summary" },
  { id: "ordersSummary", label: "Orders Summary" },
  { id: "revenue", label: "Revenue" },
  { id: "itemsSold", label: "Items Sold" },
  { id: "lowStock", label: "Low Stock Report" },
  { id: "inventory", label: "Inventory Report" },
  { id: "customerFeedback", label: "Customer Feedback" },
  { id: "bestSellingProducts", label: "Best Selling Products" },
  { id: "apparelPerformance", label: "Apparel Performance" },
  { id: "monthlySales", label: "Monthly Sales" }
];

export const defaultReportOptions = {
  selectedReports: analyticsReportTypes.map((item) => item.id),
  dateRange: "last30days",
  startDate: "",
  endDate: "",
  paperSize: "a4",
  orientation: "portrait"
};

export const reportRanges = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
  { value: "last30days", label: "Last 30 Days" },
  { value: "last3months", label: "Last 3 Months" },
  { value: "last6months", label: "Last 6 Months" },
  { value: "lastyear", label: "Last Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom Range" }
];

export function money(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function normalizeReportRange(value = "all") {
  return ({
    "7d": "last7days",
    "30d": "last30days",
    "3m": "last3months",
    "6m": "last6months",
    year: "lastyear"
  })[String(value || "all").toLowerCase()] || value;
}

export function rangeLabel(range) {
  const normalizedRange = normalizeReportRange(range);
  return reportRanges.find((item) => item.value === normalizedRange)?.label || "All Time";
}

export function selectedReportTypes(options = defaultReportOptions) {
  const selected = options?.selectedReports?.length ? options.selectedReports : defaultReportOptions.selectedReports;
  return analyticsReportTypes.filter((item) => selected.includes(item.id));
}

export function includesReport(options, reportId) {
  return selectedReportTypes(options).some((item) => item.id === reportId);
}

export function reportOptionsParams(options = defaultReportOptions) {
  const dateRange = options?.dateRange || "all";
  return {
    range: dateRange,
    ...(dateRange === "custom" && options?.startDate ? { start: options.startDate, startDate: options.startDate } : {}),
    ...(dateRange === "custom" && options?.endDate ? { end: options.endDate, endDate: options.endDate } : {}),
    ts: Date.now()
  };
}

export function reportDateRangeLabel(optionsOrRange = "all") {
  if (typeof optionsOrRange === "string") return rangeLabel(optionsOrRange);
  if (optionsOrRange?.dateRange === "custom") {
    const start = optionsOrRange.startDate ? formatDate(optionsOrRange.startDate) : "Start";
    const end = optionsOrRange.endDate ? formatDate(optionsOrRange.endDate) : "End";
    return `${start} - ${end}`;
  }
  return rangeLabel(optionsOrRange?.dateRange || "all");
}

export async function fetchSalesReport(optionsOrRange = defaultReportOptions) {
  const params = typeof optionsOrRange === "string" ? { range: optionsOrRange, ts: Date.now() } : reportOptionsParams(optionsOrRange);
  const { data } = await api.get("/reports/sales", { params });
  return data;
}

export function reportFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return `RETELA-Sales-Report-${stamp}.pdf`;
}

export function tableTotal(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
}
