import html2canvas from "html2canvas";
import { logoFromSettings } from "../config/branding";
import { defaultReportOptions, formatDate, formatDateTime, includesReport, money, reportDateRangeLabel, selectedReportTypes, tableTotal } from "./ReportService";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function paymentLabel(method) {
  if (method === "cash") return "Cash";
  if (method === "gcash") return "GCash";
  if (method === "qrph") return "GCash / QR Ph";
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

function rows(items, render, emptyMessage, colSpan) {
  if (!items?.length) return `<tr><td colspan="${colSpan}" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
  return items.map(render).join("");
}

async function captureElement(element) {
  if (!element) return null;
  const canvas = await html2canvas(element, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
  return canvas.toDataURL("image/png");
}

function loadingHtml(message = "Loading report data...") {
  return `
    <!doctype html>
    <html>
      <head>
        <title>RETELA Analytics Report</title>
        <style>
          body { margin: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; }
          main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
          section { border: 1px solid #BEDCCA; padding: 24px; text-align: center; }
          h1 { margin: 0; color: #0F7A3B; font-size: 22px; }
          p { margin: 8px 0 0; color: #374151; }
        </style>
      </head>
      <body><main><section><h1>${escapeHtml(message)}</h1><p>Preparing the printable analytics report.</p></section></main></body>
    </html>
  `;
}

export function openPrintReportWindow() {
  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) throw new Error("Print popup was blocked by the browser.");
  printWindow.document.open();
  printWindow.document.write(loadingHtml());
  printWindow.document.close();
  return printWindow;
}

export function writePrintReportError(printWindow, message) {
  if (!printWindow || printWindow.closed) return;
  printWindow.document.open();
  printWindow.document.write(loadingHtml(message || "Unable to load report data."));
  printWindow.document.close();
}

function section(title, html) {
  return `
    <section class="report-section">
      <h2>${escapeHtml(title)}</h2>
      ${html}
    </section>
  `;
}

function table(head, body, footer = "") {
  return `
    <table>
      <thead><tr>${head.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
      ${footer ? `<tfoot>${footer}</tfoot>` : ""}
    </table>
  `;
}

function salesSummarySection(report) {
  return section("Sales Summary", table(["Metric", "Value"], `
    <tr><td>Total Sales</td><td>${escapeHtml(money(report.summary?.total_sales))}</td></tr>
    <tr><td>Total Orders</td><td>${number(report.summary?.total_orders)}</td></tr>
    <tr><td>Reportable Orders</td><td>${number(report.summary?.sales_order_count)}</td></tr>
    <tr><td>Average Order Value</td><td>${escapeHtml(money(report.summary?.average_order_value))}</td></tr>
    <tr><td>Items Sold</td><td>${number(report.summary?.items_sold)}</td></tr>
  `));
}

function ordersSummarySection(report) {
  const orders = report.orders || [];
  return section("Orders Summary", table(
    ["Order ID", "Date", "Customer", "Apparel Ordered", "Qty", "Payment", "Status", "Total"],
    rows(orders, (order) => `
      <tr>
        <td>#${escapeHtml(order.id)}</td>
        <td>${escapeHtml(formatDate(order.created_at))}</td>
        <td>${escapeHtml(order.customer_name)}</td>
        <td>${escapeHtml(order.products || "No items recorded")}</td>
        <td>${number(order.quantity)}</td>
        <td>${escapeHtml(paymentLabel(order.payment_method))}</td>
        <td>${escapeHtml(statusLabel(order.status))}</td>
        <td>${escapeHtml(money(order.total_amount))}</td>
      </tr>
    `, "No orders found for this date range.", 8),
    orders.length ? `<tr><td colspan="4">Totals</td><td>${number(tableTotal(orders, "quantity"))}</td><td></td><td></td><td>${escapeHtml(money(tableTotal(orders, "total_amount")))}</td></tr>` : ""
  ));
}

function revenueSection(report) {
  return section("Revenue", table(
    ["Payment Method", "Orders", "Revenue"],
    rows(report.charts?.paymentMethods || [], (item) => `
      <tr><td>${escapeHtml(paymentLabel(item.payment_method))}</td><td>${number(item.order_count)}</td><td>${escapeHtml(money(item.total))}</td></tr>
    `, "No revenue found for this date range.", 3)
  ));
}

function itemsSoldSection(report) {
  const products = report.products || [];
  return section("Items Sold", table(
    ["Apparel", "Brand", "Quantity Sold", "Revenue"],
    rows(products, (product) => `
      <tr><td>${escapeHtml(product.product_name)}</td><td>${escapeHtml(product.brand)}</td><td>${number(product.quantity_sold)}</td><td>${escapeHtml(money(product.revenue_generated))}</td></tr>
    `, "No sold items found for this date range.", 4),
    products.length ? `<tr><td>Totals</td><td></td><td>${number(tableTotal(products, "quantity_sold"))}</td><td>${escapeHtml(money(tableTotal(products, "revenue_generated")))}</td></tr>` : ""
  ));
}

function lowStockSection(report) {
  return section("Low Stock Report", table(
    ["ID", "Name", "Brand", "Category", "Size", "Stock", "Status"],
    rows(report.lowStockProducts || [], (product) => `
      <tr><td>#${escapeHtml(product.id)}</td><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.brand || "Other Brands")}</td><td>${escapeHtml(product.category || "Apparel")}</td><td>${escapeHtml(product.size || "")}</td><td>${number(product.stock)}</td><td>${escapeHtml(product.status || "Low Stock")}</td></tr>
    `, "No low stock apparel right now.", 7)
  ));
}

function inventorySection(report) {
  return section("Inventory", `
    ${table(["Metric", "Value"], `
      <tr><td>Total Apparel Items</td><td>${number(report.inventory?.product_count)}</td></tr>
      <tr><td>Total Stock</td><td>${number(report.inventory?.total_stock)}</td></tr>
      <tr><td>Low Stock Apparel</td><td>${number(report.inventory?.low_stock_count)}</td></tr>
      <tr><td>Out of Stock Apparel</td><td>${number(report.inventory?.out_of_stock_count)}</td></tr>
    `)}
    ${table(["ID", "Name", "Brand", "Category", "Size", "Stock", "Price", "Status"], rows(report.inventoryProducts || [], (product) => `
      <tr><td>#${escapeHtml(product.id)}</td><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.brand || "Other Brands")}</td><td>${escapeHtml(product.category || "Apparel")}</td><td>${escapeHtml(product.size || "")}</td><td>${number(product.stock)}</td><td>${escapeHtml(money(product.price))}</td><td>${escapeHtml(product.status || "")}</td></tr>
    `, "No inventory records available.", 8))}
  `);
}

function feedbackSection(report) {
  return section("Customer Feedback", table(
    ["Date", "Customer", "Rating", "Category", "Apparel", "Comment"],
    rows(report.feedback || [], (review) => `
      <tr><td>${escapeHtml(formatDate(review.created_at))}</td><td>${escapeHtml(review.customer_name)}</td><td>${number(review.rating)} / 5</td><td>${escapeHtml(review.category)}</td><td>${escapeHtml(review.apparel)}</td><td>${escapeHtml(review.comment)}</td></tr>
    `, "No customer feedback found for this date range.", 6)
  ));
}

function bestSellingSection(report) {
  return section("Best Selling Products", table(
    ["Apparel", "Brand", "Units Sold", "Revenue"],
    rows(report.topSellingProducts || [], (product) => `
      <tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.brand)}</td><td>${number(product.sold)}</td><td>${escapeHtml(money(product.revenue))}</td></tr>
    `, "No best selling products found for this date range.", 4)
  ));
}

function apparelPerformanceSection(report) {
  return section("Apparel Performance", table(
    ["Apparel", "Brand", "Category", "Size", "Orders", "Qty Sold", "Revenue", "Average Price"],
    rows(report.apparelPerformance || [], (product) => `
      <tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.brand)}</td><td>${escapeHtml(product.category || "Apparel")}</td><td>${escapeHtml(product.size || "")}</td><td>${number(product.orders_count)}</td><td>${number(product.quantity_sold)}</td><td>${escapeHtml(money(product.revenue))}</td><td>${escapeHtml(money(product.average_price))}</td></tr>
    `, "No apparel performance found for this date range.", 8)
  ));
}

function monthlySalesSection(report) {
  return section("Monthly Sales", table(
    ["Month", "Orders", "Sales"],
    rows(report.monthlySales || [], (item) => `
      <tr><td>${escapeHtml(item.month)}</td><td>${number(item.orders_count)}</td><td>${escapeHtml(money(item.total))}</td></tr>
    `, "No monthly sales found for this date range.", 3)
  ));
}

function chartsSection(options, chartImages) {
  const images = [chartImages?.sales, chartImages?.payment].filter(Boolean);
  if (!images.length) return "";
  if (!includesReport(options, "salesSummary") && !includesReport(options, "revenue") && !includesReport(options, "monthlySales")) return "";
  return section("Charts", images.map((image) => `<img class="chart-image" src="${escapeHtml(image)}" alt="Printable chart" />`).join(""));
}

function selectedSections(report, options, chartImages) {
  return [
    includesReport(options, "salesSummary") ? salesSummarySection(report) : "",
    includesReport(options, "ordersSummary") ? ordersSummarySection(report) : "",
    includesReport(options, "revenue") ? revenueSection(report) : "",
    includesReport(options, "itemsSold") ? itemsSoldSection(report) : "",
    includesReport(options, "lowStock") ? lowStockSection(report) : "",
    includesReport(options, "inventory") ? inventorySection(report) : "",
    includesReport(options, "customerFeedback") ? feedbackSection(report) : "",
    includesReport(options, "bestSellingProducts") ? bestSellingSection(report) : "",
    includesReport(options, "apparelPerformance") ? apparelPerformanceSection(report) : "",
    includesReport(options, "monthlySales") ? monthlySalesSection(report) : "",
    chartsSection(options, chartImages)
  ].filter(Boolean).join("");
}

function reportHtml(report, options, chartImages) {
  const logoUrl = logoFromSettings(report);
  const paper = options.paperSize === "legal" ? "legal" : options.paperSize === "letter" ? "letter" : "A4";
  const orientation = options.orientation === "landscape" ? "landscape" : "portrait";

  return `
    <!doctype html>
    <html>
      <head>
        <title>RETELA Analytics Report</title>
        <style>
          @page { size: ${paper} ${orientation}; margin: 14mm; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, sans-serif; font-size: 11px; }
          main { max-width: 1100px; margin: 0 auto; padding: 18px; }
          .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 14px; }
          .toolbar button { border: 1px solid #0F7A3B; background: #0F7A3B; color: #ffffff; padding: 9px 14px; font-weight: 700; cursor: pointer; }
          header { border-bottom: 2px solid #0F7A3B; padding-bottom: 12px; margin-bottom: 14px; }
          .brand { display: flex; align-items: center; gap: 10px; }
          .brand img { width: 34px; height: 34px; object-fit: cover; border: 1px solid #BEDCCA; }
          h1 { margin: 0; font-size: 20px; color: #0F7A3B; }
          .shop { margin-top: 2px; color: #374151; font-weight: 700; }
          .title { margin: 14px 0 8px; font-size: 16px; font-weight: 700; color: #111827; }
          .meta { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; max-width: 780px; }
          .meta strong { color: #111827; }
          .selected { margin: 14px 0; border-top: 1px solid #BEDCCA; border-bottom: 1px solid #BEDCCA; padding: 10px 0; }
          .selected h2, .report-section h2 { margin: 0 0 8px; color: #0F7A3B; font-size: 14px; }
          .selected ul { margin: 0; padding-left: 18px; columns: 2; }
          .report-section { break-inside: avoid; page-break-inside: avoid; margin: 18px 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; page-break-inside: auto; }
          th { background: #0F7A3B; color: #ffffff; text-align: left; }
          th, td { border: 1px solid #BEDCCA; padding: 6px; vertical-align: top; }
          tr { page-break-inside: avoid; }
          tfoot td { background: #ECFDF5; font-weight: 700; }
          .empty { color: #4B5563; text-align: center; padding: 14px; }
          .chart-image { display: block; width: 100%; max-height: 310px; object-fit: contain; border: 1px solid #BEDCCA; margin-bottom: 10px; }
          footer { border-top: 1px solid #BEDCCA; color: #4B5563; display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; }
          .page-number::after { content: "Page " counter(page) " of " counter(pages); }
          @media print {
            body { background: #ffffff; color: #111827; }
            main { max-width: none; padding: 0; }
            .no-print { display: none !important; }
            footer { position: fixed; bottom: 0; left: 0; right: 0; background: #ffffff; }
          }
        </style>
      </head>
      <body>
        <main>
          <div class="toolbar no-print">
            <button type="button" onclick="window.print()">Print</button>
          </div>
          <header>
            <div class="brand">
              <img src="${escapeHtml(logoUrl)}" alt="RETELA logo" />
              <div>
                <h1>RETELA</h1>
                <div class="shop">Tela To Pera Thrift Shop</div>
              </div>
            </div>
            <div class="title">Analytics Report</div>
            <div class="meta">
              <strong>Generated:</strong><span>${escapeHtml(formatDateTime(new Date()))}</span>
              <strong>Date:</strong><span>${escapeHtml(formatDate(report.reportDate))}</span>
              <strong>Prepared by:</strong><span>${escapeHtml(report.adminName || "Admin")}</span>
              <strong>Date Range:</strong><span>${escapeHtml(reportDateRangeLabel(options))}</span>
            </div>
          </header>
          <section class="selected">
            <h2>Selected Reports</h2>
            <ul>${selectedReportTypes(options).map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>
          </section>
          ${selectedSections(report, options, chartImages)}
          <footer>
            <span>Generated by RETELA System</span>
            <span class="page-number">Page x of y</span>
          </footer>
        </main>
      </body>
    </html>
  `;
}

async function buildChartImages(chartRefs) {
  return {
    sales: await captureElement(chartRefs?.sales?.current),
    payment: await captureElement(chartRefs?.payment?.current)
  };
}

export async function previewSalesReport(report, options = defaultReportOptions, printWindow = null, chartRefs = null) {
  const targetWindow = printWindow || openPrintReportWindow();
  const chartImages = await buildChartImages(chartRefs);
  targetWindow.document.open();
  targetWindow.document.write(reportHtml(report, { ...defaultReportOptions, ...options }, chartImages));
  targetWindow.document.close();
  targetWindow.focus();
}

export async function printSalesReport(report, options = defaultReportOptions, printWindow = null, chartRefs = null) {
  const targetWindow = printWindow || openPrintReportWindow();
  await previewSalesReport(report, options, targetWindow, chartRefs);
  await new Promise((resolve) => setTimeout(resolve, 300));
  targetWindow.print();
}
