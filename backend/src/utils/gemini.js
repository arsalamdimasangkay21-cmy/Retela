import { HttpError } from "./errors.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 15000;

function safeProviderErrorText(value) {
  return String(value || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-key]")
    .replace(/x-goog-api-key['":\s]+[A-Za-z0-9_-]+/gi, "x-goog-api-key [redacted]")
    .slice(0, 180);
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

function providerTimeoutSignal() {
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
}

function productLine(product) {
  const stock = Number(product.stock || 0);
  return [
    product.name,
    product.brand ? `brand: ${product.brand}` : null,
    product.category ? `category: ${product.category}` : null,
    product.gender ? `gender: ${product.gender}` : null,
    product.size ? `size: ${product.size}` : null,
    product.condition ? `condition: ${product.condition}` : null,
    `price: PHP ${Number(product.price).toLocaleString()}`,
    `stock: ${stock}`,
    `availability: ${stock > 5 ? "In Stock" : stock > 0 ? "Low Stock" : "Out of Stock"}`
  ].filter(Boolean).join(", ");
}

export function isGeminiConfigured() {
  return Boolean(getGeminiApiKey());
}

export async function generateGeminiResult({ prompt, products, history, orders = [], settings = {}, customer = {} }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const inventory = products.length
    ? products.slice(0, 30).map((product, index) => `${index + 1}. ${productLine(product)}`).join("\n")
    : "No apparel items are currently in stock.";
  const recentMessages = history.slice(-10).map((message) => `${message.sender_type}: ${message.body}`).join("\n");
  const recentOrders = orders.length
    ? orders.slice(0, 5).map((order) => `Order #${order.id}: status=${order.status}, payment_status=${order.payment_status}, total=PHP ${Number(order.total_amount || 0).toLocaleString()}`).join("\n")
    : "No recent orders.";
  const customerContext = [
    customer.display_name ? `name: ${customer.display_name}` : null,
    customer.username ? `username: ${customer.username}` : null,
    customer.location ? `location: ${customer.location}` : null
  ].filter(Boolean).join(", ") || "No customer profile details.";
  const shopContext = [
    settings?.general?.shopName ? `shop: ${settings.general.shopName}` : null,
    settings?.about?.fullAddress ? `address: ${settings.about.fullAddress}` : null,
    settings?.about?.paymentMethods ? `payment methods: ${settings.about.paymentMethods}` : null,
    settings?.about?.deliveryAreas ? `delivery areas: ${settings.about.deliveryAreas}` : null,
    settings?.about?.estimatedDeliveryTime ? `delivery ETA: ${settings.about.estimatedDeliveryTime}` : null,
    settings?.about?.returnConditions ? `return conditions: ${settings.about.returnConditions}` : null,
    settings?.about?.refundProcess ? `refund process: ${settings.about.refundProcess}` : null
  ].filter(Boolean).join("\n");

  const instruction = [
    "You are Retela's thrift shop assistant for Tela to Pera.",
    "Answer customers in a friendly, concise, natural style.",
    "Use only the live inventory listed below. Do not invent apparel items, prices, sizes, or stock.",
    "Only recommend apparel items with stock greater than 0. Never recommend apparel items with stock 0.",
    "If a requested item is unavailable or not in the live inventory, say: Sorry, that apparel item is currently out of stock. Here are similar apparel items currently available. Then list name, size, price, and stock for available alternatives.",
    "Do not end mid-sentence. Finish the thought before stopping.",
    "Do not approve orders or payments. Tell customers to checkout in the shop or wait for admin confirmation.",
    "Use the customer profile, shop policies, and recent orders when relevant.",
    "If the customer asks in Filipino or mixed Filipino-English, reply in the same style.",
    "Do not repeat the same answer if it already appears in the recent chat.",
    "If the question is not about shopping, briefly steer back to T-Shirts, Caps, Jackets, prices, sizes, stock, delivery, payment, returns, or orders."
  ].join(" ");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    signal: providerTimeoutSignal(),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${instruction}\n\nShop context:\n${shopContext || "No shop details."}\n\nCustomer context:\n${customerContext}\n\nRecent orders:\n${recentOrders}\n\nLive inventory:\n${inventory}\n\nRecent chat:\n${recentMessages || "No previous messages."}\n\nCustomer: ${prompt}` }]
        }
      ],
      generationConfig: {
        temperature: Number(settings?.ai?.aiChatTemperature ?? 0.45),
        topP: 0.9,
        maxOutputTokens: 700
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new HttpError(502, `Gemini rejected the request: ${safeProviderErrorText(errorBody)}`);
    error.provider = "gemini";
    error.providerStatus = response.status;
    error.providerStatusText = response.statusText;
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason || "none";
    const blockReason = data?.promptFeedback?.blockReason || "none";
    const error = new HttpError(502, `Gemini returned empty response: finishReason=${safeProviderErrorText(finishReason)}, blockReason=${safeProviderErrorText(blockReason)}`);
    error.provider = "gemini";
    error.providerStatus = 200;
    error.code = "EMPTY_PROVIDER_RESPONSE";
    throw error;
  }
  return {
    text,
    tokenUsage: data?.usageMetadata?.totalTokenCount ?? data?.usageMetadata?.totalTokens ?? null
  };
}

export async function generateGeminiReply(args) {
  const result = await generateGeminiResult(args);
  return result?.text || null;
}
