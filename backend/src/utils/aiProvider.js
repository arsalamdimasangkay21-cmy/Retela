import { HttpError } from "./errors.js";
import { query } from "../config/db.js";
import { generateGeminiResult, isGeminiConfigured } from "./gemini.js";
import { generateOpenAiResult, isOpenAiConfigured } from "./openai.js";

const PROVIDERS = new Set(["openai", "gemini", "auto"]);

let lastProviderUsed = "";
let lastProviderStatus = "Not checked";
let lastProviderCheckedAt = null;
let startupDiagnosticsLogged = false;

function logAIStartupDiagnostics() {
  if (startupDiagnosticsLogged) return;
  startupDiagnosticsLogged = true;
  console.log("[ai] Provider configuration", {
    gemini: hasProviderConfig("gemini"),
    openai: hasProviderConfig("openai"),
    primary: normalizeProvider(process.env.AI_PROVIDER),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini"
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

function getProviderConfig(contextProvider) {
  if (contextProvider) return normalizeProvider(contextProvider);
  return normalizeProvider(process.env.AI_PROVIDER);
}

async function runOpenAi(message, context) {
  const result = await generateOpenAiResult({ ...context, prompt: message });
  if (!result?.text) throw new HttpError(502, "OpenAI returned an empty response.");
  return {
    body: result.text,
    provider: "openai",
    tokenUsage: result.tokenUsage ?? null
  };
}

async function runGemini(message, context) {
  const result = await generateGeminiResult({ ...context, prompt: message });
  if (!result?.text) throw new HttpError(502, "Gemini returned an empty response.");
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
  console.info(`[ai] Provider used: ${providerLabel(provider)}`);
}

function providerOrder(preferredProvider) {
  return preferredProvider === "openai" ? ["openai", "gemini"] : ["gemini", "openai"];
}

function hasProviderConfig(provider) {
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY?.trim());
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
  return false;
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
  console.warn(`[ai] ${label} request failed${suffix}`, {
    status: failure.status,
    code: error?.code || failure.category,
    message: failure.detail
  });
  return failure;
}

logAIStartupDiagnostics();

export async function generateAIResponse(message, context = {}) {
  logAIStartupDiagnostics();
  const start = Date.now();
  const selectedProvider = getProviderConfig(context.provider);
  const hasGemini = hasProviderConfig("gemini");
  const hasOpenAI = hasProviderConfig("openai");

  if (!hasGemini && !hasOpenAI) {
    console.warn("[ai] All configured providers failed", {
      configured: { gemini: false, openai: false }
    });
    const error = new HttpError(502, "Retela Assistant is temporarily unavailable. Please try again shortly.");
    markProviderFailure(error);
    throw error;
  }

  let lastError = null;
  const attempted = [];

  for (const provider of providerOrder(selectedProvider)) {
    if (!hasProviderConfig(provider)) {
      console.info(`[ai] ${providerLabel(provider)} skipped: missing API key`);
      continue;
    }

    attempted.push(provider);
    console.info(`[ai] Trying ${providerLabel(provider)}`);
    try {
      const result = provider === "gemini"
        ? await runGemini(message, context)
        : await runOpenAi(message, context);
      const responseTime = Date.now() - start;
      markProviderUsed(result.provider);
      console.info(`[ai] ${providerLabel(result.provider)} response generated successfully`);
      return {
        body: result.body,
        provider: result.provider,
        responseTime,
        tokenUsage: result.tokenUsage
      };
    } catch (error) {
      lastError = error;
      markProviderFailure(error);
      logProviderFailure(provider, error);
      const nextProvider = providerOrder(selectedProvider).find((candidate) => candidate !== provider && hasProviderConfig(candidate) && !attempted.includes(candidate));
      if (nextProvider) console.info(`[ai] Falling back to ${providerLabel(nextProvider)}`);
    }
  }

  console.warn("[ai] All configured providers failed", {
    attempted,
    configured: { gemini: hasGemini, openai: hasOpenAI }
  });
  const unavailableError = new HttpError(502, "Retela Assistant is temporarily unavailable. Please try again shortly.");
  unavailableError.cause = lastError;
  throw unavailableError;
}

export async function getAIProviderStatus(settings = null) {
  const provider = normalizeProvider(process.env.AI_PROVIDER || settings?.ai?.aiProvider);
  const openaiConfigured = await isOpenAiConfigured();
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
      const rawProvider = rows[0]?.ai_provider;
      durableLastProvider = rawProvider ? normalizeProvider(rawProvider) : "";
    } catch {
      durableLastProvider = "";
    }
  }

  const ready = openaiConfigured || geminiConfigured;

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
