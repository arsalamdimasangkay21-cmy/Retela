import { HttpError } from "./errors.js";
import { getOpenAiRuntimeSettings } from "./systemSettings.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 15000;

function safeProviderErrorText(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-openai-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 180);
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
    product.description ? `description: ${product.description}` : null,
    `price: PHP ${Number(product.price).toLocaleString()}`,
    `stock: ${stock}`,
    `availability: ${stock > 5 ? "In Stock" : stock > 0 ? "Low Stock" : "Out of Stock"}`
  ].filter(Boolean).join(", ");
}

export async function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function providerTimeoutSignal() {
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
}

export async function generateOpenAiResult({ prompt, products, history, orders = [], settings = {}, customer = {} }) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) return null;

  const runtime = settings?.ai ? settings.ai : await getOpenAiRuntimeSettings();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal: providerTimeoutSignal(),
    body: JSON.stringify({
      model,
      temperature: Number(runtime.aiChatTemperature ?? runtime.temperature ?? 0.25),
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: [
            "You are Retela's shopping assistant for Tela to Pera, a thrift shop.",
            "Answer in a smooth, natural, and accurate style.",
            "Use only the live inventory provided by the server. Do not invent apparel items, prices, sizes, or stock.",
            "Only recommend apparel items with stock greater than 0.",
            "Never recommend or list apparel items with stock 0.",
            "If a requested item is unavailable or not in the live inventory, reply exactly once that the apparel item is currently out of stock, then recommend similar available apparel items with name, size, price, and stock.",
            "Do not end mid-sentence. Finish the thought before stopping.",
            "Prefer direct answers first, then short helpful follow-up guidance.",
            "If the customer asks in Filipino or mixed Filipino-English, reply in the same style.",
            "Do not approve orders or payments. Tell customers to checkout in the shop or wait for admin confirmation.",
            "You may answer apparel, price, stock, sizing, delivery, payment, returns, and recent order-status questions using the provided data only.",
            "Never claim an apparel item exists unless it is in the live inventory list below.",
            "Do not repeat the same answer if it already appears in the recent chat."
          ].join(" ")
        },
        {
          role: "user",
          content: `Shop context:\n${shopContext || "No shop details."}\n\nCustomer context:\n${customerContext}\n\nRecent orders:\n${recentOrders}\n\nLive inventory:\n${inventory}\n\nRecent chat:\n${recentMessages || "No previous messages."}\n\nCustomer: ${prompt}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new HttpError(502, `OpenAI rejected the request: ${safeProviderErrorText(errorBody)}`);
    error.provider = "openai";
    error.providerStatus = response.status;
    error.providerStatusText = response.statusText;
    throw error;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason || "none";
    const error = new HttpError(502, `OpenAI returned empty response: finishReason=${safeProviderErrorText(finishReason)}`);
    error.provider = "openai";
    error.providerStatus = 200;
    error.code = "EMPTY_PROVIDER_RESPONSE";
    throw error;
  }
  return {
    text,
    tokenUsage: data?.usage?.total_tokens ?? null
  };
}

export async function generateOpenAiReply(args) {
  const result = await generateOpenAiResult(args);
  return result?.text || null;
}

function promptTokens(prompt) {
  return String(prompt || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function productMatchesPrompt(product, tokens) {
  if (!tokens.length) return false;
  const text = productLine(product).toLowerCase();
  return tokens.some((token) => text.includes(token));
}

export function generateLocalAssistantReply({ prompt, products = [], orders = [], settings = {} }) {
  const text = String(prompt || "").toLowerCase();
  const availableProducts = products.filter((product) => Number(product.stock || 0) > 0);
  const tokens = promptTokens(prompt);
  const matchedProducts = availableProducts.filter((product) => productMatchesPrompt(product, tokens));
  const productSuggestions = (matchedProducts.length ? matchedProducts : availableProducts).slice(0, 5);

  const paymentMethods = settings?.about?.paymentMethods || "GCash, Cash on Delivery, and available online payment options";
  const deliveryAreas = settings?.about?.deliveryAreas || "selected nearby areas and customer pickup points";
  const deliveryEta = settings?.about?.estimatedDeliveryTime || "1 to 3 business days after order confirmation";
  const returnConditions = settings?.about?.returnConditions || "returns are reviewed by the admin based on the shop policy";

  if (text.includes("order") || text.includes("status") || text.includes("track")) {
    if (!orders.length) return "I do not see a recent order on your account yet. You can browse available items, add them to cart, and checkout when ready.";
    const order = orders[0];
    return `Your latest order is Order #${order.id}. Status: ${order.status}. Payment status: ${order.payment_status || "pending"}. Total: PHP ${Number(order.total_amount || 0).toLocaleString()}. Please wait for admin confirmation for final approval and delivery updates.`;
  }

  if (text.includes("deliver") || text.includes("shipping") || text.includes("location")) {
    return `Delivery is available for ${deliveryAreas}. Estimated delivery time is ${deliveryEta}. Please make sure your customer profile location is complete before checkout.`;
  }

  if (text.includes("payment") || text.includes("pay") || text.includes("gcash") || text.includes("cod")) {
    return `Available payment options: ${paymentMethods}. Online payments and GCash proof still need admin verification before the order is processed.`;
  }

  if (text.includes("return") || text.includes("refund")) {
    return `For returns and refunds, ${returnConditions}. You can submit a return request from your Returns page for completed orders.`;
  }

  if (!availableProducts.length) {
    return "I can help with apparel items, prices, sizes, delivery, payment, and order updates. Right now there are no in-stock apparel items listed, so please check again later or wait for the shop to add new items.";
  }

  const productLines = productSuggestions
    .map((product) => `${product.name}${product.size ? ` (${product.size})` : ""} - PHP ${Number(product.price || 0).toLocaleString()}, stock ${product.stock}`)
    .join("; ");

  if (matchedProducts.length) {
    return `I found matching available items: ${productLines}. You can open the shop page, add the item to cart, and checkout when ready.`;
  }

  return `I can assist you with available apparel items, prices, sizes, stock, delivery, payment, returns, and order updates. Available items right now include: ${productLines}.`;
}
