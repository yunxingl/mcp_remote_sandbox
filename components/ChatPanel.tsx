"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";

interface Message {
  id: string;
  role: "user" | "assistant" | "mcp";
  content: string;
  createdAt: string;
}

export default function ChatPanel({ problemKey }: { problemKey: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetch(`/api/chat?key=${encodeURIComponent(problemKey)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [problemKey]);

  useEffect(() => {
    refresh();
    // Poll so hints posted from Claude Code (via MCP) show up live.
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setInput("");
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: problemKey, message }),
      });
      if (!res.ok) throw new Error(`chat failed: ${res.status}`);
      refresh();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : String(e)}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--text-dim)]">
            Ask the Claude tutor for hints — or connect Claude Code over MCP and hints it posts will
            appear here too.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">
              {m.role === "user" ? "You" : m.role === "mcp" ? "Claude Code (MCP)" : "Claude"}
            </div>
            <div
              className={
                "rounded-lg border p-3 text-sm " +
                (m.role === "user"
                  ? "border-[var(--accent-dim)] bg-[var(--bg-raised)]"
                  : m.role === "mcp"
                    ? "border-[var(--yellow)]/40 bg-[var(--bg-raised)]"
                    : "border-[var(--border)] bg-[var(--bg-raised)]")
              }
            >
              <Markdown>{m.content}</Markdown>
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-[var(--text-dim)]">Claude is thinking…</p>}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask for a hint… (Enter to send)"
            className="flex-1 resize-none rounded-md border border-[var(--border)] bg-[var(--bg-raised)] p-2 text-sm outline-none focus:border-[var(--accent-dim)]"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-[#0b0e14] disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
