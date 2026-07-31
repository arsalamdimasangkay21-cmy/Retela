import express from "express";
import { query } from "../config/db.js";
import { generateAIResponse } from "../utils/aiProvider.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { ensureProductInventoryColumns, nonDeletedProductWhere } from "../utils/productInventory.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "Message is required",
      });
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
  } catch (error) {
    console.log(error);

    res.status(error.status || 503).json({
      error: "AI provider is not configured or unavailable. Contact administrator.",
    });
  }
});

export default router;
