import { HttpError } from "./errors.js";
import { getOpenAiRuntimeSettings } from "./systemSettings.js";
import {
  buildRetelaAssistantContext,
  CHAT_INTENTS,
  detectChatIntent,
  findBestProductMatch,
  formatMoney,
  resolveReferencedProduct
} from "./retelaAssistantContext.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 15000;

function safeProviderErrorText(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-openai-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 180);
}

export async function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function providerTimeoutSignal() {
  const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
}

export async function generateOpenAiResult({ prompt, products = [], history = [], orders = [], settings = {}, customer = {}, assistantContext = null }) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) return null;

  const runtime = settings?.ai ? settings.ai : await getOpenAiRuntimeSettings();
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const context = assistantContext || buildRetelaAssistantContext({ prompt, products, history, orders, settings, customer });

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
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content: context.systemPrompt
        },
        {
          role: "user",
          content: context.userContext
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

export function generateLocalAssistantReply({ prompt, products = [], history = [], orders = [], settings = {} }) {
  const text = String(prompt || "").toLowerCase();
  const intent = detectChatIntent(prompt);
  const availableProducts = products.filter((product) => Number(product.stock || 0) > 0);
  const referencedProduct = resolveReferencedProduct(prompt, products, history);
  const matchedProduct = referencedProduct || findBestProductMatch(prompt, availableProducts);

  const paymentMethods = settings?.about?.paymentMethods || "GCash, Cash on Delivery, and available online payment options";
  const deliveryAreas = settings?.about?.deliveryAreas || "selected nearby areas and customer pickup points";
  const deliveryEta = settings?.about?.estimatedDeliveryTime || "1 to 3 business days after order confirmation";
  const returnConditions = settings?.about?.returnConditions || "returns are reviewed by the admin based on the shop policy";
  const shippingEnabled = settings?.payment?.shippingFeeEnabled ?? settings?.payment?.shippingFeeType !== "free";
  const shippingFee = shippingEnabled ? Number(settings?.payment?.shippingFee || 0) : 0;

  if (intent === CHAT_INTENTS.GREETING) return "Hi! Welcome to RETELA. I can help you check products, availability, orders, shipping, payments, or returns.";
  if (intent === CHAT_INTENTS.THANKS) return "You're welcome! Let me know if you need anything else.";
  if (intent === CHAT_INTENTS.SECURITY) {
    if (/\b(another customer|other customer|someone else|someone else's|ibang customer)\b/i.test(prompt)) {
      return "I can't share another customer's private order or account information. I can only help you check your own RETELA orders and account details.";
    }
    return "I can't share internal instructions or private system information. I can help with RETELA products, orders, shipping, payments, and returns.";
  }

  if ([CHAT_INTENTS.ORDER_STATUS, CHAT_INTENTS.ORDER_TRACKING].includes(intent)) {
    if (!orders.length) return "I do not see a recent order on your account yet. You can browse available items, add them to cart, and checkout when ready.";
    const order = orders[0];
    return `Your latest order is Order #${order.id}. Status: ${order.status}. Payment status: ${order.payment_status || "pending"}. Total: ${formatMoney(order.total_amount)}.`;
  }

  if (intent === CHAT_INTENTS.SHIPPING) {
    return `Shipping fee: ${formatMoney(shippingFee)}. Delivery is available for ${deliveryAreas}. Estimated delivery time is ${deliveryEta}.`;
  }

  if (intent === CHAT_INTENTS.PAYMENT) {
    return `Available payment options: ${paymentMethods}. Online payments and GCash proof still need admin verification before the order is processed.`;
  }

  if (intent === CHAT_INTENTS.RETURN_REFUND) {
    return `For returns and refunds, ${returnConditions}. You can submit a return request from your Returns page for completed orders.`;
  }

  if (intent === CHAT_INTENTS.PRODUCT_PRICE && matchedProduct) return `${matchedProduct.name} is ${formatMoney(matchedProduct.price)}.`;

  if (intent === CHAT_INTENTS.PRODUCT_SIZE && matchedProduct) return `${matchedProduct.name} is size ${matchedProduct.size || "currently unavailable"}.`;

  if (intent === CHAT_INTENTS.PRODUCT_CONDITION && matchedProduct) return `${matchedProduct.name} condition: ${matchedProduct.condition || "currently unavailable"}.`;

  if (intent === CHAT_INTENTS.PRODUCT_AVAILABILITY && matchedProduct) {
    const stock = Number(matchedProduct.stock || 0);
    if (stock > 0) return `Yes, ${matchedProduct.name} is currently available. Current stock: ${stock}.`;
    return `${matchedProduct.name} is currently out of stock.`;
  }

  if ([CHAT_INTENTS.PRODUCT_PRICE, CHAT_INTENTS.PRODUCT_SIZE, CHAT_INTENTS.PRODUCT_CONDITION, CHAT_INTENTS.PRODUCT_AVAILABILITY].includes(intent) && !matchedProduct) {
    return "Which item would you like me to check?";
  }

  if (!availableProducts.length) {
    return "There are no in-stock apparel items listed right now. Please check again later for new arrivals.";
  }

  const productSuggestions = (intent === CHAT_INTENTS.NEW_ARRIVAL ? availableProducts.slice(0, 5) : availableProducts.slice(0, text.includes("all") ? 12 : 5));
  const productLines = productSuggestions.map((product) => `${product.name} - ${formatMoney(product.price)}, ${product.size || "size unavailable"}, stock ${product.stock}`).join("\n");

  if (intent === CHAT_INTENTS.NEW_ARRIVAL) {
    return `Yes. Our newest arrivals are:\n${productLines}`;
  }

  if (intent === CHAT_INTENTS.PRODUCT_SEARCH) {
    return `Available products:\n${productLines}`;
  }

  return "I can help with RETELA products, orders, shipping, payments, and returns. What would you like to check?";
}
