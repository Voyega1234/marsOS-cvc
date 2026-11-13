"use client";

/**
 * โลโก้ลูกค้าในตาราง Upload Article — รูปจัตุรัส ไม่มีโลโก้ใช้ตัวอักษรย่อบนสีธีมลูกค้า
 * อัปโหลด: ย่อด้วย canvas เป็น webp ไม่เกิน 96x96 ในเบราว์เซอร์เสมอ (SVG ไม่ถึง DB) แล้ว PATCH clientLogo
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, X } from "lucide-react";

const SIZE = 96;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** เป้าหมายขนาด ~20KB (ตัวอักษร base64) */
const TARGET_CHARS = 20 * 1024;
/** เพดานจริงของ API คือ 40KB — เผื่อไว้ */
const HARD_CHARS = 38 * 1024;

/** ตัวอักษรย่อ: ภาษาอังกฤษ = อักษรต้นของ 2 คำแรก, ไทย/อื่น ๆ = ตัวแรก (นับ grapheme) */
export function initialsOf(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const words = t.split(/\s+/).filter(Boolean);
  if (/^[A-Za-z0-9]/.test(t) && words.length > 1) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (/^[A-Za-z0-9]/.test(t)) return t.slice(0, 2).toUpperCase();
  const seg = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(t), s => s.segment)
    : Array.from(t);
  return seg[0] ?? "?";
}

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map(x => x + x).join("");
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** เลือกสีตัวอักษรให้อ่านง่ายบนสีพื้น (ขาว/เข้ม ตามความสว่าง) */
export function avatarColors(theme: string): { bg: string; fg: string } {
  const rgb = parseHex(theme || "") ?? [37, 99, 235];
  const lin = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return { bg: `rgb(${rgb.join(",")})`, fg: L > 0.4 ? "#0f172a" : "#ffffff" };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านรูปไม่ได้")); };
    img.src = url; // ผ่าน <img> เท่านั้น สคริปต์ใน SVG ไม่ทำงาน
  });
}

/** ย่อรูปเป็น data URL webp (contain, พื้นโปร่งใส) ให้เล็กกว่าเพดาน */
export async function rasterizeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("รองรับเฉพาะ png, jpg, webp, svg");
  if (file.size > MAX_INPUT_BYTES) throw new Error("ไฟล์ใหญ่เกิน 8MB");
  const img = await loadImage(file);
  const w = img.naturalWidth || SIZE;
  const h = img.naturalHeight || SIZE;
  for (const side of [SIZE, 72, 56]) {
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับ canvas");
    const scale = Math.min(side / w, side / h);
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(img, Math.round((side - dw) / 2), Math.round((side - dh) / 2), dw, dh);
    for (const q of [0.9, 0.8, 0.65, 0.5]) {
      const out = canvas.toDataURL("image/webp", q);
      if (!/^data:image\/(webp|png);base64,/.test(out)) continue;
      if (out.length <= TARGET_CHARS) return out;
      if (q === 0.5 && out.length <= HARD_CHARS && side === 56) return out;
    }
  }
  throw new Error("ย่อรูปให้เล็กพอไม่ได้ ลองรูปที่เรียบกว่านี้");
}

async function patchLogo(clientId: string, logo: string | null): Promise<void> {
  const r = await fetch(`/api/upload-article/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientLogo: logo }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error || `HTTP ${r.status}`);
  }
}

export default function ClientAvatar({
  clientId, name, theme, logo, onChange, size = 36, save, readOnly,
}: {
  clientId: string;
  name: string;
  theme: string;
  logo?: string | null;
  /** อัปเดต state ฝั่งหน้า (optimistic) */
  onChange: (logo: string | null) => void;
  size?: number;
  /** ถ้าส่งมา ใช้แทน PATCH ของ Upload Article (เช่น โปรเจกต์ SME) */
  save?: (logo: string | null) => Promise<void>;
  /** แสดงอย่างเดียว ไม่มีปุ่มอัปโหลด/ลบ */
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { bg, fg } = avatarColors(theme);

  async function apply(next: string | null, errPrefix: string) {
    const prev = logo ?? null;
    onChange(next);
    setBusy(true);
    try {
      await (save ? save(next) : patchLogo(clientId, next));
    } catch (e) {
      onChange(prev);
      toast.error(`${errPrefix}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file || busy) return;
    let data: string;
    try {
      data = await rasterizeLogo(file);
    } catch (e) {
      toast.error(`ตั้งโลโก้ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await apply(data, "ตั้งโลโก้ไม่สำเร็จ");
  }

  if (readOnly) {
    return (
      <div
        className="relative block shrink-0 rounded-2xl overflow-hidden border border-white/80 shadow-sm"
        style={{ width: size, height: size, ...(logo ? { background: "#fff" } : { background: bg, color: fg }) }}
        title={name}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-sm font-bold select-none">{initialsOf(name)}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative group shrink-0" style={{ width: size, height: size }}>
      <button
        type="button"
        disabled={busy}
        onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
        aria-label={`${logo ? "เปลี่ยน" : "อัปโหลด"}โลโก้ ${name}`}
        title="อัปโหลดโลโก้ (png, jpg, webp, svg)"
        className="relative block w-full h-full rounded-2xl overflow-hidden border border-white/80 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue disabled:opacity-60"
        style={logo ? { background: "#fff" } : { background: bg, color: fg }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-sm font-bold select-none">{initialsOf(name)}</span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Camera size={14} />
        </span>
      </button>
      {logo && (
        <button
          type="button"
          disabled={busy}
          onClick={e => { e.stopPropagation(); apply(null, "ลบโลโก้ไม่สำเร็จ"); }}
          aria-label={`ลบโลโก้ ${name}`}
          title="ลบโลโก้"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-gray-300 text-gray-500 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-rose-600"
        >
          <X size={10} />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; void onPick(f); }}
      />
    </div>
  );
}
