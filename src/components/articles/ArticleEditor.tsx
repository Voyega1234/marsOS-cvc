"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useState, useRef } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Link2, Smile, Palette, Minus, Quote, Undo, Redo,
  Highlighter, Type, ChevronDown,
} from "lucide-react";

// ── Color palettes ─────────────────────────────────────────────────────────────
const TEXT_COLORS = [
  "#111827", "#374151", "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6", "#EC4899", "#FFFFFF",
];

const HIGHLIGHT_COLORS = [
  "#FEF08A", "#BBF7D0", "#BAE6FD", "#DDD6FE", "#FBCFE8", "#FED7AA",
  "#FECACA", "#E5E7EB", "#D1FAE5", "#CFFAFE",
];

// ── Callout box templates ──────────────────────────────────────────────────────
const CALLOUTS = [
  {
    label: "💡 Tip",
    html: `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px 20px;border-radius:8px;margin:16px 0"><p style="margin:0;font-weight:700;color:#15803d">💡 Tip</p><p style="margin:8px 0 0;color:#166534">ใส่เนื้อหา tip ที่นี่</p></div>`,
  },
  {
    label: "⚠️ Warning",
    html: `<div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:16px 20px;border-radius:8px;margin:16px 0"><p style="margin:0;font-weight:700;color:#b45309">⚠️ ข้อควรระวัง</p><p style="margin:8px 0 0;color:#92400e">ใส่เนื้อหาที่นี่</p></div>`,
  },
  {
    label: "ℹ️ Info",
    html: `<div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:8px;margin:16px 0"><p style="margin:0;font-weight:700;color:#1d4ed8">ℹ️ ข้อมูลสำคัญ</p><p style="margin:8px 0 0;color:#1e40af">ใส่เนื้อหาที่นี่</p></div>`,
  },
  {
    label: "✅ Success",
    html: `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 20px;border-radius:8px;margin:16px 0"><p style="margin:0;font-weight:700;color:#15803d">✅ สรุป</p><p style="margin:8px 0 0;color:#166534">ใส่เนื้อหาที่นี่</p></div>`,
  },
  {
    label: "🔴 Alert",
    html: `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px 20px;border-radius:8px;margin:16px 0"><p style="margin:0;font-weight:700;color:#b91c1c">🔴 สำคัญมาก</p><p style="margin:8px 0 0;color:#991b1b">ใส่เนื้อหาที่นี่</p></div>`,
  },
  {
    label: "📦 Box",
    html: `<div style="border:2px solid #e5e7eb;padding:16px 20px;border-radius:12px;background:#f9fafb;margin:16px 0"><p style="margin:0;color:#111827">ใส่เนื้อหาใน box ที่นี่</p></div>`,
  },
];

// ── Emoji groups ───────────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: "ใช้บ่อย", emojis: ["✅","❌","⚠️","💡","ℹ️","🔥","⭐","💎","🎯","📌","🔑","💰","📊","✨","🚀","💪","👍","❤️","🎉","📝"] },
  { label: "หัวลูกศร", emojis: ["➡️","⬅️","⬆️","⬇️","↗️","↘️","🔼","🔽","▶️","◀️","✔️","➕","➖"] },
  { label: "ธุรกิจ", emojis: ["💼","📈","📉","🏢","👔","🤝","💳","🏦","📋","📁","🖥️","📱","⌚"] },
  { label: "ท่องเที่ยว", emojis: ["✈️","🌏","🗺️","🏨","🛂","📄","🛃","🚢","🏖️","⛩️","🗼","🌆"] },
];

// ── Toolbar button ─────────────────────────────────────────────────────────────
function ToolBtn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${
        active ? "bg-green-100 text-green-700" : "hover:bg-gray-100 text-gray-600"
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────
function Sep() {
  return <div className="w-px h-5 bg-gray-200 mx-1" />;
}

// ── Main editor ───────────────────────────────────────────────────────────────
interface Props {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export function ArticleEditor({ value, onChange, readOnly = false, placeholder = "เริ่มพิมพ์ที่นี่..." }: Props) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [showCallout, setShowCallout] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
      Placeholder.configure({ placeholder, emptyEditorClass: "is-editor-empty" }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[400px] px-5 py-4 leading-relaxed",
      },
    },
  });

  // Sync external value changes (e.g. after AI regeneration)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowTextColor(false);
      if (hlRef.current && !hlRef.current.contains(e.target as Node)) setShowHighlight(false);
      if (calloutRef.current && !calloutRef.current.contains(e.target as Node)) setShowCallout(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function insertEmoji(emoji: string) {
    editor?.commands.insertContent(emoji);
    setShowEmoji(false);
  }

  function insertCallout(html: string) {
    editor?.commands.insertContent(html);
    setShowCallout(false);
  }

  function setLink() {
    const url = window.prompt("URL:", editor?.getAttributes("link").href ?? "https://");
    if (url === null) return;
    if (url === "") { editor?.chain().focus().unsetLink().run(); return; }
    editor?.chain().focus().setLink({ href: url }).run();
  }

  if (!editor) return null;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">

      {/* ── Toolbar ── */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-gray-100 bg-gray-50/80">

          {/* Undo / Redo */}
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo className="h-4 w-4" /></ToolBtn>
          <Sep />

          {/* Heading */}
          <select
            value={
              editor.isActive("heading", { level: 1 }) ? "h1" :
              editor.isActive("heading", { level: 2 }) ? "h2" :
              editor.isActive("heading", { level: 3 }) ? "h3" : "p"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: parseInt(v[1]) as 1|2|3 }).run();
            }}
            className="text-xs px-2 py-1 rounded-lg border border-gray-100 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-green-400"
          >
            <option value="p">Paragraph</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
          </select>
          <Sep />

          {/* Format */}
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><Bold className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><Italic className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><UnderlineIcon className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strike"><span className="text-sm font-medium line-through">S</span></ToolBtn>
          <Sep />

          {/* Alignment */}
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align Left"><AlignLeft className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align Center"><AlignCenter className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align Right"><AlignRight className="h-4 w-4" /></ToolBtn>
          <Sep />

          {/* Lists */}
          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet List"><List className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered List"><ListOrdered className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote"><Quote className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus className="h-4 w-4" /></ToolBtn>
          <Sep />

          {/* Link */}
          <ToolBtn onClick={setLink} active={editor.isActive("link")} title="Link"><Link2 className="h-4 w-4" /></ToolBtn>
          <Sep />

          {/* Text Color */}
          <div className="relative" ref={colorRef}>
            <ToolBtn onClick={() => { setShowTextColor((v) => !v); setShowHighlight(false); setShowEmoji(false); setShowCallout(false); }} active={showTextColor} title="Text Color">
              <div className="flex items-center gap-0.5">
                <Type className="h-4 w-4" />
                <div className="w-3 h-1 rounded" style={{ background: editor.getAttributes("textStyle").color ?? "#111827" }} />
              </div>
            </ToolBtn>
            {showTextColor && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-lg p-2 w-44">
                <p className="text-xs text-gray-400 mb-1.5 font-medium">Text Color</p>
                <div className="grid grid-cols-6 gap-1">
                  {TEXT_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => { editor.chain().focus().setColor(c).run(); setShowTextColor(false); }}
                      className="w-6 h-6 rounded-lg border border-gray-100 hover:scale-110 transition-transform"
                      style={{ background: c }} title={c}
                    />
                  ))}
                </div>
                <button type="button" onClick={() => { editor.chain().focus().unsetColor().run(); setShowTextColor(false); }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600 w-full text-left">Reset color</button>
              </div>
            )}
          </div>

          {/* Highlight */}
          <div className="relative" ref={hlRef}>
            <ToolBtn onClick={() => { setShowHighlight((v) => !v); setShowTextColor(false); setShowEmoji(false); setShowCallout(false); }} active={showHighlight} title="Highlight">
              <Highlighter className="h-4 w-4" />
            </ToolBtn>
            {showHighlight && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-lg p-2 w-44">
                <p className="text-xs text-gray-400 mb-1.5 font-medium">Highlight Color</p>
                <div className="grid grid-cols-5 gap-1">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => { editor.chain().focus().setHighlight({ color: c }).run(); setShowHighlight(false); }}
                      className="w-7 h-7 rounded-lg border border-gray-100 hover:scale-110 transition-transform"
                      style={{ background: c }} title={c}
                    />
                  ))}
                </div>
                <button type="button" onClick={() => { editor.chain().focus().unsetHighlight().run(); setShowHighlight(false); }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600 w-full text-left">Remove highlight</button>
              </div>
            )}
          </div>
          <Sep />

          {/* Callout boxes */}
          <div className="relative" ref={calloutRef}>
            <button
              type="button"
              onClick={() => { setShowCallout((v) => !v); setShowEmoji(false); setShowTextColor(false); setShowHighlight(false); }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${showCallout ? "bg-green-100 text-green-700" : "hover:bg-gray-100 text-gray-600"}`}
            >
              <Palette className="h-4 w-4" />
              กรอบ
              <ChevronDown className="h-3 w-3" />
            </button>
            {showCallout && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-lg p-2 w-44 space-y-1">
                <p className="text-xs text-gray-400 font-medium mb-1">แทรกกรอบตกแต่ง</p>
                {CALLOUTS.map((c) => (
                  <button key={c.label} type="button" onClick={() => insertCallout(c.html)}
                    className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Emoji */}
          <div className="relative" ref={emojiRef}>
            <button
              type="button"
              onClick={() => { setShowEmoji((v) => !v); setShowCallout(false); setShowTextColor(false); setShowHighlight(false); }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${showEmoji ? "bg-green-100 text-green-700" : "hover:bg-gray-100 text-gray-600"}`}
            >
              <Smile className="h-4 w-4" />
              Emoji
              <ChevronDown className="h-3 w-3" />
            </button>
            {showEmoji && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-lg p-3 w-72">
                {EMOJI_GROUPS.map((group) => (
                  <div key={group.label} className="mb-2">
                    <p className="text-xs text-gray-400 font-medium mb-1">{group.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {group.emojis.map((e) => (
                        <button key={e} type="button" onClick={() => insertEmoji(e)}
                          className="text-lg hover:bg-gray-100 rounded-lg p-0.5 leading-none transition-colors">
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Editor content ── */}
      <EditorContent editor={editor} className="[&_.tiptap]:outline-none" />

      {/* ── Style overrides ── */}
      <style jsx global>{`
        .tiptap h1 { font-size: 1.875rem; font-weight: 800; line-height: 1.2; margin: 1.5rem 0 0.75rem; }
        .tiptap h2 { font-size: 1.35rem; font-weight: 700; line-height: 1.3; margin: 1.25rem 0 0.6rem; }
        .tiptap h3 { font-size: 1.1rem; font-weight: 600; line-height: 1.4; margin: 1rem 0 0.5rem; }
        .tiptap p  { margin: 0.6rem 0; line-height: 1.75; color: #374151; }
        .tiptap ul { list-style: disc; padding-left: 1.5rem; margin: 0.75rem 0; }
        .tiptap ol { list-style: decimal; padding-left: 1.5rem; margin: 0.75rem 0; }
        .tiptap li { margin: 0.25rem 0; line-height: 1.65; }
        .tiptap blockquote { border-left: 4px solid #d1d5db; padding-left: 1rem; color: #6b7280; font-style: italic; margin: 1rem 0; }
        .tiptap a { color: #16a34a; text-decoration: underline; }
        .tiptap hr { border: none; border-top: 2px solid #e5e7eb; margin: 1.5rem 0; }
        .tiptap strong { font-weight: 700; }
        .tiptap mark { border-radius: 3px; padding: 0 2px; }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left; color: #9ca3af; pointer-events: none; height: 0; font-style: italic;
        }
      `}</style>
    </div>
  );
}
