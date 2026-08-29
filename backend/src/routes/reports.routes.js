import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ensureProductInventoryColumns, nonDeletedProductWhere } from "../utils/productInventory.js";
import { productImageExpression } from "../utils/productImages.js";
import { loadSystemSettings } from "../utils/systemSettings.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));
let productColumnsReady;
let reviewColumnsReady;

function reportableOrderCondition(alias = "o") {
  const status = `LOWER(TRIM(${alias}.status))`;
  const paymentStatus = `LOWER(TRIM(COALESCE(${alias}.payment_status, '')))`;
  const paymentMethod = `LOWER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(${alias}.payment_method, '')), ' ', ''), '_', ''), '-', ''))`;
  return `(${status} = 'completed'
    AND ${paymentStatus} NOT IN ('failed', 'expired', 'cancelled')
    AND (${paymentStatus} IN ('paid', 'refunded') OR ${paymentMethod} IN ('cod', 'cash', 'cashondelivery', 'cashupondelivery', 'payondelivery', 'paymentondelivery')))`;
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

function normalizeSalesChannel(value = "all") {
  const channel = String(value || "all").trim().toLowerCase();
  if (channel === "pos") return "pos";
  if (channel === "online" || channel === "online_order" || channel === "online-order") return "online";
  return "all";
}

function reportChannelFilter(inputChannel = "all", alias = "o") {
  const channel = normalizeSalesChannel(inputChannel);
  if (channel === "all") return { channel, where: "1 = 1", params: {} };
  return { channel, where: `${alias}.order_channel = :salesChannel`, params: { salesChannel: channel } };
}

function intQueryParam(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function soldItemsOrderNumberSql(alias = "o") {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${alias}.order_channel, 'online'))) = 'pos'
      THEN COALESCE(NULLIF(TRIM(${alias}.transaction_id), ''), CONCAT('POS-', LPAD(${alias}.id, 5, '0')))
    ELSE CONCAT('#ORD-', YEAR(${alias}.created_at), '-', LPAD(${alias}.id, 5, '0'))
  END`;
}

function soldItemsSearchSql() {
  return `(
    LOWER(p.name) LIKE :search
    OR LOWER(COALESCE(p.sku, '')) LIKE :search
    OR LOWER(COALESCE(p.brand, '')) LIKE :search
    OR LOWER(COALESCE(p.category, '')) LIKE :search
    OR LOWER(COALESCE(u.display_name, '')) LIKE :search
    OR LOWER(COALESCE(u.username, '')) LIKE :search
    OR LOWER(COALESCE(o.transaction_id, '')) LIKE :search
    OR CAST(o.id AS CHAR) LIKE :search
    OR LOWER(${soldItemsOrderNumberSql("o")}) LIKE :search
  )`;
}

function soldItemsBaseSelect(whereSql) {
  return `
    SELECT
      oi.id AS sale_item_id,
      o.id AS order_id,
      o.order_channel,
      ${soldItemsOrderNumberSql("o")} AS order_number,
      p.id AS product_id,
      p.sku,
      p.name AS product_name,
      p.brand,
      p.category,
      p.size,
      p.\`condition\`,
      ${productImageExpression("p")} AS image_url,
      oi.quantity AS quantity_sold,
      oi.price AS unit_price,
      (oi.quantity * oi.price) AS total_amount,
      COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer') AS customer_name,
      o.payment_method,
      o.payment_status,
      o.status AS order_status,
      o.created_at AS sold_at,
      EXISTS(
        SELECT 1
        FROM returns r
        WHERE r.order_id = o.id
          AND (r.product_id IS NULL OR r.product_id = oi.product_id)
          AND r.status IN ('approved', 'refunded')
        LIMIT 1
      ) AS returned,
      EXISTS(
        SELECT 1
        FROM returns r
        WHERE r.order_id = o.id
          AND (r.product_id IS NULL OR r.product_id = oi.product_id)
          AND r.status = 'refunded'
        LIMIT 1
      ) AS refunded
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE ${whereSql}
  `;
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
  const { config } = await loadSystemSettings();
  const lowStockThreshold = Math.max(0, Number(config?.inventory?.lowStockThreshold ?? 3));
  const start = req.query.start || req.query.startDate;
  const end = req.query.end || req.query.endDate;
  const { range, where: rangeSql, params: rangeParams } = reportDateFilter(req.query.range, start, end, "o");
  const { where: itemRangeSql, params: itemRangeParams } = reportDateFilter(req.query.range, start, end, "item_orders");
  const { where: reviewRangeSql, params: reviewRangeParams } = reportDateFilter(req.query.range, start, end, "r");
  const { where: productRangeSql, params: productRangeParams } = reportDateFilter(req.query.range, start, end, "p");
  const { channel, where: channelSql, params: channelParams } = reportChannelFilter(req.query.channel, "o");
  const { where: itemChannelSql } = reportChannelFilter(req.query.channel, "item_orders");
  const { where: reviewChannelSql } = reportChannelFilter(req.query.channel, "review_orders");
  const [sales] = await query(`
    SELECT
      COALESCE(SUM(o.total_amount), 0) AS total_sales,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(AVG(o.total_amount), 0) AS average_order_value,
      (
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM orders item_orders
        JOIN order_items oi ON oi.order_id = item_orders.id
        WHERE ${itemRangeSql} AND ${reportableOrderCondition("item_orders")} AND ${itemChannelSql}
      ) AS items_sold
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
  `, { ...rangeParams, ...itemRangeParams, ...channelParams });
  const [inventory] = await query(`
    SELECT COUNT(*) AS product_count,
      COALESCE(SUM(stock),0) AS total_stock,
      COALESCE(SUM(stock > 0 AND stock <= ${lowStockThreshold}),0) AS low_stock_count
    FROM products p
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql}
  `, productRangeParams);
  const [ratings] = await query(`
    SELECT COALESCE(AVG(rating),0) AS average_rating, COUNT(*) AS review_count
    FROM reviews r
    JOIN orders review_orders ON review_orders.id = r.order_id
    WHERE ${reviewRangeSql} AND ${reportableOrderCondition("review_orders")} AND ${reviewChannelSql}
  `, { ...reviewRangeParams, ...channelParams });
  const bestProducts = await query(
    `SELECT p.name,
       p.category,
       CASE WHEN MAX(p.image_data IS NOT NULL) THEN CONCAT('/api/products/', p.id, '/image') ELSE MAX(p.image_url) END AS image_url,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
     FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY p.id, p.name, p.category ORDER BY sold DESC LIMIT 5`,
    { ...rangeParams, ...channelParams }
  );
  const categorySales = await query(
    `SELECT p.category,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY p.category
     ORDER BY total DESC`,
    { ...rangeParams, ...channelParams }
  );
  const paymentMethods = await query(
    `SELECT o.payment_method,
       COUNT(DISTINCT o.id) AS order_count,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY o.payment_method`,
    { ...rangeParams, ...channelParams }
  );
  const monthlySales = await query(
    `SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS month, SUM(oi.quantity * oi.price) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY month ORDER BY month DESC LIMIT 12`,
    { ...rangeParams, ...channelParams }
  );
  const dailySales = await query(
    `SELECT DATE(o.created_at) AS sale_date,
       DATE_FORMAT(o.created_at, '%b %d') AS day,
       SUM(oi.quantity * oi.price) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY sale_date, day
     ORDER BY sale_date DESC
     LIMIT 30`,
    { ...rangeParams, ...channelParams }
  );
  const refunds = await query("SELECT status, COUNT(*) AS count FROM returns GROUP BY status");
  const brandSales = await query(
    `SELECT COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
       SUM(oi.quantity) AS sold,
       COALESCE(SUM(oi.quantity * oi.price), 0) AS total
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
     ORDER BY total DESC
     LIMIT 10`,
    { ...rangeParams, ...channelParams }
  );
  const channelBreakdown = await query(
    `SELECT o.order_channel,
       COUNT(DISTINCT o.id) AS order_count,
       COALESCE(SUM(o.total_amount), 0) AS total
     FROM orders o
     WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
     GROUP BY o.order_channel`,
    { ...rangeParams, ...channelParams }
  );
  const orderStatuses = await query(`SELECT status, COUNT(*) AS count FROM orders o WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql} GROUP BY status`, { ...rangeParams, ...channelParams });
  res.json({ range, channel, startDate: dateOnly(start), endDate: dateOnly(end), sales, inventory, ratings, bestProducts, categorySales, paymentMethods, monthlySales: monthlySales.reverse(), dailySales: dailySales.reverse(), refunds, brandSales, channelBreakdown, orderStatuses });
});

router.get("/", getAnalyticsSummary);
router.get("/summary", getAnalyticsSummary);

router.get("/sold-items", asyncHandler(async (req, res) => {
  await ensureProductColumns();
  const start = req.query.start || req.query.startDate;
  const end = req.query.end || req.query.endDate;
  const { range, where: rangeSql, params: rangeParams } = reportDateFilter(req.query.range, start, end, "o");
  const { channel, where: channelSql, params: channelParams } = reportChannelFilter(req.query.channel, "o");
  const searchText = String(req.query.search || "").trim().slice(0, 120);
  const soldDate = dateOnly(req.query.date || req.query.soldDate);
  const page = intQueryParam(req.query.page, 1, 1, 100000);
  const pageSize = intQueryParam(req.query.pageSize, 10, 1, 500);
  const whereParts = [rangeSql, reportableOrderSql, channelSql];
  const params = { ...rangeParams, ...channelParams };
  if (soldDate) {
    whereParts.push("DATE(o.created_at) = :soldDate");
    params.soldDate = soldDate;
  }
  if (searchText) {
    whereParts.push(soldItemsSearchSql());
    params.search = `%${searchText.toLowerCase()}%`;
  }

  const baseSelect = soldItemsBaseSelect(whereParts.join(" AND "));
  const [totals] = await query(
    `SELECT
       COUNT(*) AS total_rows,
       COALESCE(SUM(quantity_sold), 0) AS total_quantity,
       COALESCE(SUM(total_amount), 0) AS total_amount
     FROM (${baseSelect}) sold_items`,
    params
  );
  const totalRows = Number(totals?.total_rows || 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;
  const items = await query(
    `${baseSelect}
     ORDER BY sold_at DESC, sale_item_id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  res.json({
    range,
    channel,
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    date: soldDate,
    search: searchText,
    totals: {
      totalRows,
      totalQuantity: Number(totals?.total_quantity || 0),
      totalAmount: Number(totals?.total_amount || 0)
    },
    pagination: {
      page: currentPage,
      pageSize,
      totalPages,
      totalRows
    },
    items: items.map((item) => ({
      ...item,
      sale_item_id: Number(item.sale_item_id),
      order_id: Number(item.order_id),
      product_id: Number(item.product_id),
      quantity_sold: Number(item.quantity_sold || 0),
      unit_price: Number(item.unit_price || 0),
      total_amount: Number(item.total_amount || 0),
      returned: Boolean(Number(item.returned || 0)),
      refunded: Boolean(Number(item.refunded || 0))
    }))
  });
}));

router.get("/sales", asyncHandler(async (req, res) => {
  await ensureProductColumns();
  await ensureReviewColumns();
  const { config } = await loadSystemSettings();
  const lowStockThreshold = Math.max(0, Number(config?.inventory?.lowStockThreshold ?? 3));
  const start = req.query.start || req.query.startDate;
  const end = req.query.end || req.query.endDate;
  const { range, where: rangeSql, params: rangeParams } = reportDateFilter(req.query.range, start, end, "o");
  const { where: reviewRangeSql, params: reviewRangeParams } = reportDateFilter(req.query.range, start, end, "r");
  const { where: productRangeSql, params: productRangeParams } = reportDateFilter(req.query.range, start, end, "p");
  const { channel, where: channelSql, params: channelParams } = reportChannelFilter(req.query.channel, "o");
  const { where: reviewChannelSql } = reportChannelFilter(req.query.channel, "o");
  const [orderSummary] = await query(`
    SELECT
      COUNT(DISTINCT o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_sales,
      COUNT(DISTINCT o.id) AS sales_order_count,
      COALESCE(AVG(o.total_amount), 0) AS average_order_value
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
  `, { ...rangeParams, ...channelParams });
  const [itemsSummary] = await query(`
    SELECT COALESCE(SUM(oi.quantity), 0) AS items_sold
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
  `, { ...rangeParams, ...channelParams });
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
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY o.id, COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer'), o.payment_method, o.payment_status, o.status, o.order_channel, o.total_amount, o.created_at
    ORDER BY o.created_at DESC
  `, { ...rangeParams, ...channelParams });

  const products = await query(`
    SELECT
      p.name AS product_name,
      COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands') AS brand,
      COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue_generated
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
    ORDER BY revenue_generated DESC
  `, { ...rangeParams, ...channelParams });

  const customers = await query(`
    SELECT
      COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer') AS customer,
      COUNT(DISTINCT o.id) AS total_orders,
      COALESCE(SUM(o.total_amount), 0) AS total_spent
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY COALESCE(u.id, 0), COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Walk-in Customer')
    ORDER BY total_spent DESC
  `, { ...rangeParams, ...channelParams });

  const salesOverTime = await query(`
    SELECT
      DATE(o.created_at) AS date,
      DATE_FORMAT(o.created_at, '%b %d') AS label,
      COALESCE(SUM(o.total_amount), 0) AS total
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY DATE(o.created_at), label
    ORDER BY DATE(o.created_at) ASC
  `, { ...rangeParams, ...channelParams });

  const paymentMethods = await query(`
    SELECT
      o.payment_method,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS total
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY o.payment_method
  `, { ...rangeParams, ...channelParams });

  const [inventory] = await query(`
    SELECT
      COUNT(*) AS product_count,
      COALESCE(SUM(stock), 0) AS total_stock,
      COALESCE(SUM(stock > 0 AND stock <= ${lowStockThreshold}), 0) AS low_stock_count,
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
    WHERE ${nonDeletedProductWhere("p.")} AND ${productRangeSql} AND stock > 0 AND stock <= ${lowStockThreshold}
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
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands')
    ORDER BY sold DESC
    LIMIT 8
  `, { ...rangeParams, ...channelParams });

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
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY p.id, p.name, COALESCE(NULLIF(TRIM(p.brand), ''), 'Other Brands'), p.category, p.size
    ORDER BY revenue DESC
  `, { ...rangeParams, ...channelParams });

  const monthlySales = await query(`
    SELECT
      DATE_FORMAT(o.created_at, '%Y-%m') AS month,
      COALESCE(SUM(o.total_amount), 0) AS total,
      COUNT(DISTINCT o.id) AS orders_count
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
    ORDER BY month ASC
  `, { ...rangeParams, ...channelParams });

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
    WHERE ${reviewRangeSql} AND ${reportableOrderSql} AND ${reviewChannelSql}
    GROUP BY r.id, r.rating, r.category, r.comment, r.created_at, COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'Customer'), p.name
    ORDER BY r.created_at DESC
    LIMIT 200
  `, { ...reviewRangeParams, ...channelParams });

  const orderStatuses = await query(`
    SELECT status, COUNT(*) AS count
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY status
  `, { ...rangeParams, ...channelParams });

  const channelBreakdown = await query(`
    SELECT
      o.order_channel,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS total
    FROM orders o
    WHERE ${rangeSql} AND ${reportableOrderSql} AND ${channelSql}
    GROUP BY o.order_channel
  `, { ...rangeParams, ...channelParams });

  res.json({
    range,
    channel,
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
    channelBreakdown,
    orderStatuses
  });
}));

router.get("/inventory", asyncHandler(async (req, res) => {
  await ensureProductColumns();
  const { config } = await loadSystemSettings();
  const lowStockThreshold = Math.max(0, Number(config?.inventory?.lowStockThreshold ?? 3));
  const rows = await query(`SELECT id, name, brand, category, size, stock, price, stock > 0 AND stock <= ${lowStockThreshold} AS low_stock FROM products WHERE ${nonDeletedProductWhere()} ORDER BY stock ASC`);
  res.json(rows);
}));

export default router;
