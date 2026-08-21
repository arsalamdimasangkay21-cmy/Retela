import express from "express";
import { query } from "../config/db.js";
import { generateAIResponse } from "../utils/aiProvider.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { shippingSummary } from "../utils/shippingSettings.js";
import { availableProductWhere, ensureProductInventoryColumns } from "../utils/productInventory.js";
import { productImageExpression } from "../utils/productImages.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const router = express.Router();

router.post("/", asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!String(message || "").trim()) {
    throw new HttpError(400, "Message is required.");
  }

  await ensureProductInventoryColumns();
  const [{ config }, shipping, products] = await Promise.all([
    loadSystemSettings(),
    shippingSummary(),
    query(
      `SELECT name, brand, category, gender, size, price, stock, \`condition\`, description, ${productImageExpression("products")} AS image_url
       FROM products
       WHERE ${availableProductWhere()}
       ORDER BY created_at DESC
       LIMIT 200`
    )
  ]);
  const settings = {
    ...config,
    payment: {
      ...config.payment,
      shippingFeeType: shipping.type,
      shippingRateName: shipping.name,
      shippingFeeEnabled: shipping.enabled,
      shippingFee: Number(shipping.fee || 0)
    }
  };
  const availableProducts = products.filter((item) => Number(item.stock || 0) > 0);
  let response;
  try {
    response = await generateAIResponse(message, {
      products: availableProducts,
      history: [],
      orders: [],
      settings,
      customer: {},
      provider: settings?.ai?.aiProvider
    });
  } catch (error) {
    throw new HttpError(error.status || 502, "Retela Assistant is temporarily unavailable. Please try again shortly.");
  }

  res.json({
    reply: response.body,
    provider: response.provider,
    responseTime: response.responseTime,
    tokenUsage: response.tokenUsage
  });
}));

export default router;
