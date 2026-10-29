"use client";

import type { RefObject } from "react";
import { Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, AlignJustify, CornerDownLeft, Rows3, Undo2, Redo2 } from "lucide-react";

const BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figure,td,th";

// แถบจัดรูปแบบสำหรับ contentEditable (ScopedEditable) — ใช้ inline style ให้รอดตอน push
export default function EditorToolbar({
  editorRef,
  onChange,
  className = "",
}: {
  editorRef: RefObject<HTMLDivElement>;
  onChange?: () => void;
  className?: string;
}) {
  const done = () => onChange?.();

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    done();
  }

  // บล็อกที่เลือกอยู่ (ชั้นในสุด) ภายใน editor เท่านั้น
  function selectedBlocks(): HTMLElement[] {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return [];
    const inStyle = (el: Element) => !!el.closest("style,script");
    let list: HTMLElement[] = [];
    if (!range.collapsed) {
      list = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SEL)).filter(
        (el) => range.intersectsNode(el) && !inStyle(el),
      );
    }
    if (list.length === 0) {
      const start = range.startContainer;
      const node = start.nodeType === 1 ? (start as Element) : start.parentElement;
      const el = node?.closest<HTMLElement>(BLOCK_SEL);
      if (el && root.contains(el) && el !== root && !inStyle(el)) list = [el];
    }
    return list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
  }

  function applyStyle(prop: string, value: string | null) {
    editorRef.current?.focus();
    for (const el of selectedBlocks()) {
      if (value === null) {
        el.style.removeProperty(prop);
        if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
      } else {
        el.style.setProperty(prop, value);
      }
    }
    done();
  }

  function lineBreak() {
    editorRef.current?.focus();
    if (!document.execCommand("insertLineBreak")) document.execCommand("insertHTML", false, "<br>");
    done();
  }

  // แทรกย่อหน้าว่างต่อท้ายบล็อกที่ caret อยู่ (DOM ตรง ๆ ไม่ซ้อนใน <p>)
  function blankLine() {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    root.focus();
    const range = sel.getRangeAt(0);
    if (!root.contains(range.endContainer)) return;
    const n = range.endContainer;
    const base = n.nodeType === 1 ? (n as Element) : n.parentElement;
    let block = base?.closest<HTMLElement>(BLOCK_SEL) ?? null;
    if (block && block.closest("li")) block = block.closest("ul,ol") as HTMLElement | null;
    else if (block) {
      const outer = block.closest("table,figure,blockquote");
      if (outer && root.contains(outer)) block = outer as HTMLElement;
    }
    const p = document.createElement("p");
    p.innerHTML = "&nbsp;";
    if (block && block !== root && root.contains(block)) block.after(p);
    else root.appendChild(p);
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    done();
  }

  const btn = "p-1.5 rounded hover:bg-gray-200 text-gray-700 transition-colors";
  const txt = "px-2 py-1 rounded text-xs font-semibold hover:bg-gray-200 text-gray-700 transition-colors";
  const sep = <div className="w-px h-4 bg-gray-300 mx-1" />;
  const md = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn(); };

  const iconBtn = (Icon: typeof Bold, title: string, fn: () => void) => (
    <button type="button" key={title} title={title} onMouseDown={md(fn)} className={btn}>
      <Icon size={14} />
    </button>
  );
  const textBtn = (label: string, title: string, fn: () => void) => (
    <button type="button" key={title} title={title} onMouseDown={md(fn)} className={txt}>
      {label}
    </button>
  );

  return (
    <div className={`flex items-center gap-0.5 flex-wrap px-3 py-1.5 border-b border-gray-200 bg-gray-50 ${className}`}>
      {iconBtn(Bold, "ตัวหนา", () => exec("bold"))}
      {iconBtn(Italic, "ตัวเอียง", () => exec("italic"))}
      {iconBtn(Underline, "ขีดเส้นใต้", () => exec("underline"))}
      {sep}
      {textBtn("H2", "หัวข้อ H2", () => exec("formatBlock", "h2"))}
      {textBtn("H3", "หัวข้อ H3", () => exec("formatBlock", "h3"))}
      {textBtn("H4", "หัวข้อ H4", () => exec("formatBlock", "h4"))}
      {textBtn("ย่อหน้า", "ย่อหน้าปกติ", () => exec("formatBlock", "p"))}
      {sep}
      {iconBtn(List, "รายการแบบจุด", () => exec("insertUnorderedList"))}
      {iconBtn(ListOrdered, "รายการแบบตัวเลข", () => exec("insertOrderedList"))}
      {sep}
      {iconBtn(AlignLeft, "ชิดซ้าย", () => exec("justifyLeft"))}
      {iconBtn(AlignCenter, "กึ่งกลาง", () => exec("justifyCenter"))}
      {iconBtn(AlignRight, "ชิดขวา", () => exec("justifyRight"))}
      {iconBtn(AlignJustify, "เต็มแนว", () => exec("justifyFull"))}
      {sep}
      {iconBtn(CornerDownLeft, "ขึ้นบรรทัดใหม่ (ในย่อหน้าเดิม)", lineBreak)}
      {iconBtn(Rows3, "เว้นบรรทัดว่าง (เพิ่มย่อหน้าว่างต่อท้าย)", blankLine)}
      {sep}
      <span className="text-[10px] text-gray-500 mr-0.5">ห่างย่อหน้า</span>
      {textBtn("ชิด", "ระยะห่างย่อหน้า: ชิด", () => applyStyle("margin-bottom", "0.25em"))}
      {textBtn("ปกติ", "ระยะห่างย่อหน้า: ปกติ", () => applyStyle("margin-bottom", null))}
      {textBtn("ห่าง", "ระยะห่างย่อหน้า: ห่าง", () => applyStyle("margin-bottom", "1.6em"))}
      {textBtn("ห่างมาก", "ระยะห่างย่อหน้า: ห่างมาก", () => applyStyle("margin-bottom", "2.6em"))}
      {sep}
      <span className="text-[10px] text-gray-500 mr-0.5">ระยะบรรทัด</span>
      {textBtn("แน่น", "ระยะบรรทัด: แน่น", () => applyStyle("line-height", "1.35"))}
      {textBtn("ปกติ", "ระยะบรรทัด: ปกติ", () => applyStyle("line-height", null))}
      {textBtn("โปร่ง", "ระยะบรรทัด: โปร่ง", () => applyStyle("line-height", "2"))}
      {sep}
      {iconBtn(Undo2, "เลิกทำ", () => exec("undo"))}
      {iconBtn(Redo2, "ทำซ้ำ", () => exec("redo"))}
    </div>
  );
}
