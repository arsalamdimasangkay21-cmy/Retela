import assert from "node:assert/strict";
import test from "node:test";
import { generateGeminiResult } from "../src/utils/gemini.js";
import { generateOpenAiResult } from "../src/utils/openai.js";
import { buildRetelaAssistantContext } from "../src/utils/retelaAssistantContext.js";

const products = [
  { name: "Blade", size: "Free Size", price: 55, stock: 12, condition: "Good as new" },
  { name: "Shadne", size: "M", price: 67, stock: 4, condition: "Good" }
];

test("Gemini and OpenAI receive the same RETELA behavior rules and filtered context", async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const calls = [];

  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "Yes, Blade is currently available." }] } }], usageMetadata: { totalTokenCount: 20 } })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Yes, Blade is currently available." } }], usage: { total_tokens: 20 } })
    };
  };

  try {
    const assistantContext = buildRetelaAssistantContext({ prompt: "blade available?", products });
    await generateGeminiResult({ prompt: "blade available?", products, settings: { ai: {} }, assistantContext });
    await generateOpenAiResult({ prompt: "blade available?", products, settings: { ai: {} }, assistantContext });

    const geminiBody = calls.find((call) => call.url.includes("generativelanguage.googleapis.com")).body;
    const openAiBody = calls.find((call) => call.url.includes("api.openai.com")).body;

    assert.equal(geminiBody.systemInstruction.parts[0].text, openAiBody.messages[0].content);
    assert.equal(geminiBody.contents[0].parts[0].text, openAiBody.messages[1].content);
    assert.match(openAiBody.messages[1].content, /REFERENCED PRODUCT/);
    assert.match(openAiBody.messages[1].content, /Product: Blade/);
    assert.doesNotMatch(openAiBody.messages[1].content, /Product: Shadne/);
  } finally {
    global.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});
