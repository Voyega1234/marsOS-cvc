"use client";

import { useEffect, useState } from "react";
import { Loader2, Cpu, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AIProviderKeyRow = {
  id: string;
  provider: string;
  displayName: string;
  keyMasked: string;
  isActive: boolean;
  isDefault: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
};

const PROVIDER_COLOR: Record<string, string> = {
  claude:     "text-orange-600 bg-orange-50",
  openai:     "text-emerald-600 bg-emerald-50",
  gemini:     "text-blue-600 bg-blue-50",
  groq:       "text-purple-600 bg-purple-50",
  mistral:    "text-rose-600 bg-rose-50",
  deepseek:   "text-indigo-600 bg-indigo-50",
  perplexity: "text-teal-600 bg-teal-50",
};

interface Props {
  value: string | null;
  onChange: (keyId: string | null, provider: string | null) => void;
  filterProvider?: string;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}

export function AIProviderSelect({
  value, onChange, filterProvider, placeholder = "เลือก AI Provider", className, size = "md",
}: Props) {
  const [keys, setKeys] = useState<AIProviderKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-providers")
      .then((r) => r.json())
      .then((data: AIProviderKeyRow[]) => {
        const active = data.filter((k) => k.isActive);
        const filtered = filterProvider ? active.filter((k) => k.provider === filterProvider) : active;
        setKeys(filtered);
        // Auto-select the default if no value is set
        if (!value) {
          const def = filtered.find((k) => k.isDefault) ?? filtered[0] ?? null;
          if (def) onChange(def.id, def.provider);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProvider]);

  const selected = keys.find((k) => k.id === value) ?? null;

  // Group by provider
  const groups = keys.reduce<Record<string, AIProviderKeyRow[]>>((acc, k) => {
    if (!acc[k.provider]) acc[k.provider] = [];
    acc[k.provider].push(k);
    return acc;
  }, {});

  const h = size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-sm px-3";

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 text-gray-400", h, className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400 cursor-not-allowed", h, className)}>
        <Cpu className="h-3.5 w-3.5" />
        <span className="text-xs">ไม่มี Provider — ไปที่ AI Connect ก่อน</span>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-gray-100 bg-white hover:border-gray-300 transition-colors w-full",
          h
        )}
      >
        {selected ? (
          <>
            <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded", PROVIDER_COLOR[selected.provider])}>
              {PROVIDER_LABEL[selected.provider] ?? selected.provider}
            </span>
            <span className="flex-1 text-left text-gray-700 truncate">{selected.displayName}</span>
            {selected.isDefault && (
              <span className="text-xs text-amber-500">⭐</span>
            )}
          </>
        ) : (
          <span className="flex-1 text-left text-gray-400">{placeholder}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div className="absolute z-20 mt-1 w-full min-w-[220px] bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
            {Object.entries(groups).map(([provider, provKeys]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                  {PROVIDER_LABEL[provider] ?? provider}
                </div>
                {provKeys.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => { onChange(k.id, k.provider); setOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors",
                      value === k.id && "bg-blue-50"
                    )}
                  >
                    <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0", PROVIDER_COLOR[k.provider])}>
                      {PROVIDER_LABEL[k.provider] ?? k.provider}
                    </span>
                    <span className="flex-1 text-gray-700 truncate">{k.displayName}</span>
                    <span className="font-mono text-xs text-gray-400 flex-shrink-0">{k.keyMasked}</span>
                    {k.isDefault && <span className="text-amber-500 flex-shrink-0">⭐</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
