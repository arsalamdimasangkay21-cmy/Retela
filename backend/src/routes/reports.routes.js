import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ensureProductInventoryColumns, nonDeletedProductWhere } from "../utils/productInventory.js";
import { loadSystemSettings } from "../utils/systemSettings.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));
let productColumnsReady;
let reviewColumnsReady;

function reportableOrderCondition(alias = "o") {
  return `LOWER(TRIM(${alias}.status)) = 'completed'`;
}

const reportableOrderSql = reportableOrderCondition("o");

function normalizeReportRange(value = "all") {
  const range = String(value || "all").trim().toLowerCase();
  return ({
    "7d": "last7days",
    "30d": "last30days",
    "3m": "last3months",
    "6m": "last6months",
    year: "lastyear",
    month: "month"
  })[range] || range;
}

function dateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function reportDateFilter(inputRange = "all", inputStart = "", inputEnd = "", alias = "o") {
  const range = normalizeReportRange(inputRange);
  const column = `${alias}.created_at`;
  if (range === "today") return { range, where: `DATE(${column}) = CURDATE()`, params: {} };
  if (range === "yesterday") return { range, where: `DATE(${column}) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`, params: {} };
  if (range === "last7days") return { range, where: `${column} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`, params: {} };
  if (range === "last30days") return { range, where: `${column} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, params: {} };
  if (range === "last3months") return { range, where: `${column} >= DATE_SUB(NOW(), INTERVAL 3 MONTH)`, params: {} };
  if (range === "last6months") return { range, where: `${column} >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`, params: {} };
  if (range === "month") return { range, where: `YEAR(${column}) = YEAR(CURDATE()) AND MONTH(${column}) = MONTH(CURDATE())`, params: {} };
  if (range === "lastyear") return { range, where: `${column} >= DATE_SUB(NOW(), INTERVAL 1 YEAR)`, params: {} };
  if (range === "custom") {
    const startDate = dateOnly(inputStart);
    const endDate = dateOnly(inputEnd);
    if (startDate && endDate) return { range, where: `${column} >= :startDate AND ${column} < DATE_ADD(:endDate, INTERVAL 1 DAY)`, params: { startDate, endDate } };
    if (startDate) return { range, where: `${column} >= :startDate`, params: { startDate } };
    if (endDate) return { range, where: `${column} < DATE_ADD(:endDate, INTERVAL 1 DAY)`, params: { endDate } };
  }
  return { range: "all", where: "1 = 1", params: {} };
}

async function ensureProductColumns() {
  productColumnsReady ||= ensureProductInventoryColumns();
  return productColumnsReady;
}

async function ensureReviewColumns() {
  reviewColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'reviews'
         AND COLUMN_NAME IN ('order_id', 'category')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("order_id")) {
      await query("ALTER TABLE reviews ADD COLUMN order_id INT NULL AFTER user_id");
      await query("CREATE INDEX idx_reviews_order ON reviews(order_id)").catch(() => {});
    }
    if (!columns.has("category")) {
      await query("ALTER TABLE reviews ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'Overall Experience' AFTER rating");
    }
  })().catch((error) => {
    reviewColumnsReady = undefined;
    throw error;
  });
  return reviewColumnsReady;
}

const getAnalyticsSummary = asyncHandler(async (req, res) => {
  await ensureProductColumns();
  const start = req.query.start || req.query.startDate;
  const end = req.query.end || req.query.endDate;
  const { range, where: rangeSql, params: rangeParams } = reportDateFilter(req.query.range, start, end, "o");
  const { where: itemRangeSql, params: itemRangeParams } = reportDateFilter(req.query.range, start, end, "item_orders");
  const { where: reviewRangeSql, params: reviewRangeParams } = reportDateFilter(req.query.range, start, end, "r");
  const { where: productRangeSql, params: productRangeParams } = reportDateFilter(req.query.range, start, end, "p");
  const [sales] = await query(`
    SELECT
      COALESCE(SUM(o.total_amount), 0) AS total_sales,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(AVG(o.total_amount), 0) AS average_order_value,
      (
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM orders item_orders
        JOIN order_items oi ON oi.order_id = item_orders.id
        WHERE ${itemRangeSql} AND ${reportableOrderCondition("item_orders")}
      ) AS items_sold
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
  `, { ...rangeParams, ...itemRangeParams });
  const [inventory] = await query(`
    SELECT COUNT(*) AS product_count,
      COALESCE(SUM(stock),0) AS total_stock,
      COALESCE(SUM(stock > 0 AND stock <= 5),0) AS low_stock_count
    FROM products p
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql}
  `, productRangeParams);
  const [ratings] = await query(`
    SELECT COALESCE(AVG(rating),0) AS average_rating, COUNT(*) AS review_count
    FROM reviews r
    JOIN orders review_orders ON review_orders.id = r.order_id
    WHERE ${reviewRangeSql} AND ${reportableOrderCondition("review_orders")}
  `, reviewRangeParams);
  const bestProducts = await query(
    `SELECT p.name,
       p.category,
       p.image_url,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
     FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY p.id, p.name, p.category, p.image_url ORDER BY sold DESC LIMIT 5`,
    rangeParams
  );
  const categorySales = await query(
    `SELECT p.category,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY p.category
     ORDER BY total DESC`,
    rangeParams
  );
  const paymentMethods = await query(
    `SELECT o.payment_method,
       COUNT(DISTINCT o.id) AS order_count,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY o.payment_method`,
    rangeParams
  );
  const monthlySales = await query(
    `SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS month, SUM(oi.quantity * oi.price) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY month ORDER BY month DESC LIMIT 12`,
    rangeParams
  );
  const dailySales = await query(
    `SELECT DATE(o.created_at) AS sale_date,
       DATE_FORMAT(o.created_at, '%b %d') AS day,
       SUM(oi.quantity * oi.price) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY sale_date, day
     ORDER BY sale_date DESC
     LIMIT 30`,
    rangeParams
  );
  const refunds = await query("SELECT status, COUNT(*) AS count FROM returns GROUP BY status");
  const brandSales = await query(
    `SELECT COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql}
     GROUP BY COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
     ORDER BY total DESC
     LIMIT 10`,
    rangeParams
  );
  const orderStatuses = await query(`SELECT status, COUNT(*) AS count FROM orders o WHERE ${rangeSql} AND ${reportableOrderSql} GROUP BY status`, rangeParams);
  res.json({ range, startDate: dateOnly(start), endDate: dateOnly(end), sales, inventory, ratings, bestProducts, categorySales, paymentMethods, monthlySales: monthlySales.reverse(), dailySales: dailySales.reverse(), refunds, brandSales, orderStatuses });
});

router.get("/", getAnalyticsSummary);
router.get("/summary", getAnalyticsSummary);

router.get("/sales", asyncHandler(async (req, res) => {
  await ensureProductColumns();
  await ensureReviewColumns();
  const start = req.query.start || req.query.startDate;
  const end = req.query.end || req.query.endDate;
  const { range, where: rangeSql, params: rangeParams } = reportDateFilter(req.query.range, start, end, "o");
  const { where: reviewRangeSql, params: reviewRangeParams } = reportDateFilter(req.query.range, start, end, "r");
  const { where: productRangeSql, params: productRangeParams } = reportDateFilter(req.query.range, start, end, "p");
  const { config } = await loadSystemSettings();

  const [orderSummary] = await query(`
    SELECT
      COUNT(DISTINCT o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_sales,
      COUNT(DISTINCT o.id) AS sales_order_count,
      COALESCE(AVG(o.total_amount), 0) AS average_order_value
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
  `, rangeParams);
  const [itemsSummary] = await query(`
    SELECT COALESCE(SUM(oi.quantity), 0) AS items_sold
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE ${rangeSql} AND ${reportableOrderSql}
  `, rangeParams);
  const summary = {
    ...orderSummary,
    total_sales: Number(orderSummary?.total_sales || 0),
    total_orders: Number(orderSummary?.total_orders || 0),
    sales_order_count: Number(orderSummary?.sales_order_count || 0),
    average_order_value: Number(orderSummary?.average_order_value || 0),
    items_sold: Number(itemsSummary?.items_sold || 0)
  };

  const orders = await query(`
    SELECT
      o.id,
      COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer') AS customer_name,
      COALESCE(GROUP_CONCAT(CONCAT(order_products.product_name, ' x', order_products.quantity) ORDER BY order_products.product_name SEPARATOR ', '), '') AS products,
      COALESCE(SUM(order_products.quantity), 0) AS quantity,
      o.payment_method,
      o.payment_status,
      o.status,
      o.order_channel,
      o.total_amount,
      o.created_at
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN (
      SELECT
        oi.order_id,
        p.id AS product_id,
        p.name AS product_name,
        SUM(oi.quantity) AS quantity
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      GROUP BY oi.order_id, p.id, p.name
    ) order_products ON order_products.order_id = o.id
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY o.id, COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer'), o.payment_method, o.payment_status, o.status, o.order_channel, o.total_amount, o.created_at
    ORDER BY o.created_at DESC
  `, rangeParams);

  const products = await query(`
    SELECT
      p.name AS product_name,
      COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
      COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue_generated
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
    ORDER BY revenue_generated DESC
  `, rangeParams);

  const customers = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer') AS customer,
      COUNT(DISTINCT o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_spent
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY COALESCE(u.id, 0), COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer')
    ORDER BY total_spent DESC
  `, rangeParams);

  const salesOverTime = await query(`
    SELECT
      DATE(o.created_at) AS date,
      DATE_FORMAT(o.created_at, '%b %d') AS label,
      COALESCE(SUM(o.total_amount), 0) AS total
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY DATE(o.created_at), label
    ORDER BY DATE(o.created_at) ASC
  `, rangeParams);

  const paymentMethods = await query(`
    SELECT
      o.payment_method,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS total
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY o.payment_method
  `, rangeParams);

  const [inventory] = await query(`
    SELECT
      COUNT(*) AS product_count,
      COALESCE(SUM(stock), 0) AS total_stock,
      COALESCE(SUM(stock > 0 AND stock <= 3), 0) AS low_stock_count,
      COALESCE(SUM(stock = 0), 0) AS out_of_stock_count
    FROM products p
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql}
  `, productRangeParams);

  const inventoryProducts = await query(`
    SELECT id, name, brand, category, size, color, price, stock, status
    FROM products p
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql}
    ORDER BY name ASC
  `, productRangeParams);

  const lowStockProducts = await query(`
    SELECT id, name, brand, category, size, stock, status
    FROM products p
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql} AND stock > 0 AND stock <= 5
    ORDER BY stock ASC, name ASC
  `, productRangeParams);

  const topSellingProducts = await query(`
    SELECT
      p.name,
      COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
      COALESCE(SUM(oi.quantity), 0) AS sold,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
    ORDER BY sold DESC
    LIMIT 8
  `, rangeParams);

  const apparelPerformance = await query(`
    SELECT
      p.name,
      COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
      p.category,
      p.size,
      COUNT(DISTINCT o.id) AS orders_count,
      COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
      COALESCE(AVG(oi.price), 0) AS average_price
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands'), p.category, p.size
    ORDER BY revenue DESC
  `, rangeParams);

  const monthlySales = await query(`
    SELECT
      DATE_FORMAT(o.created_at, '%Y-%m') AS month,
      COALESCE(SUM(o.total_amount), 0) AS total,
      COUNT(DISTINCT o.id) AS orders_count
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
    ORDER BY month ASC
  `, rangeParams);

  const feedback = await query(`
    SELECT
      r.id,
      r.rating,
      r.category,
      r.comment,
      r.created_at,
      COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Customer') AS customer_name,
      COALESCE(GROUP_CONCAT(DISTINCT op.name ORDER BY op.name SEPARATOR ', '), p.name, 'Order feedback') AS apparel
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN products p ON p.id = r.product_id
    JOIN orders o ON o.id = r.order_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products op ON op.id = oi.product_id
    WHERE ${reviewRangeSql} AND ${reportableOrderSql}
    GROUP BY r.id, r.rating, r.category, r.comment, r.created_at, COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Customer'), p.name
    ORDER BY r.created_at DESC
    LIMIT 200
  `, reviewRangeParams);

  const orderStatuses = await query(`
    SELECT status, COUNT(*) AS count
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql}
    GROUP BY status
  `, rangeParams);

  res.json({
    range,
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    reportDate: new Date().toISOString(),
    adminName: req.user.display_name || req.user.username,
    general: config.general,
    summary,
    orders,
    products,
    customers,
    charts: { salesOverTime, paymentMethods },
    inventory,
    inventoryProducts,
    lowStockProducts,
    topSellingProducts,
    apparelPerformance,
    monthlySales,
    feedback,
    orderStatuses
  });
}));

router.get("/inventory", asyncHandler(async (req, res) => {
  await ensureProductColumns();
  const rows = await query(`SELECT id, name, brand, category, size, stock, price, stock > 0 AND stock <= 5 AS low_stock FROM products WHERE ${nonDeletedProductWhere()} ORDER BY stock ASC`);
  res.json(rows);
}));

export default router;
