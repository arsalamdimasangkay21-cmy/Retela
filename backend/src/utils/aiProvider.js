import { HttpError } from "./errors.js";
import { query } from "../config/db.js";
import { generateGeminiResult, isGeminiConfigured } from "./gemini.js";
import { generateOpenAiResult } from "./openai.js";
import { getOpenAiRuntimeSettings, loadSystemSettings } from "./systemSettings.js";

const PROVIDERS = new Set(["openai", "gemini", "auto"]);

let lastProviderUsed = "";
let lastProviderStatus = "Not checked";
let lastProviderCheckedAt = null;
let startupDiagnosticsLogged = false;

function logAIStartupDiagnostics() {
  if (startupDiagnosticsLogged) return;
  startupDiagnosticsLogged = true;
  console.info("[AI config]", {
    geminiApiKeyEnvConfigured: Boolean(process.env.GEMINI_API_KEY),
    googleApiKeyEnvConfigured: Boolean(process.env.GOOGLE_API_KEY),
    openaiApiKeyEnvConfigured: Boolean(process.env.OPENAI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    providerSelection: "system_settings.ai.aiProvider",
    providerSelectionEnvConfigured: false
  });
}

function normalizeProvider(value) {
  const provider = String(value || "auto").trim().toLowerCase();
  return PROVIDERS.has(provider) ? provider : "auto";
}

function providerLabel(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  return "Auto";
}

async function getProviderConfig(contextProvider) {
  if (contextProvider) return normalizeProvider(contextProvider);
  const { config } = await loadSystemSettings();
  return normalizeProvider(config.ai?.aiProvider);
}

async function runOpenAi(message, context) {
  const result = await generateOpenAiResult({ ...context, prompt: message });
  if (!result?.text) throw new HttpError(503, "OpenAI API key is missing.");
  return {
    body: result.text,
    provider: "openai",
    tokenUsage: result.tokenUsage ?? null
  };
}

async function runGemini(message, context) {
  const result = await generateGeminiResult({ ...context, prompt: message });
  if (!result?.text) throw new HttpError(503, "Gemini API key is missing.");
  return {
    body: result.text,
    provider: "gemini",
    tokenUsage: result.tokenUsage ?? null
  };
}

function markProviderUsed(provider, status = "Ready") {
  lastProviderUsed = provider;
  lastProviderStatus = status;
  lastProviderCheckedAt = new Date().toISOString();
  console.info(`[AI] Provider used: ${providerLabel(provider)}`);
}

function markProviderFailure(error) {
  lastProviderStatus = error?.message || "Unavailable";
  lastProviderCheckedAt = new Date().toISOString();
}

function redactProviderMessage(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-openai-key]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/x-goog-api-key['":\s]+[A-Za-z0-9_-]+/gi, "x-goog-api-key [redacted]")
    .slice(0, 240);
}

function classifyProviderFailure(provider, error) {
  const status = Number(error?.providerStatus || error?.status || 0);
  const message = redactProviderMessage(error?.message || error?.cause?.message || "");
  const lower = message.toLowerCase();

  if (/api key is missing|missing api key|not configured/.test(lower)) {
    return { category: "missing_api_key", status: status || null, detail: message };
  }
  if (status === 401 || status === 403 || /invalid api key|api key not valid|incorrect api key|permission denied|unauthorized|forbidden/.test(lower)) {
    return { category: "invalid_api_key", status: status || null, detail: message };
  }
  if (status === 404 || /model.*not found|not found.*model|model.*does not exist|unsupported model|invalid model/.test(lower)) {
    return { category: "unsupported_or_incorrect_model", status: status || null, detail: message };
  }
  if (status === 429 || /quota|rate.?limit|resource_exhausted|too many requests|insufficient_quota/.test(lower)) {
    return { category: "quota_or_rate_limit", status: status || null, detail: message };
  }
  if (/fetch failed|network|enotfound|eai_again|econnreset|etimedout|timeout|socket|tls/.test(lower) || ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"].includes(error?.code)) {
    return { category: "network_error", status: status || null, detail: message || error?.code || "Network request failed" };
  }
  if (status >= 400) {
    return { category: "provider_api_request_failure", status, detail: message };
  }
  return { category: "provider_unavailable", status: status || null, detail: message || "Provider failed without details" };
}

function logProviderFailure(provider, error, context = "") {
  const failure = classifyProviderFailure(provider, error);
  const label = providerLabel(provider);
  const suffix = context ? ` ${context}` : "";
  console.warn(`[AI] ${label} failed${suffix}: ${failure.category}`, {
    status: failure.status,
    detail: failure.detail
  });
  return failure;
}

logAIStartupDiagnostics();

export async function generateAIResponse(message, context = {}) {
  logAIStartupDiagnostics();
  const start = Date.now();
  const selectedProvider = await getProviderConfig(context.provider);

  try {
    let result;
    if (selectedProvider === "openai") {
      try {
        result = await runOpenAi(message, context);
      } catch (openAiError) {
        logProviderFailure("openai", openAiError);
        throw openAiError;
      }
    } else if (selectedProvider === "gemini") {
      try {
        result = await runGemini(message, context);
      } catch (geminiError) {
        logProviderFailure("gemini", geminiError);
        throw geminiError;
      }
    } else {
      try {
        result = await runOpenAi(message, context);
      } catch (openAiError) {
        logProviderFailure("openai", openAiError, "in auto mode; falling back to Gemini");
        try {
          result = await runGemini(message, context);
        } catch (geminiError) {
          logProviderFailure("gemini", geminiError, "after OpenAI fallback");
          throw geminiError;
        }
      }
    }

    const responseTime = Date.now() - start;
    markProviderUsed(result.provider);
    return {
      body: result.body,
      provider: result.provider,
      responseTime,
      tokenUsage: result.tokenUsage
    };
  } catch (error) {
    markProviderFailure(error);
    throw new HttpError(error.status || 503, "AI provider is not configured or unavailable. Contact administrator.");
  }
}

export async function getAIProviderStatus(settings = null) {
  const loaded = settings ? { config: settings } : await loadSystemSettings();
  const provider = normalizeProvider(loaded.config.ai?.aiProvider);
  const openAiRuntime = await getOpenAiRuntimeSettings();
  const openaiConfigured = Boolean(openAiRuntime.apiKey);
  const geminiConfigured = isGeminiConfigured();
  let durableLastProvider = lastProviderUsed;
  if (!durableLastProvider) {
    try {
      const rows = await query(
        `SELECT ai_provider
         FROM messages
         WHERE ai_provider IS NOT NULL AND ai_provider <> ''
         ORDER BY created_at DESC
         LIMIT 1`
      );
      durableLastProvider = normalizeProvider(rows[0]?.ai_provider || "");
      if (durableLastProvider === "auto") durableLastProvider = "";
    } catch {
      durableLastProvider = "";
    }
  }

  const ready = provider === "openai"
    ? openaiConfigured
    : provider === "gemini"
      ? geminiConfigured
      : openaiConfigured || geminiConfigured;

  return {
    currentProvider: providerLabel(provider),
    currentProviderValue: provider,
    lastProviderUsed: durableLastProvider ? providerLabel(durableLastProvider) : "None",
    lastProviderUsedValue: durableLastProvider,
    apiStatus: ready ? "Ready" : "Missing API key",
    checkedAt: lastProviderCheckedAt,
    lastStatus: lastProviderStatus,
    providers: {
      openai: openaiConfigured ? "Configured" : "Missing API key",
      gemini: geminiConfigured ? "Configured" : "Missing API key"
    }
  };
}
