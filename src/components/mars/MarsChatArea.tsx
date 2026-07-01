"use client";

import { useState, useRef, useEffect } from "react";
import { useMars } from "@/lib/context/mars-context";
import { detectAgent, buildResponse } from "./agents";
import type { MarsAgent } from "./agents";
import { cn } from "@/lib/utils";
import { ArrowUp, Paperclip, Mic } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  agent?: MarsAgent;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

const STORAGE_KEY = "mars_chat_sessions";
const ACTIVE_KEY  = "mars_active_session";

function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 50)));
}

function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderContent(text: string): React.ReactNode {
  const lines = text.split("\n");
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      result.push(<pre key={i} className="bg-gray-900 text-green-300 rounded-lg px-4 py-3 text-xs overflow-x-auto my-3 font-mono leading-relaxed"><code>{codeLines.join("\n")}</code></pre>);
      i++; continue;
    }
    if (line.startsWith("### ")) { result.push(<p key={i} className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">{line.slice(4)}</p>); i++; continue; }
    if (line.startsWith("- ")) {
      result.push(<div key={i} className="flex gap-2 py-0.5 text-sm text-gray-700 leading-relaxed"><span className="text-gray-400 shrink-0 mt-px">—</span><span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} /></div>);
      i++; continue;
    }
    if (/^\d+\.\s/.test(line)) {
      result.push(<div key={i} className="flex gap-2 py-0.5 text-sm text-gray-700 leading-relaxed"><span className="text-gray-400 shrink-0 font-mono text-xs mt-px">{line.match(/^\d+/)?.[0]}.</span><span dangerouslySetInnerHTML={{ __html: line.replace(/^\d+\.\s/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} /></div>);
      i++; continue;
    }
    if (line === "---") { result.push(<hr key={i} className="border-gray-100 my-3" />); i++; continue; }
    if (line.trim()) {
      result.push(<p key={i} className="text-sm text-gray-700 leading-relaxed py-0.5" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs font-mono">$1</code>') }} />);
    }
    i++;
  }
  return <div className="space-y-0.5">{result}</div>;
}

// ── Composer ──────────────────────────────────────────────────────────────────

function Composer({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-black/8 focus-within:border-gray-300 transition-all">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="ถามเกี่ยวกับ SEO, เขียนบทความ, วิเคราะห์ keyword..."
        rows={1}
        className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] text-gray-800 placeholder-gray-400 outline-none min-h-[52px] max-h-48 overflow-y-auto leading-relaxed"
      />
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <div className="flex items-center gap-1">
          <button className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <Paperclip className="h-4 w-4" />
          </button>
          <button className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <Mic className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="h-8 w-8 flex items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main chat area (no sidebar — runs inside workspace layout) ─────────────────

export function MarsChatArea() {
  const { pendingSessionId, clearPending } = useMars();

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const messages      = activeSession?.messages ?? [];

  // Handle pending action from sidebar (new chat or open session)
  useEffect(() => {
    if (pendingSessionId === undefined) return;
    setActiveId(pendingSessionId === null ? null : pendingSessionId);
    clearPending();
  }, [pendingSessionId, clearPending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { saveSessions(sessions); }, [sessions]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  async function handleSubmit(input: string) {
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };

    let sessionId = activeId;
    if (!sessionId) {
      sessionId = `s_${Date.now()}`;
      const title = input.slice(0, 40) + (input.length > 40 ? "..." : "");
      setSessions((prev) => [{ id: sessionId!, title, messages: [userMsg], createdAt: Date.now() }, ...prev]);
      setActiveId(sessionId);
    } else {
      setSessions((prev) => prev.map((s) =>
        s.id === sessionId ? { ...s, messages: [...s.messages, userMsg] } : s
      ));
    }

    setLoading(true);
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

    const agent   = detectAgent(input);
    const content = buildResponse(input, agent);
    const assistantMsg: Message = { id: `${Date.now() + 1}`, role: "assistant", content, agent };

    setSessions((prev) => prev.map((s) =>
      s.id === sessionId ? { ...s, messages: [...s.messages, assistantMsg] } : s
    ));
    setLoading(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 gap-8">
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">สวัสดีครับ ผม Mars</h1>
              <p className="text-gray-400 mt-2 text-sm">AI Agent สำหรับทีม SEO — ช่วยอะไรได้บ้างวันนี้?</p>
            </div>
            <div className="w-full max-w-2xl">
              <Composer onSubmit={handleSubmit} disabled={loading} />
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {[
                "วิเคราะห์ keyword สำหรับบทความวีซ่า",
                "เขียน outline บทความ SEO",
                "ตรวจสอบ E-E-A-T ของบทความ",
                "แนะนำ internal linking",
              ].map((p) => (
                <button
                  key={p}
                  onClick={() => handleSubmit(p)}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full px-4 py-6 space-y-5">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "user" ? (
                  <div className="max-w-[80%] bg-gray-900 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="flex-1 max-w-full">
                    {msg.agent && (
                      <div className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full mb-2", msg.agent.color, msg.agent.textColor)}>
                        <span>{msg.agent.emoji}</span>
                        {msg.agent.name} Agent
                      </div>
                    )}
                    <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-4 py-3.5">
                      {renderContent(msg.content)}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="text-xs">Mars กำลังคิด...</span>
              </div>
            )}
            <div ref={bottomRef} />

            <div className="pt-2 pb-4">
              <Composer onSubmit={handleSubmit} disabled={loading} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
