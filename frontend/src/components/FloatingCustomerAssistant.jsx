import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { api } from "../api/client";

function messageStatusLabel(status) {
  if (status === "seen") return "Seen";
  if (status === "delivered") return "Delivered";
  return "Sent";
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

  async function sendMessage(event) {
    event?.preventDefault();
    const text = prompt.trim();
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

  return (
    <div className="ai-chat-shell">
      {open ? (
        <section className="ai-chat-window fade-slide rounded-[28px] border border-neonbrand/25 bg-[#07110d]/95 text-white shadow-[0_24px_90px_rgba(0,0,0,0.46),0_0_42px_rgba(56,255,136,0.16)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-neonbrand text-black shadow-[0_0_26px_rgba(56,255,136,0.35)]">
                <Bot size={22} />
                <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#07110d] bg-emerald-300" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-display text-base font-bold">Retela Assistant</h3>
                <p className="truncate text-xs font-semibold text-white/50">AI shopping help online</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:border-neonbrand/40 hover:text-neonbrand" aria-label="Close assistant">
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} className="ai-chat-messages grid content-start gap-3 p-4">
            {messages.length ? messages.map((message, index) => (
              <div key={message.id || index} className={`grid max-w-[84%] gap-1 ${message.sender_type === "customer" ? "ml-auto justify-items-end" : "justify-items-start"}`}>
                <p className={`break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.sender_type === "customer" ? "bg-neonbrand text-black" : message.sender_type === "admin" ? "bg-emerald-500/15 text-emerald-100" : "bg-white/[0.08] text-white/82"}`}>
                  {message.body}
                </p>
                <span className="px-2 text-[11px] font-semibold text-white/35">{messageStatusLabel(message.delivery_status)}</span>
              </div>
            )) : (
              <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 text-sm leading-6 text-white/70">
                Ask about available tees, caps, jackets, sizes, prices, stock, delivery, or payment.
              </div>
            )}
            {sending ? <p className="inline-flex max-w-fit items-center gap-2 rounded-2xl bg-white/[0.08] px-4 py-3 text-sm text-white/60"><Loader2 size={15} className="animate-spin" /> Thinking</p> : null}
          </div>

          <form onSubmit={sendMessage} className="ai-chat-input-container border-t border-white/10 p-3">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-neonbrand/60"
              placeholder="Ask the assistant"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <button type="submit" disabled={!prompt.trim() || sending} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-neonbrand text-black shadow-[0_0_24px_rgba(56,255,136,0.2)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message">
              <Send size={18} />
            </button>
          </form>
        </section>
      ) : null}

      <button type="button" onClick={() => setOpen((value) => !value)} className="ai-chat-button float-soft relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-neonbrand/45 bg-[#0b1510] text-neonbrand shadow-[0_20px_70px_rgba(56,255,136,0.3)] transition hover:scale-105" aria-label="Open assistant">
        <span className="absolute inset-1 rounded-full bg-neonbrand/10 shadow-[inset_0_0_24px_rgba(56,255,136,0.22)]" />
        {open ? <X size={25} className="relative" /> : (
          <span className="relative grid place-items-center">
            <Bot size={27} />
            <span className="mt-[-2px] text-[10px] font-black leading-none tracking-[0.12em]">AI</span>
          </span>
        )}
      </button>
    </div>
  );
}
