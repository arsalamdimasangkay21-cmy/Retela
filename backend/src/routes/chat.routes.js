import express from "express";
import { query } from "../config/db.js";
import { generateAIResponse } from "../utils/aiProvider.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { ensureProductInventoryColumns, nonDeletedProductWhere } from "../utils/productInventory.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const router = express.Router();

router.post("/", asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!String(message || "").trim()) {
    throw new HttpError(400, "Message is required.");
  }

  await ensureProductInventoryColumns();
  const [{ config }, products] = await Promise.all([
    loadSystemSettings(),
    query(
      `SELECT name, brand, category, gender, size, price, stock, \`condition\`, description, image_url
       FROM products
       WHERE ${nonDeletedProductWhere()}
       ORDER BY created_at DESC
       LIMIT 200`
    )
  ]);
  const availableProducts = products.filter((item) => Number(item.stock || 0) > 0);
  const response = await generateAIResponse(message, {
    products: availableProducts,
    history: [],
    orders: [],
    settings: config,
    customer: {}
  });

  res.json({
    reply: response.body,
    provider: response.provider,
    responseTime: response.responseTime,
    tokenUsage: response.tokenUsage
  });
}));

export default router;
