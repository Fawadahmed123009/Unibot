"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import SignOutButton from "@/components/sign-out-button";
import type { SessionRole } from "@/lib/auth";

type Role = "user" | "assistant";

type Source = {
  n: number;
  document_name?: string;
  section_heading?: string;
  session?: string;
  source_pages?: string | number;
  status?: string;
  similarity: number;
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  sources?: Source[];
  refused?: boolean;
};

type Conversation = { id: string; title: string | null; created_at: string | null };

type ChatAppProps = {
  email: string;
  /** Session role only, used to show the /admin link; the page and API re-check it in the DB. */
  role: SessionRole;
};

const MAX_MESSAGE_CHARS = 1000;

// Keys only; the DB id is not known until a message is saved.
let keyCounter = 0;
const nextKey = () => `m${++keyCounter}`;

// The model answers in Markdown. Render the subset it actually uses (``**bold**``
// and "- " bullets) instead of shipping a full Markdown parser.
function inlineBold(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const strong = /^\*\*(.+)\*\*$/.exec(part);
    return strong ? <strong key={`${keyPrefix}-${i}`}>{strong[1]}</strong> : part;
  });
}

// Renders an assistant answer. The model answers in one language per message,
// so a block containing any Urdu/Arabic-script glyph is treated as RTL even
// when it starts with a Latin/numeric token ("A1 category ...", "75% ..."),
// which dir="auto" alone would wrongly resolve to LTR. ps-* keeps bullet
// padding on the correct side once the list's direction is set.
const URDU_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const dirFor = (text: string): "rtl" | "auto" => (URDU_RE.test(text) ? "rtl" : "auto");

function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul
        dir={dirFor(bullets.join(" "))}
        className="list-disc space-y-1 ps-5"
        key={`ul-${blocks.length}`}
      >
        {bullets.map((item, i) => (
          <li key={`li-${i}`} dir={dirFor(item)}>
            {inlineBold(item, `li-${i}`)}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const bullet = /^\s*-\s+(.+)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushBullets();
    if (line.trim()) {
      blocks.push(
        <p key={`p-${i}`} dir={dirFor(line)}>
          {inlineBold(line, `p-${i}`)}
        </p>,
      );
    }
  });
  flushBullets();

  return <div className="space-y-1.5">{blocks}</div>;
}

export default function ChatApp({ email, role }: ChatAppProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setConversations(data.conversations ?? []);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function selectConversation(id: string) {
    if (streaming) return;
    setError(null);
    setActiveId(id);
    // Clear before fetching, otherwise the previous conversation stays on screen
    // for a moment and looks like part of the one the user just opened.
    setMessages([]);
    setLoadingConversation(true);
    const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" }).catch(() => null);
    setLoadingConversation(false);
    if (!res?.ok) {
      setError("Could not open that conversation.");
      return;
    }
    const data = await res.json();
    const loaded: ChatMessage[] = (data.messages ?? []).map((m: ChatMessage) => ({
      id: m.id ?? nextKey(),
      role: m.role,
      content: m.content,
      sources: Array.isArray(m.sources) ? m.sources : undefined,
    }));
    setMessages(loaded);
  }

  function startNewChat() {
    if (streaming) return;
    setError(null);
    setActiveId(null);
    setMessages([]);
  }

  async function deleteConversation(id: string) {
    if (streaming) return;
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Could not delete that conversation.");
      return;
    }
    if (id === activeId) startNewChat();
    loadConversations();
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);

    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: nextKey(), role: "user", content: text },
      { id: nextKey(), role: "assistant", content: "" },
    ]);
    setStreaming(true);

    // Placeholder assistant message is the last one; deltas append into it.
    const appendDelta = (delta: string) =>
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, content: last.content + delta };
        }
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId ?? undefined, message: text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawError = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as
            | { type: "start"; conversationId: string }
            | { type: "delta"; text: string }
            | { type: "done"; messageId: string; sources: Source[]; refused: boolean }
            | { type: "error"; message: string };

          if (event.type === "start") {
            setActiveId(event.conversationId);
          } else if (event.type === "delta") {
            appendDelta(event.text);
          } else if (event.type === "done") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  id: event.messageId || last.id,
                  sources: event.sources,
                  refused: event.refused,
                };
              }
              return next;
            });
          } else if (event.type === "error") {
            sawError = true;
            setError(event.message);
          }
        }
      }

      // Drop an empty assistant placeholder if the stream produced nothing.
      if (!sawError) {
        setMessages((prev) =>
          prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === ""
            ? prev.slice(0, -1)
            : prev,
        );
      }
      loadConversations(); // title may have been set from the first message
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      // Remove the empty assistant placeholder on failure.
      setMessages((prev) =>
        prev[prev.length - 1]?.role === "assistant" && prev[prev.length - 1]?.content === ""
          ? prev.slice(0, -1)
          : prev,
      );
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">UET Department Assistant</h1>
          <p className="text-sm text-slate-500">Computer Engineering Department, UET Lahore</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden text-right text-xs text-slate-500 sm:block">{email}</p>
          {role === "admin" && (
            <a href="/admin" className="btn-ghost shrink-0">
              Admin
            </a>
          )}
          <SignOutButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 py-4">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 pr-3 sm:flex">
          <button type="button" onClick={startNewChat} className="btn-primary mb-3 h-9 text-sm">
            New chat
          </button>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectConversation(c.id)}
                  className={`flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition ${
                    c.id === activeId
                      ? "bg-blue-50 font-medium text-blue-800"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {c.title ?? "New chat"}
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={() => deleteConversation(c.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-slate-400 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
            {conversations.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">No conversations yet.</li>
            )}
          </ul>
        </aside>

        {/* Conversation */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 && !streaming && !loadingConversation && (
              <p className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center text-sm text-slate-600">
                Ask in English, Urdu or Roman Urdu about admissions, fees, courses, attendance
                or exam rules. Answers come only from verified department documents.
              </p>
            )}

            {loadingConversation && (
              <p className="mt-10 text-center text-sm text-slate-400">Loading conversation…</p>
            )}

            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white"
                      : "max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800"
                  }
                >
                  {m.content ? (
                    m.role === "assistant" ? (
                      <AnswerText text={m.content} />
                    ) : (
                      <p className="whitespace-pre-wrap" dir={dirFor(m.content)}>
                        {m.content}
                      </p>
                    )
                  ) : (
                    <p className="text-slate-400">Thinking…</p>
                  )}

                  {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="mb-1 text-xs font-semibold text-slate-500">Sources</p>
                      <ul className="space-y-0.5">
                        {m.sources.map((s) => {
                          const heading = s.section_heading ?? "?";
                          // The heading already carries the batch for Q&A docs, so
                          // repeating the session right after it read as "(CE-29 / Session
                          // 2024) (CE-29 / Session 2024)".
                          const showSession = Boolean(s.session) && !heading.includes(s.session ?? "");
                          return (
                            <li
                              key={`${s.n}-${s.document_name}`}
                              className="text-xs text-slate-500"
                              title={`Similarity to the question: ${s.similarity.toFixed(2)}`}
                            >
                              [{s.n}] {s.document_name ?? "?"} — {heading}
                              {showSession ? ` (${s.session})` : ""}
                              {s.status?.toLowerCase().includes("pending")
                                ? " · status: pending confirmation"
                                : ""}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="mt-3 flex items-end gap-2"
          >
            <textarea
              rows={1}
              value={input}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="Ask a question…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="input max-h-32 min-h-11 resize-none py-2.5"
            />
            <button type="submit" className="btn-primary shrink-0" disabled={streaming || !input.trim()}>
              {streaming ? "Sending…" : "Send"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
