import { HttpError } from "./errors.js";
import { query } from "../config/db.js";
import { generateGeminiResult, isGeminiConfigured } from "./gemini.js";
import { generateOpenAiResult } from "./openai.js";
import { getOpenAiRuntimeSettings, loadSystemSettings } from "./systemSettings.js";

const PROVIDERS = new Set(["openai", "gemini", "auto"]);

let lastProviderUsed = "";
let lastProviderStatus = "Not checked";
let lastProviderCheckedAt = null;

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

export async function generateAIResponse(message, context = {}) {
  const start = Date.now();
  const selectedProvider = await getProviderConfig(context.provider);

  try {
    let result;
    if (selectedProvider === "openai") {
      result = await runOpenAi(message, context);
    } else if (selectedProvider === "gemini") {
      result = await runGemini(message, context);
    } else {
      try {
        result = await runOpenAi(message, context);
      } catch (openAiError) {
        console.warn(`[AI] OpenAI failed in auto mode. Falling back to Gemini: ${openAiError.message}`);
        result = await runGemini(message, context);
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
