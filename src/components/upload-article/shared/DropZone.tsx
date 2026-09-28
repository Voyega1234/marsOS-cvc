"use client";

/**
 * ลากไฟล์มาวาง (.docx .txt .md .html) — ใช้ทั้งใน UploadClientsBoard (การ์ดลูกค้า)
 * และแท็บ "นำเข้าบทความ" ของ UploadClientWorkspace
 */
import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

const ACCEPT = ".docx,.txt,.md,.markdown,.html,.htm";

export default function DropZone({
  onFiles,
  disabled,
  label = "ลากไฟล์มาวาง (.docx .txt .md .html)",
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onFiles(Array.from(fileList));
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
        compact ? "px-3 py-4" : "px-4 py-8"
      } ${
        dragOver ? "border-brand-blue bg-brand-mist/40" : "border-gray-200 bg-gray-50/60 hover:bg-gray-50"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <UploadCloud size={compact ? 18 : 24} className="text-gray-300" />
      <p className={`text-gray-500 ${compact ? "text-[11px]" : "text-xs"} font-medium`}>{label}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
