import * as XLSX from "xlsx";
import { defaultReportOptions, formatDate, formatDateTime, includesReport, money, reportDateRangeLabel, selectedReportTypes, tableTotal } from "./ReportService";

function number(value) {
  return Number(value || 0).toLocaleString();
}

function paymentLabel(method) {
  if (method === "cash") return "Cash";
  if (method === "gcash") return "GCash";
  if (method === "debit") return "Debit Card";
  if (method === "credit") return "Credit Card";
  if (method === "maya") return "Maya";
  if (method === "cod") return "COD";
  return method || "";
}

function statusLabel(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function filename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return `RETELA-Analytics-Report-${stamp}.xlsx`;
}

function sheetName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function metaRows(report, options) {
  return [
    ["RETELA"],
    ["Tela To Pera Thrift Shop"],
    ["Analytics Report"],
    ["Generated", formatDateTime(new Date())],
    ["Report Date", formatDate(report.reportDate)],
    ["Prepared by", report.adminName || "Admin"],
    ["Date Range", reportDateRangeLabel(options)],
    ["Selected Reports", selectedReportTypes(options).map((item) => item.label).join(", ")],
    []
  ];
}

function appendSheet(workbook, name, report, options, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet([...metaRows(report, options), ...rows]);
  worksheet["!cols"] = rows[0]?.map((heading) => ({ wch: Math.max(14, String(heading || "").length + 4) })) || [];
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName(name));
}

function salesRows(report) {
  return [
    ["Metric", "Value"],
    ["Total Sales", money(report.summary?.total_sales)],
    ["Total Orders", number(report.summary?.total_orders)],
    ["Reportable Orders", number(report.summary?.sales_order_count)],
    ["Average Order Value", money(report.summary?.average_order_value)],
    ["Items Sold", number(report.summary?.items_sold)]
  ];
}

function ordersRows(report) {
  const orders = report.orders || [];
  const rows = [
    ["Order ID", "Date", "Customer", "Apparel", "Qty", "Payment", "Status", "Total"],
    ...orders.map((order) => [
      `#${order.id}`,
      formatDate(order.created_at),
      order.customer_name,
      order.products || "No items recorded",
      number(order.quantity),
      paymentLabel(order.payment_method),
      statusLabel(order.status),
      money(order.total_amount)
    ])
  ];
  if (orders.length) rows.push(["", "", "Totals", "", number(tableTotal(orders, "quantity")), "", "", money(tableTotal(orders, "total_amount"))]);
  if (!orders.length) rows.push(["No orders found for this date range."]);
  return rows;
}

function revenueRows(report) {
  const rows = [
    ["Payment Method", "Orders", "Revenue"],
    ...(report.charts?.paymentMethods || []).map((item) => [paymentLabel(item.payment_method), number(item.order_count), money(item.total)])
  ];
  if (rows.length === 1) rows.push(["No revenue found for this date range."]);
  return rows;
}

function itemsSoldRows(report) {
  const products = report.products || [];
  const rows = [
    ["Apparel", "Brand", "Quantity Sold", "Revenue"],
    ...products.map((product) => [product.product_name, product.brand, number(product.quantity_sold), money(product.revenue_generated)])
  ];
  if (products.length) rows.push(["Totals", "", number(tableTotal(products, "quantity_sold")), money(tableTotal(products, "revenue_generated"))]);
  if (!products.length) rows.push(["No sold items found for this date range."]);
  return rows;
}

function lowStockRows(report) {
  const rows = [
    ["ID", "Name", "Brand", "Category", "Size", "Stock", "Status"],
    ...(report.lowStockProducts || []).map((product) => [
      `#${product.id}`,
      product.name,
      product.brand || "Other Brands",
      product.category || "Apparel",
      product.size || "",
      number(product.stock),
      product.status || "Low Stock"
    ])
  ];
  if (rows.length === 1) rows.push(["No low stock apparel right now."]);
  return rows;
}

function inventoryRows(report) {
  const rows = [
    ["Inventory Summary", "Value"],
    ["Total Apparel Items", number(report.inventory?.product_count)],
    ["Total Stock", number(report.inventory?.total_stock)],
    ["Low Stock Apparel", number(report.inventory?.low_stock_count)],
    ["Out of Stock Apparel", number(report.inventory?.out_of_stock_count)],
    [],
    ["Inventory Items"],
    ["ID", "Name", "Brand", "Category", "Size", "Stock", "Price", "Status"],
    ...(report.inventoryProducts || []).map((product) => [
      `#${product.id}`,
      product.name,
      product.brand || "Other Brands",
      product.category || "Apparel",
      product.size || "",
      number(product.stock),
      money(product.price),
      product.status || ""
    ])
  ];
  if (!report.inventoryProducts?.length) rows.push(["No inventory records available."]);
  return rows;
}

function feedbackRows(report) {
  const rows = [
    ["Date", "Customer", "Rating", "Category", "Apparel", "Comment"],
    ...(report.feedback || []).map((review) => [
      formatDate(review.created_at),
      review.customer_name,
      `${number(review.rating)} / 5`,
      review.category,
      review.apparel,
      review.comment
    ])
  ];
  if (rows.length === 1) rows.push(["No customer feedback found for this date range."]);
  return rows;
}

function bestSellingRows(report) {
  const rows = [
    ["Apparel", "Brand", "Units Sold", "Revenue"],
    ...(report.topSellingProducts || []).map((product) => [product.name, product.brand, number(product.sold), money(product.revenue)])
  ];
  if (rows.length === 1) rows.push(["No best selling products found for this date range."]);
  return rows;
}

function apparelPerformanceRows(report) {
  const rows = [
    ["Apparel", "Brand", "Category", "Size", "Orders", "Qty Sold", "Revenue", "Average Price"],
    ...(report.apparelPerformance || []).map((product) => [
      product.name,
      product.brand,
      product.category || "Apparel",
      product.size || "",
      number(product.orders_count),
      number(product.quantity_sold),
      money(product.revenue),
      money(product.average_price)
    ])
  ];
  if (rows.length === 1) rows.push(["No apparel performance found for this date range."]);
  return rows;
}

function monthlySalesRows(report) {
  const rows = [
    ["Month", "Orders", "Sales"],
    ...(report.monthlySales || []).map((item) => [item.month, number(item.orders_count), money(item.total)])
  ];
  if (rows.length === 1) rows.push(["No monthly sales found for this date range."]);
  return rows;
}

export function exportSalesReportExcel({ report, range, options = defaultReportOptions }) {
  const reportOptions = { ...defaultReportOptions, ...options, dateRange: options?.dateRange || range || defaultReportOptions.dateRange };
  const workbook = XLSX.utils.book_new();
  if (includesReport(reportOptions, "salesSummary")) appendSheet(workbook, "Sales", report, reportOptions, salesRows(report));
  if (includesReport(reportOptions, "ordersSummary")) appendSheet(workbook, "Orders", report, reportOptions, ordersRows(report));
  if (includesReport(reportOptions, "revenue")) appendSheet(workbook, "Revenue", report, reportOptions, revenueRows(report));
  if (includesReport(reportOptions, "itemsSold")) appendSheet(workbook, "Items Sold", report, reportOptions, itemsSoldRows(report));
  if (includesReport(reportOptions, "lowStock")) appendSheet(workbook, "Low Stock", report, reportOptions, lowStockRows(report));
  if (includesReport(reportOptions, "inventory")) appendSheet(workbook, "Inventory", report, reportOptions, inventoryRows(report));
  if (includesReport(reportOptions, "customerFeedback")) appendSheet(workbook, "Feedback", report, reportOptions, feedbackRows(report));
  if (includesReport(reportOptions, "bestSellingProducts")) appendSheet(workbook, "Best Selling", report, reportOptions, bestSellingRows(report));
  if (includesReport(reportOptions, "apparelPerformance")) appendSheet(workbook, "Apparel Performance", report, reportOptions, apparelPerformanceRows(report));
  if (includesReport(reportOptions, "monthlySales")) appendSheet(workbook, "Monthly Sales", report, reportOptions, monthlySalesRows(report));
  if (!workbook.SheetNames.length) appendSheet(workbook, "Sales", report, reportOptions, salesRows(report));
  XLSX.writeFile(workbook, filename(new Date(report.reportDate || Date.now())));
}
