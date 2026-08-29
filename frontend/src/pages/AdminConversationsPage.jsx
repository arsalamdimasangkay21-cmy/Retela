import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CheckCircle2, ChevronLeft, Loader2, MessageCircle, MoreHorizontal, Search, Send, ToggleLeft, ToggleRight, Trash2, UserRound } from "lucide-react";
import { api } from "../api/client";
import ConfirmDialog from "../components/ConfirmDialog";
import { Card, Field } from "../components/ui";

const quickReplySeeds = [
  "Please share the item name and preferred size so I can confirm stock.",
  "I can help check availability. Let me review the shop inventory.",
  "This item is available. You may proceed with your order.",
  "Sorry, this item is currently out of stock.",
  "Please send your payment proof or reference number.",
  "Your order has been confirmed and is being prepared."
];

function chatKey(conversation) {
  return conversation.id ? String(conversation.id) : `customer-${conversation.customer_id}`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function presenceTone(status) {
  if (status === "active") return "text-[#15803d]";
  if (status === "away") return "text-amber-700";
  return "text-[#5f6f66]";
}

function presenceLabel(status) {
  if (status === "active") return "Online";
  if (status === "away") return "Away";
  return "Offline";
}

function toneClasses(status) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-[#15803d]";
  if (status === "away") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-[#5f6f66]";
}

function previewText(messages) {
  const latest = messages[messages.length - 1];
  if (!latest?.body) return "No messages yet";
  return latest.body;
}

function compactPreview(value) {
  const text = String(value || "No messages yet").replace(/\s+/g, " ").trim();
  if (text.length <= 96) return text;
  return `${text.slice(0, 93).trim()}...`;
}

function buildSuggestedReplies(selectedConversation, messages) {
  const latestCustomerMessage = [...messages].reverse().find((message) => message.sender_type === "customer")?.body || "";
  const lower = latestCustomerMessage.toLowerCase();

  if (/price|magkano|presyo/.test(lower)) {
    return [
      "I can help with pricing. Please tell me which item you want to check.",
      "Share the apparel name or screenshot so I can confirm the latest price.",
      "I am checking the available items and prices for you now."
    ];
  }
  if (/order|status|track|delivery|ship|asan|nasan/.test(lower)) {
    return [
      "I can help check the order status. Please wait while I review the latest update.",
      "Kindly confirm the order details so I can respond accurately.",
      "I am checking the current delivery or fulfillment status now."
    ];
  }
  if (/stock|available|meron|size/.test(lower)) {
    return [
      "Please share the item name and preferred size so I can confirm stock.",
      "I can help check availability. Let me review the shop inventory.",
      "This item is available. You may proceed with your order."
    ];
  }
  if (selectedConversation?.admin_takeover) {
    return [
      "I am handling this conversation now. Please give me a moment.",
      "I reviewed your message and I will assist you directly.",
      "Thanks for waiting. I am checking the latest shop details now."
    ];
  }
  return quickReplySeeds;
}

export default function AdminConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [approvedCustomers, setApprovedCustomers] = useState([]);
  const [conversationSnapshots, setConversationSnapshots] = useState({});
  const [selectedChat, setSelectedChat] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [suggestedReplies, setSuggestedReplies] = useState(quickReplySeeds);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [typingIndicator, setTypingIndicator] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [unreadState, setUnreadState] = useState({});
  const [dismissedCustomerKeys, setDismissedCustomerKeys] = useState({});
  const [removeConfirmConversation, setRemoveConfirmConversation] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const scrollRef = useRef(null);

  const selectedConversation = conversations.find((conversation) => chatKey(conversation) === selectedChat)
    || approvedCustomers.find((customer) => chatKey(customer) === selectedChat);

  const conversationCards = useMemo(() => {
    const pool = conversations.map((conversation) => {
      const snapshot = conversationSnapshots[conversation.id] || {};
      return {
        ...conversation,
        preview: snapshot.preview || conversation.latest_message || "No messages yet",
        timestamp: snapshot.timestamp || conversation.latest_message_at || conversation.updated_at || conversation.last_active_at || conversation.created_at || null,
        unread: unreadState[chatKey(conversation)] ?? Number(conversation.unread_count || 0)
      };
    });
    const query = search.trim().toLowerCase();
    return pool.filter((item) => {
      if (!query) return true;
      const haystack = `${item.username || ""} ${item.email || ""} ${item.preview || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, conversationSnapshots, unreadState, search]);

  const approvedChips = useMemo(() => {
    const query = search.trim().toLowerCase();
    return approvedCustomers.filter((customer) => {
      if (dismissedCustomerKeys[chatKey(customer)]) return false;
      if (!query) return true;
      return `${customer.username || ""} ${customer.email || ""}`.toLowerCase().includes(query);
    });
  }, [approvedCustomers, search, dismissedCustomerKeys]);

  const conversationAnalytics = useMemo(() => {
    const total = messages.length;
    const customerCount = messages.filter((message) => message.sender_type === "customer").length;
    const adminCount = messages.filter((message) => message.sender_type === "admin").length;
    const aiCount = messages.filter((message) => message.sender_type === "ai").length;
    return {
      total,
      customerCount,
      adminCount,
      aiCount
    };
  }, [messages]);

  useEffect(() => {
    let active = true;
    loadConversations().finally(() => {
      if (active) setLoadingList(false);
    });
    const timer = setInterval(() => loadConversations().catch(() => {}), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    loadMessages(selectedConversation).catch(() => {});
  }, [selectedChat, selectedConversation?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (!selectedConversation?.id) return undefined;
    setTypingIndicator(true);
    const timer = window.setTimeout(() => setTypingIndicator(false), 1200);
    return () => window.clearTimeout(timer);
  }, [selectedConversation?.id, messages.length]);

  useEffect(() => {
    if (!actionNotice) return undefined;
    const timer = window.setTimeout(() => setActionNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  async function loadConversations() {
    const [conversationRes, customerRes] = await Promise.all([
      api.get("/messages/conversations"),
      api.get("/messages/customers/approved")
    ]);
    const nextConversations = conversationRes.data;
    const nextCustomers = customerRes.data;
    setConversations(nextConversations);
    setApprovedCustomers(nextCustomers);
    setConversationSnapshots((current) => ({
      ...current,
      ...Object.fromEntries(nextConversations.map((conversation) => [conversation.id, {
        preview: conversation.latest_message || "No messages yet",
        timestamp: conversation.latest_message_at || conversation.updated_at || null
      }]))
    }));
    setUnreadState((current) => ({
      ...current,
      ...Object.fromEntries(nextConversations.map((conversation) => {
        return [chatKey(conversation), Number(conversation.unread_count || 0)];
      }))
    }));
    const rawContext = localStorage.getItem("retela_admin_chat_context");
    if (rawContext) {
      try {
        const context = JSON.parse(rawContext);
        const customerId = Number(context.customerId);
        const targetConversation = nextConversations.find((conversation) => Number(conversation.customer_id) === customerId);
        const targetCustomer = nextCustomers.find((customer) => Number(customer.customer_id) === customerId);
        const target = targetConversation || targetCustomer;
        if (target) {
          setSelectedChat(chatKey(target));
          setText((current) => current || String(context.context || "").trim());
          if (window.innerWidth < 1024) setMobileListOpen(false);
          localStorage.removeItem("retela_admin_chat_context");
        }
      } catch {
        localStorage.removeItem("retela_admin_chat_context");
      }
    }
  }

  async function loadMessages(conversation) {
    if (!conversation?.id) {
      setMessages([]);
      setSuggestedReplies(quickReplySeeds);
      return;
    }
    setLoadingMessages(true);
    try {
      const { data } = await api.get(`/messages/${conversation.id}?markSeen=true`);
      setMessages(data);
      setUnreadState((current) => ({ ...current, [chatKey(conversation)]: 0 }));
      const suggestionRes = await api.get(`/messages/${conversation.id}/suggestions`).catch(() => ({ data: { suggestions: buildSuggestedReplies(conversation, data) } }));
      setSuggestedReplies(suggestionRes.data.suggestions?.length ? suggestionRes.data.suggestions : quickReplySeeds);
      if (window.innerWidth < 1024) setMobileListOpen(false);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function sendMessage() {
    if (!selectedConversation || !text.trim() || sending) return;
    setSending(true);
    const draftText = text.trim();
    try {
      const payload = selectedConversation.id
        ? { conversation_id: Number(selectedConversation.id), body: draftText, mode: "admin" }
        : { customer_id: Number(selectedConversation.customer_id), body: draftText, mode: "admin" };
      const { data } = await api.post("/messages", payload);
      setText("");
      setSelectedChat(String(data.conversation_id));
      await loadConversations();
      await loadMessages({ ...selectedConversation, id: data.conversation_id });
    } finally {
      setSending(false);
    }
  }

  async function setTakeover(active) {
    if (!selectedConversation?.id) return;
    setBusyAction("takeover");
    try {
      await api.patch(`/messages/${selectedConversation.id}/takeover`, { active });
      await loadConversations();
      await loadMessages(selectedConversation);
    } finally {
      setBusyAction("");
    }
  }

  async function trashConversation() {
    if (!selectedConversation?.id) return;
    setRemoveConfirmConversation(selectedConversation);
  }

  async function confirmTrashConversation() {
    const target = removeConfirmConversation;
    if (!target?.id) return;
    setBusyAction("trash");
    try {
      await api.patch(`/messages/${target.id}/trash`);
      if (selectedChat === chatKey(target)) {
        setSelectedChat("");
        setMessages([]);
      }
      setRemoveConfirmConversation(null);
      setActionNotice({ id: Date.now(), message: "Conversation removed from your list." });
      await loadConversations();
    } finally {
      setBusyAction("");
    }
  }

  function dismissApprovedCustomer(customer) {
    const key = chatKey(customer);
    setBusyAction(`dismiss-${customer.customer_id}`);
    setDismissedCustomerKeys((current) => ({ ...current, [key]: true }));
    if (selectedChat === key && !customer.id) {
      setSelectedChat("");
      setMessages([]);
    }
    window.setTimeout(() => setBusyAction(""), 220);
  }

  function useSuggestedReply(replyText) {
    setText(replyText);
  }

  return (
    <motion.div className="grid min-w-0 gap-5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
      <section className="rounded-[28px] border border-[#d8eadf] bg-[#f7fff9] p-5 shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#15803d]">RETELA support center</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-[#102018] sm:text-4xl">Admin Conversations</h1>
      </section>

      <section className="support-dashboard-grid grid min-w-0 gap-5 xl:grid-cols-[320px_minmax(0,1.35fr)]">
        <motion.aside
          className={`min-w-0 ${mobileListOpen ? "block" : "hidden"} xl:block`}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="support-rail support-panel-height flex h-full flex-col overflow-hidden border-[#d8eadf] !bg-white p-0 shadow-sm">
            <div className="border-b border-[#d8eadf] bg-[#f7fff9] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803d]">Customer list</p>
                  <h2 className="mt-1 font-display text-xl font-bold text-[#102018]">Conversations</h2>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-[#15803d]">
                  {conversationCards.length}
                </span>
              </div>
              <div className="mt-4">
                <Field icon={Search} placeholder="Search customers or messages" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
            </div>

            <div className="support-list-scroll flex-1 overflow-y-auto p-3">
              {loadingList ? (
                <div className="grid gap-3">
                  {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton h-20 rounded-[22px]" />)}
                </div>
              ) : conversationCards.length ? (
                <div className="grid gap-3">
                  {conversationCards.map((conversation) => (
                    <ConversationListCard
                      key={chatKey(conversation)}
                      conversation={conversation}
                      active={selectedChat === chatKey(conversation)}
                      onClick={() => {
                        setSelectedChat(chatKey(conversation));
                        setMobileListOpen(false);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyStateCard title="No conversations found" subtitle="Customer conversations will appear here when they start chatting." />
              )}
            </div>
          </Card>
        </motion.aside>

        <motion.div className={`min-w-0 ${mobileListOpen ? "hidden xl:block" : "block"}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}>
          <Card className="support-chat-shell support-panel-height flex flex-col overflow-hidden border-[#d8eadf] !bg-[#f7fff9] p-0 shadow-sm">
            <ChatHeader
              selectedConversation={selectedConversation}
              autoReplyEnabled={autoReplyEnabled}
              setAutoReplyEnabled={setAutoReplyEnabled}
              onBack={() => setMobileListOpen(true)}
              onTakeover={() => setTakeover(!selectedConversation?.admin_takeover)}
              onTrash={trashConversation}
              takeoverBusy={busyAction === "takeover"}
              trashBusy={busyAction === "trash"}
            />

            <div ref={scrollRef} className="support-message-scroll flex-1 overflow-y-auto bg-[#f4fbf6] px-4 py-5 sm:px-5">
              {loadingMessages ? (
                <div className="grid gap-3">
                  {Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton h-16 rounded-[22px]" />)}
                </div>
              ) : selectedConversation ? (
                messages.length ? (
                  <div className="grid gap-4">
                    {messages.map((message, index) => (
                      <MessageBubble
                        key={message.id || index}
                        message={message}
                        isLast={index === messages.length - 1}
                      />
                    ))}
                    {typingIndicator ? <TypingIndicator /> : null}
                  </div>
                ) : (
                  <EmptyStateCard title="No messages yet" subtitle="Open a customer thread or wait for a new inquiry to begin the conversation." compact />
                )
              ) : (
                <EmptyStateCard title="Select a conversation" subtitle="Choose a customer from the list to view the chat history and reply." compact />
              )}
            </div>

            <div className="sticky bottom-0 border-t border-[#d8eadf] bg-white px-4 py-4 sm:px-5">
              <div className="rounded-[28px] border border-[#d8eadf] bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="min-w-0 flex-1 rounded-[24px] border border-[#d8eadf] bg-white px-4 py-3">
                      <textarea
                        rows={1}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder={selectedConversation ? "Reply to selected customer" : "Select a customer to start replying"}
                        className="max-h-32 min-h-[48px] w-full resize-y bg-transparent text-sm leading-6 text-[#102018] outline-none placeholder:text-[#7b8b83]"
                        disabled={!selectedConversation || sending}
                      />
                    </div>
                    <button type="button" disabled={!selectedConversation || !text.trim() || sending} onClick={sendMessage} className="inline-flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#2fbf71] px-5 text-sm font-bold text-white transition hover:bg-[#28a862] disabled:cursor-not-allowed disabled:opacity-60">
                      {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </section>
      <AnimatePresence>
        {actionNotice ? (
          <motion.div
            key={actionNotice.id}
            className="conversation-action-toast"
            initial={{ opacity: 0, y: -10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            role="status"
            aria-live="polite"
          >
            <span><CheckCircle2 size={17} /></span>
            <p>{actionNotice.message}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ConfirmDialog
        open={Boolean(removeConfirmConversation)}
        title="Remove this conversation?"
        message="This will remove the conversation from your list. This action cannot be undone."
        detail={removeConfirmConversation?.username || removeConfirmConversation?.display_name || (removeConfirmConversation?.customer_id ? `Customer #${removeConfirmConversation.customer_id}` : "")}
        confirmLabel="Remove"
        busy={busyAction === "trash"}
        onClose={() => {
          if (busyAction !== "trash") setRemoveConfirmConversation(null);
        }}
        onConfirm={confirmTrashConversation}
      />
    </motion.div>
  );
}

function SupportMetric({ label, value }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.06] px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</p>
      <strong className="mt-1 block font-display text-2xl text-white">{Number(value || 0).toLocaleString()}</strong>
    </div>
  );
}

function PresenceDot({ status }) {
  const styles = {
    active: "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]",
    away: "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.75)]",
    offline: "bg-slate-400"
  };
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles[status] || styles.offline}`} aria-hidden="true" />;
}

function ConversationListCard({ conversation, active, onClick }) {
  const preview = compactPreview(conversation.preview);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`conversation-list-card group flex w-full min-w-0 items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
        active
          ? "is-active border-emerald-300 bg-emerald-50 text-[#102018] shadow-sm"
          : "border-transparent bg-transparent text-[#102018] hover:border-emerald-200 hover:bg-[#f7fff9]"
      }`}
      whileHover={{ y: -1 }}
    >
      <span className={`conversation-list-avatar relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-sm font-black ${active ? "border-emerald-300 bg-white text-[#15803d]" : "border-[#d8eadf] bg-[#f7fff9] text-[#102018]"}`}>
        {(conversation.username || "C").slice(0, 1).toUpperCase()}
        <span className="absolute bottom-1 right-1"><PresenceDot status={conversation.presence_status} /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <strong className="conversation-list-name truncate text-sm text-[#102018]">{conversation.username || `Customer #${conversation.customer_id}`}</strong>
          <span className="conversation-list-time shrink-0 text-[11px] font-semibold text-[#5f6f66]">
            {formatTime(conversation.timestamp) || formatDateLabel(conversation.timestamp)}
          </span>
        </span>
        <span className="conversation-list-meta mt-1 flex min-w-0 items-center justify-between gap-2">
          <span className={`conversation-presence-pill inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${toneClasses(conversation.presence_status)}`}>
            <PresenceDot status={conversation.presence_status} />
            {presenceLabel(conversation.presence_status)}
          </span>
          {conversation.unread ? (
            <span className="conversation-unread-badge grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#2fbf71] px-1.5 text-[10px] font-black text-white">
              {conversation.unread}
            </span>
          ) : null}
        </span>
        <span className="conversation-preview mt-1.5 block truncate text-xs leading-5 text-[#5f6f66]" title={preview}>{preview}</span>
      </span>
    </motion.button>
  );
}

function ChatHeader({ selectedConversation, autoReplyEnabled, setAutoReplyEnabled, onBack, onTakeover, onTrash, takeoverBusy, trashBusy }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [selectedConversation?.id]);

  return (
    <div className="sticky top-0 z-10 border-b border-[#d8eadf] bg-[#f7fff9] px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-2xl border border-[#d8eadf] bg-white text-[#102018] transition hover:border-emerald-300 hover:text-[#15803d] xl:hidden" aria-label="Back to customer list">
            <ChevronLeft size={18} />
          </button>
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-200 bg-white text-[#15803d]">
            {selectedConversation ? (selectedConversation.username || "C").slice(0, 1).toUpperCase() : <UserRound size={20} />}
            {selectedConversation ? <span className="absolute bottom-1 right-1"><PresenceDot status={selectedConversation.presence_status} /></span> : null}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-bold text-[#102018]">{selectedConversation?.username || "Select customer"}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`text-sm font-semibold ${presenceTone(selectedConversation?.presence_status)}`}>{selectedConversation ? presenceLabel(selectedConversation.presence_status) : "No active conversation selected"}</span>
            </div>
          </div>
        </div>

        {selectedConversation?.id ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAutoReplyEnabled((value) => !value)} className="inline-flex items-center gap-2 rounded-2xl border border-[#d8eadf] bg-white px-3 py-2 text-xs font-bold text-[#102018] transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-[#15803d]">
              {autoReplyEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              Auto Reply
            </button>
            <button type="button" onClick={onTakeover} disabled={takeoverBusy} className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${selectedConversation.admin_takeover ? "border border-[#d8eadf] bg-white text-[#102018] hover:bg-emerald-50 hover:text-[#15803d]" : "bg-[#2fbf71] text-white hover:bg-[#28a862]"}`}>
              {takeoverBusy ? <Loader2 size={17} className="animate-spin" /> : <Bot size={16} />}
              {selectedConversation.admin_takeover ? "Release to AI" : "Take Over Chat"}
            </button>
            <div className="conversation-actions-menu-wrap" ref={menuRef}>
              <button type="button" onClick={() => setMenuOpen((value) => !value)} className="conversation-actions-trigger" aria-label="Conversation actions" aria-haspopup="menu" aria-expanded={menuOpen}>
                <MoreHorizontal size={18} />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <motion.div
                    className="conversation-actions-dropdown"
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    role="menu"
                  >
                    <button type="button" disabled={trashBusy} onClick={() => { setMenuOpen(false); onTrash?.(); }} className="conversation-actions-remove" role="menuitem">
                      {trashBusy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      Remove
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnalyticsPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/36">{label}</span>
      <strong className="mt-1 block text-sm text-white/82">{Number(value || 0).toLocaleString()}</strong>
    </div>
  );
}

function FeatureBadge({ label, tone = "slate", icon: Icon }) {
  const toneClass = tone === "emerald"
    ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-200"
    : tone === "blue"
      ? "border-neonbrand/20 bg-neonbrand/10 text-neonbrand"
      : "border-white/10 bg-white/[0.05] text-white/68";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${toneClass}`}>
      {Icon ? <Icon size={14} /> : null}
      {label}
    </span>
  );
}

function messageStatusLabel(status) {
  if (status === "seen") return "Seen";
  if (status === "delivered") return "Delivered";
  return "Sent";
}

function aiProviderLabel(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  return "Unknown";
}

function MessageBubble({ message, isLast }) {
  const isCustomer = message.sender_type === "customer";
  const isAdminOrAi = !isCustomer;
  return (
    <motion.div
      className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <div className={`max-w-[88%] rounded-[24px] px-4 py-3 shadow-sm sm:max-w-[78%] ${isCustomer ? "border border-[#d8eadf] bg-white text-[#102018]" : "bg-[#2fbf71] text-white"}`}>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:break-word] [word-break:break-word] text-sm leading-6">{message.body}</p>
        <div className={`mt-2 flex items-center gap-2 text-[11px] font-semibold ${isCustomer ? "text-[#5f6f66]" : "text-[#eafff1]"} ${isAdminOrAi ? "justify-end" : ""}`}>
          <span>{message.sender_type === "admin" ? "Admin" : message.sender_type === "ai" ? "AI" : "Customer"}</span>
          {message.sender_type === "ai" ? <span>AI Provider: {aiProviderLabel(message.ai_provider || message.aiProvider)}</span> : null}
          <span>{formatTime(message.created_at)}</span>
          <span>{messageStatusLabel(message.delivery_status)}</span>
        </div>
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div className="flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="inline-flex items-center gap-2 rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#15803d]">
        <Loader2 size={14} className="animate-spin" />
        Typing reply
      </div>
    </motion.div>
  );
}

function InputActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-white/72 transition hover:border-neonbrand/28 hover:text-neonbrand disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={label}
      title={label}
    >
      <Icon size={17} />
    </button>
  );
}

function EmptyStateCard({ title, subtitle, compact = false }) {
  return (
    <div className={`support-empty-state grid place-items-center rounded-[26px] border border-dashed border-[#d8eadf] bg-white text-center ${compact ? "min-h-40 p-5" : "min-h-56 p-6"}`}>
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-[#15803d]">
          <MessageCircle size={20} />
        </span>
        <h3 className="mt-3 font-display text-lg font-bold text-[#102018]">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#5f6f66]">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyInline({ title, subtitle }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs text-white/46">
      <strong className="mr-1 text-white/62">{title}</strong>
      {subtitle}
    </div>
  );
}
