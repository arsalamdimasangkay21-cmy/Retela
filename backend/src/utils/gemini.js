import { HttpError } from "./errors.js";
import { buildRetelaAssistantContext } from "./retelaAssistantContext.js";

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

export function isGeminiConfigured() {
  return Boolean(getGeminiApiKey());
}

export async function generateGeminiResult({ prompt, products = [], history = [], orders = [], settings = {}, customer = {}, assistantContext = null }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const context = assistantContext || buildRetelaAssistantContext({ prompt, products, history, orders, settings, customer });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    signal: providerTimeoutSignal(),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: context.systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: context.userContext }]
        }
      ],
      generationConfig: {
        temperature: Number(settings?.ai?.aiChatTemperature ?? 0.45),
        topP: 0.9,
        maxOutputTokens: 420
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
