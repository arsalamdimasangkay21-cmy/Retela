import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { api } from "../api/client";

const initialSuggestions = [
  "Browse products",
  "Product availability",
  "Available sizes",
  "Track my order",
  "Shipping fee",
  "Payment methods"
];

const fallbackSuggestions = [
  "Browse products",
  "Product availability",
  "Track my order",
  "Shipping fee",
  "Payment methods"
];

const contextualSuggestions = {
  product: ["Is this available?", "Available sizes", "Product condition", "View similar products", "How much is this?"],
  order: ["Track my order", "Order status", "Delivery status", "Cancel an order"],
  shop: ["Browse products", "What's available?", "How to order", "Shipping information", "Payment methods"],
  shipping: ["Shipping fee", "Delivery time", "Delivery status", "Shipping areas"],
  payment: ["GCash", "Cash on Delivery", "Payment methods", "Payment status"],
  return: ["Return policy", "Start a return", "Refund status", "Return requirements"]
};

const maxVisibleSuggestions = 5;

function latestCustomerText(messages = []) {
  const latest = [...messages].reverse().find((message) => message.sender_type === "customer" && message.body);
  return String(latest?.body || "").trim();
}

function recentCustomerContext(messages = []) {
  return messages
    .filter((message) => message.sender_type === "customer" && message.body)
    .slice(-3)
    .map((message) => message.body)
    .join(" ");
}

function categoryForText(text) {
  const source = String(text || "").toLowerCase();
  if (!source) return "";

  if (/\b(product availability|available sizes?|product condition|view similar products?|how much is this|is this available)\b/i.test(source)) return "product";
  if (/\b(track my order|where is my order|order status|delivery status|cancel an order)\b/i.test(source)) return "order";
  if (/\b(shipping fee|delivery time|shipping areas?|shipping information)\b/i.test(source)) return "shipping";
  if (/\b(payment methods?|payment status|gcash|cash on delivery)\b/i.test(source)) return "payment";
  if (/\b(return policy|start a return|refund status|return requirements?)\b/i.test(source)) return "return";
  if (/\b(browse products?|what'?s available|what is available|how to order)\b/i.test(source)) return "shop";

  if (/\b(return|refund|exchange)\b/i.test(source)) return "return";
  if (/\b(payment|gcash|cod|cash|paid)\b/i.test(source)) return "payment";
  if (/\b(order|track|tracking|purchase|checkout|status|cancel)\b/i.test(source)) return "order";
  if (/\b(shipping|delivery|courier|fee)\b/i.test(source)) return "shipping";
  if (/\b(product|item|shirt|apparel|size|stock|available|availability|condition|price)\b/i.test(source)) return "product";
  if (/\b(shop|store|retela|browse|buy|shopping)\b/i.test(source)) return "shop";
  return "";
}

function limitedSuggestions(category, fallback = fallbackSuggestions) {
  return (contextualSuggestions[category] || fallback).slice(0, maxVisibleSuggestions);
}

function messageStatusLabel(status) {
  if (status === "seen") return "Seen";
  if (status === "delivered") return "Delivered";
  return "Sent";
}

function suggestionsForMessages(messages = []) {
  if (!messages.length) return initialSuggestions;
  const latestCategory = categoryForText(latestCustomerText(messages));
  if (latestCategory) return limitedSuggestions(latestCategory);
  return limitedSuggestions(categoryForText(recentCustomerContext(messages)));
}

export function FloatingCustomerAssistant({ hidden = false }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  async function loadConversation() {
    const { data } = await api.get("/messages/conversations");
    const conversation = data[0];
    if (!conversation) return;
    setConversationId(conversation.id);
    const messageRes = await api.get(`/messages/${conversation.id}${open ? "?markSeen=true" : ""}`);
    setMessages(messageRes.data);
  }

  useEffect(() => {
    if (hidden) return undefined;
    loadConversation().catch(() => {});
    const timer = setInterval(() => loadConversation().catch(() => {}), open ? 4000 : 9000);
    return () => clearInterval(timer);
  }, [hidden, open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, open]);

  useEffect(() => {
    function openAssistant() {
      setOpen(true);
    }
    window.addEventListener("retela:open-customer-assistant", openAssistant);
    return () => window.removeEventListener("retela:open-customer-assistant", openAssistant);
  }, []);

  async function sendMessage(eventOrText) {
    if (eventOrText?.preventDefault) eventOrText.preventDefault();
    const text = typeof eventOrText === "string" ? eventOrText.trim() : prompt.trim();
    if (!text || sending) return;
    setSending(true);
    setPrompt("");
    setMessages((items) => [...items, { id: `draft-${Date.now()}`, sender_type: "customer", body: text }]);
    try {
      const { data } = await api.post("/messages/ai", { conversation_id: conversationId || undefined, prompt: text });
      setConversationId(data.conversation_id);
      const messageRes = await api.get(`/messages/${data.conversation_id}?markSeen=true`);
      setMessages(messageRes.data);
    } catch (error) {
      const message = error?.response?.data?.message || "The AI assistant is unavailable right now.";
      setMessages((items) => [...items, { id: `error-${Date.now()}`, sender_type: "ai", body: message }]);
    } finally {
      setSending(false);
    }
  }

  if (hidden) return null;
  const quickSuggestions = suggestionsForMessages(messages);

  return (
    <div className="ai-chat-shell">
      {open ? (
        <section className="ai-chat-window fade-slide rounded-[24px] border border-emerald-100 bg-[#fbfffc] text-slate-900 shadow-[0_18px_55px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
          <div className="ai-chat-header flex items-center justify-between gap-3 border-b border-emerald-100 bg-white p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 shadow-[0_0_20px_rgba(22,163,74,0.12)]">
                <Bot size={20} />
                <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-display text-base font-bold text-slate-950">Retela Assistant</h3>
                <p className="truncate text-xs font-semibold text-slate-500">AI shopping help online</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700" aria-label="Close assistant">
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} className="ai-chat-messages grid content-start gap-3 p-4">
            {messages.length ? messages.map((message, index) => (
              <div key={message.id || index} className={`grid max-w-[84%] gap-1 ${message.sender_type === "customer" ? "ml-auto justify-items-end" : "justify-items-start"}`}>
                <p className={`break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.sender_type === "customer" ? "bg-emerald-700 text-white" : message.sender_type === "admin" ? "bg-emerald-50 text-slate-900" : "bg-[#F3FAF6] text-slate-900"}`}>
                  {message.body}
                </p>
                <span className="px-2 text-[11px] font-semibold text-slate-500">{messageStatusLabel(message.delivery_status)}</span>
              </div>
            )) : (
              <div className="rounded-3xl border border-emerald-100 bg-[#F3FAF6] p-4 text-sm leading-6 text-slate-700">
                Ask about available tees, caps, jackets, sizes, prices, stock, delivery, or payment.
              </div>
            )}
            {sending ? <p className="inline-flex max-w-fit items-center gap-2 rounded-2xl bg-[#F3FAF6] px-4 py-3 text-sm text-slate-600"><Loader2 size={15} className="animate-spin text-emerald-700" /> Thinking</p> : null}
          </div>

          <div className="ai-chat-suggestions">
            {quickSuggestions.map((suggestion) => (
              <button key={suggestion} type="button" disabled={sending} onClick={() => sendMessage(suggestion)} className="quick-suggestion">
                {suggestion}
              </button>
            ))}
          </div>

          <form onSubmit={sendMessage} className="ai-chat-input-container border-t border-emerald-100 bg-white p-3">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400"
              placeholder="Ask the assistant"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <button type="submit" disabled={!prompt.trim() || sending} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white shadow-[0_0_20px_rgba(22,163,74,0.2)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
        </section>
      ) : null}

      {!open ? <button type="button" onClick={() => setOpen(true)} className="ai-chat-button float-soft relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-emerald-300 bg-white text-emerald-700 shadow-[0_16px_44px_rgba(22,101,52,0.22)] transition hover:scale-105" aria-label="Open assistant">
        <span className="absolute inset-1 rounded-full bg-emerald-50 shadow-[inset_0_0_20px_rgba(22,163,74,0.12)]" />
          <span className="relative grid place-items-center">
            <Bot size={27} />
            <span className="mt-[-2px] text-[10px] font-black leading-none tracking-[0.12em]">AI</span>
          </span>
      </button> : null}
    </div>
  );
}
