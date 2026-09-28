"use client";

/**
 * Project Setting > CTA — ตั้งได้หลายแบบ (ปุ่มมาตรฐาน / ออกแบบเอง / แบนเนอร์รูป) ระบบสุ่มหยิบไปวางตามจำนวนที่ตั้งต่อบทความ
 * พอร์ตหน้าตาต่อแบบมาจาก Article Lab (ClientDetailTabs.tsx, sub-tab "cta") — เก็บที่ pushPrefs.cta
 * เป็น heavy key (แบนเนอร์/โลโก้เป็น base64) ไม่ส่งมากับ UploadClientDTO — โหลด/บันทึกผ่าน /clients/[id]/cta เอง
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Megaphone, ChevronDown, ChevronUp, Copy, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downscaleDataUrl, fileToDownscaledDataUrl } from "@/lib/imageDownscale";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import {
  DEFAULT_UPLOAD_CTA, UPLOAD_CTA_MAX_BANNERS, UPLOAD_CTA_MAX_ITEMS, UPLOAD_CTA_MIN_PER_ARTICLE, UPLOAD_CTA_MAX_PER_ARTICLE,
  defaultUploadCtaCustom, defaultUploadCtaItem, isUploadCtaItemReady, isUploadCtaReady, uploadCtaSummary,
  type UploadCtaButtonStyle, type UploadCtaChannelType, type UploadCtaItem, type UploadCtaSettings,
} from "@/lib/upload-article/cta";
import type { CtaCustomDesign, CtaMode } from "@/lib/articleComponents";

const CTA_CHANNEL_OPTS: { type: UploadCtaChannelType; icon: string; placeholder: string; defaultLabel: string }[] = [
  { type: "line", icon: "💬", placeholder: "https://line.me/ti/p/~...", defaultLabel: "Line" },
  { type: "facebook", icon: "📘", placeholder: "https://fb.me/...", defaultLabel: "Facebook" },
  { type: "phone", icon: "📞", placeholder: "02-xxx-xxxx", defaultLabel: "Phone" },
  { type: "email", icon: "✉️", placeholder: "contact@example.com", defaultLabel: "Email" },
  { type: "website", icon: "🌐", placeholder: "https://example.com/contact", defaultLabel: "Website" },
  { type: "form", icon: "📋", placeholder: "https://example.com/form", defaultLabel: "Form" },
  { type: "custom", icon: "⭐", placeholder: "ข้อความหรือลิงก์", defaultLabel: "ติดต่อเรา" },
];

function CtaItemEditor({ item, onChange, accentColor, border, isOpen, onToggle, onDuplicate, onRemove, canRemove }: {
  item: UploadCtaItem;
  onChange: (patch: Partial<UploadCtaItem>) => void;
  accentColor: string;
  border: string;
  isOpen: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const ready = isUploadCtaItemReady(item);
  const custom = item.mode === "custom" ? (item.custom ?? defaultUploadCtaCustom(accentColor, border)) : null;
  const notReadyMsg = item.mode === "banner"
    ? "ต้องมีแบนเนอร์ที่มีรูป + ลิงก์อย่างน้อย 1 รูป"
    : "ยังใช้ไม่ได้ — ต้องมีช่องทางที่มีลิงก์/เบอร์อย่างน้อย 1 ช่อง";

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggle} className="text-gray-400 hover:text-gray-600 shrink-0">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <input
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value.slice(0, 60) })}
          placeholder="ชื่อ CTA (ไว้ดูเฉย ๆ)"
          className="flex-1 text-sm font-semibold text-brand-navy border-0 focus:outline-none focus:ring-0 min-w-0"
        />
        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${ready ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
          {ready ? "พร้อมใช้งาน" : "ยังไม่พร้อม"}
        </span>
        <button onClick={onDuplicate} title="ทำสำเนา" className="text-gray-300 hover:text-gray-600 shrink-0">
          <Copy size={14} />
        </button>
        <button onClick={onRemove} disabled={!canRemove} title="ลบ" className="text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {!ready && (
            <p className="text-[11px] text-amber-600">{notReadyMsg}</p>
          )}

          {/* Mode selector — ปุ่มมาตรฐาน / ออกแบบเอง / แบนเนอร์รูป */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">รูปแบบ CTA</p>
            <div className="flex gap-1">
              {([["buttons", "ปุ่มมาตรฐาน"], ["custom", "ออกแบบเอง"], ["banner", "แบนเนอร์รูป"]] as [CtaMode, string][]).map(([v, lbl]) => (
                <button key={v}
                  onClick={() => onChange({
                    mode: v,
                    custom: v === "custom" && !item.custom ? defaultUploadCtaCustom(accentColor, border) : item.custom,
                  })}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${item.mode === v ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {item.mode !== "banner" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Headline</label>
                <input value={item.headline} onChange={(e) => onChange({ headline: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subtext</label>
                <input value={item.subtext} onChange={(e) => onChange({ subtext: e.target.value })}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-200" />
              </div>
            </div>
          )}

          {/* Layout controls */}
          {item.mode !== "banner" && (
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">การจัดวาง</p>
                <div className="flex gap-1">
                  {([["left", "◀ ซ้าย"], ["center", "■ กลาง"], ["right", "ขวา ▶"]] as [UploadCtaItem["alignment"], string][]).map(([v, lbl]) => (
                    <button key={v} onClick={() => onChange({ alignment: v })}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${item.alignment === v ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">ปุ่มเรียงแนว</p>
                <div className="flex gap-1">
                  {([["row", "แนวนอน ▷▷"], ["column", "แนวตั้ง ↓"]] as [UploadCtaItem["buttonLayout"], string][]).map(([v, lbl]) => (
                    <button key={v} onClick={() => onChange({ buttonLayout: v })}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${item.buttonLayout === v ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ออกแบบกล่อง CTA — โหมด custom เท่านั้น */}
          {item.mode === "custom" && custom && (() => {
            const updateCustom = (patch: Partial<CtaCustomDesign>) =>
              onChange({ custom: { ...(item.custom ?? custom), ...patch } });
            const colorRows: { key: keyof CtaCustomDesign; label: string }[] = [
              { key: "boxBg", label: "พื้นกล่อง" },
              { key: "boxText", label: "สีตัวอักษร" },
              { key: "boxBorderColor", label: "สีกรอบกล่อง" },
              { key: "buttonBg", label: "พื้นปุ่ม" },
              { key: "buttonText", label: "สีตัวอักษรปุ่ม" },
              { key: "buttonBorderColor", label: "สีกรอบปุ่ม" },
            ];
            return (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">ออกแบบกล่อง CTA</p>
                  <button
                    onClick={() => updateCustom(defaultUploadCtaCustom(accentColor, border))}
                    className="text-[10px] text-gray-400 hover:text-brand-blue">รีเซ็ตเป็นสีธีม</button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {colorRows.map(({ key, label }) => {
                    const val = (custom[key] as string) || "#ffffff";
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <label className="relative w-7 h-7 rounded-lg border border-gray-200 cursor-pointer shrink-0 overflow-hidden"
                          style={{ backgroundColor: val === "transparent" ? "#fff" : val }} title={label}>
                          <input type="color" value={val === "transparent" ? "#ffffff" : val}
                            onChange={(e) => updateCustom({ [key]: e.target.value } as Partial<CtaCustomDesign>)}
                            className="absolute inset-0 opacity-0 cursor-pointer" />
                        </label>
                        <span className="text-[11px] text-gray-600 flex-1">{label}</span>
                        <input value={val}
                          onChange={(e) => updateCustom({ [key]: e.target.value } as Partial<CtaCustomDesign>)}
                          className="w-20 text-[10px] font-mono border border-gray-200 rounded-lg px-1.5 py-1 focus:outline-none" />
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1">
                  {([
                    ["boxBorderWidth", "กรอบกล่อง (px)", 0, 6],
                    ["boxRadius", "มุมกล่อง (px)", 0, 32],
                    ["buttonRadius", "มุมปุ่ม (px)", 0, 32],
                  ] as [keyof CtaCustomDesign, string, number, number][]).map(([key, label, min, max]) => (
                    <div key={key}>
                      <p className="text-[10px] text-gray-500 mb-1">{label}: {custom[key]}</p>
                      <input type="range" min={min} max={max} value={custom[key] as number}
                        onChange={(e) => updateCustom({ [key]: Number(e.target.value) } as Partial<CtaCustomDesign>)}
                        className="w-full" />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Preview card — buttons/custom เท่านั้น (banner ใช้พรีวิวรูปแทน) */}
          {item.mode !== "banner" && (item.headline || item.subtext || item.channels.filter((c) => c.value).length > 0) && (() => {
            const boxStyle: React.CSSProperties = custom
              ? { background: custom.boxBg, borderColor: custom.boxBorderColor, borderWidth: custom.boxBorderWidth, borderStyle: "solid", borderRadius: custom.boxRadius, textAlign: item.alignment }
              : { borderColor: accentColor + "40", background: accentColor + "08", textAlign: item.alignment };
            const textColor = custom ? custom.boxText : undefined;
            return (
              <div className={custom ? "p-4" : "rounded-2xl border-2 p-4"} style={boxStyle}>
                {item.headline && <p className={`font-bold text-sm ${custom ? "" : "text-brand-navy"}`} style={custom ? { color: textColor } : undefined}>{item.headline}</p>}
                {item.subtext && <p className={`text-xs mt-0.5 ${custom ? "" : "text-gray-500"}`} style={custom ? { color: textColor, opacity: 0.85 } : undefined}>{item.subtext}</p>}
                {item.channels.filter((c) => c.value).length > 0 && (
                  <div className={`flex gap-2 mt-3 flex-wrap ${item.alignment === "center" ? "justify-center" : item.alignment === "right" ? "justify-end" : "justify-start"} ${item.buttonLayout === "column" ? "flex-col items-start" : ""} ${item.buttonLayout === "column" && item.alignment === "center" ? "!items-center" : ""} ${item.buttonLayout === "column" && item.alignment === "right" ? "!items-end" : ""}`}>
                    {item.channels.filter((c) => c.value).map((c, i) => {
                      const opt = CTA_CHANNEL_OPTS.find((o) => o.type === c.type);
                      const icon = c.icon ?? opt?.icon ?? "";
                      const style = c.buttonStyle ?? "filled";
                      const customBtnStyle: React.CSSProperties | null = custom
                        ? (i === 0
                          ? { background: custom.buttonBg, color: custom.buttonText, border: `1.5px solid ${custom.buttonBorderColor}`, borderRadius: custom.buttonRadius }
                          : { background: "transparent", color: custom.boxText, border: `1.5px solid ${custom.boxText}`, borderRadius: custom.buttonRadius })
                        : null;
                      return (
                        <span key={c.type} className={`text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${customBtnStyle ? "" : (style === "filled" ? "text-white" : style === "outline" ? "bg-transparent border-2" : "bg-transparent")}`}
                          style={customBtnStyle ?? (style === "filled" ? { backgroundColor: accentColor } : style === "outline" ? { borderColor: accentColor, color: accentColor } : { color: accentColor })}>
                          {c.imageUrl
                            ? <img src={c.imageUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                            : icon ? <span>{icon}</span> : null}
                          {c.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* แบนเนอร์ CTA — โหมด banner เท่านั้น */}
          {item.mode === "banner" && (() => {
            const banners = item.banners;
            const addBanner = () => {
              if (banners.length >= UPLOAD_CTA_MAX_BANNERS) return;
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              onChange({ banners: [...banners, { id, imageUrl: "", href: "", alt: "" }] });
            };
            const updateBanner = (id: string, patch: Partial<UploadCtaItem["banners"][number]>) =>
              onChange({ banners: banners.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
            const removeBanner = (id: string) =>
              onChange({ banners: banners.filter((b) => b.id !== id) });
            return (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">แบนเนอร์ CTA (สูงสุด {UPLOAD_CTA_MAX_BANNERS} รูป)</p>
                  <button onClick={addBanner} disabled={banners.length >= UPLOAD_CTA_MAX_BANNERS}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    + เพิ่มรูป
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 leading-4">
                  1 รูป = ใช้รูปนั้นทุกบทความ · หลายรูป = ระบบสุ่มเลือก 1 รูปต่อบทความ · กดที่รูปแล้วไปที่ลิงก์ที่ใส่
                </p>
                {banners.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">ยังไม่มีแบนเนอร์ — กด "+ เพิ่มรูป"</p>
                )}
                <div className="space-y-3">
                  {banners.map((b) => (
                    <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-3 flex gap-3">
                      <div className="shrink-0">
                        {b.imageUrl ? (
                          <img src={b.imageUrl} alt="" className="max-h-32 rounded-lg border border-gray-100 object-contain" />
                        ) : (
                          <label className="w-28 h-20 rounded-lg border border-dashed border-blue-300 flex items-center justify-center cursor-pointer text-[10px] text-blue-500 hover:border-blue-500 transition-colors">
                            <span>+ อัพโหลด</span>
                            <input type="file" accept="image/*" className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                fileToDownscaledDataUrl(file, 1200)
                                  .then((url) => updateBanner(b.id, { imageUrl: url }))
                                  .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
                                e.target.value = "";
                              }} />
                          </label>
                        )}
                        {b.imageUrl && (
                          <button onClick={() => updateBanner(b.id, { imageUrl: "" })}
                            className="mt-1 text-[10px] text-gray-400 hover:text-red-500">เปลี่ยนรูป</button>
                        )}
                      </div>
                      <div className="flex-1 space-y-1.5 min-w-0">
                        <input value={b.href} onChange={(e) => updateBanner(b.id, { href: e.target.value })}
                          placeholder="ลิงก์เมื่อกด เช่น https://line.me/... / tel:02xxxxxxx"
                          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none" />
                        <input value={b.alt} onChange={(e) => updateBanner(b.id, { alt: e.target.value })}
                          placeholder="alt (คำบรรยายรูป)"
                          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none" />
                      </div>
                      <button onClick={() => removeBanner(b.id)}
                        className="text-gray-300 hover:text-red-400 text-sm shrink-0 self-start">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">ช่องทางติดต่อ <span className="font-normal text-gray-400">(ลากเพื่อเรียงลำดับ)</span></p>
            {item.mode === "banner" && (
              <p className="text-[10px] text-gray-400 -mt-1 mb-2">ช่องทางด้านล่างใช้เฉพาะลิงก์ข้อความหลัง Short Answer (ไม่บังคับ)</p>
            )}
            {/* Active channels — draggable to reorder */}
            {item.channels.length > 0 && (
              <div className="space-y-2 mb-3 pb-3 border-b border-gray-100">
                {item.channels.map((ch, idx) => {
                  const opt = CTA_CHANNEL_OPTS.find((o) => o.type === ch.type)!;
                  const currentIcon = ch.icon ?? opt.icon;
                  return (
                    <div key={ch.type}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(idx))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (from === idx) return;
                        const arr = [...item.channels];
                        const [chan] = arr.splice(from, 1);
                        arr.splice(idx, 0, chan);
                        onChange({ channels: arr });
                      }}
                      className="bg-gray-50 rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing group">
                      {/* Row 1: drag handle + type + label + value + delete */}
                      <div className="flex items-center gap-2">
                        <span className="text-gray-300 text-xs select-none shrink-0">⠿</span>
                        <span className="text-[10px] text-gray-400 w-16 shrink-0">{opt.type}</span>
                        <input
                          value={ch.label}
                          onChange={(e) => onChange({ channels: item.channels.map((c) => (c.type === ch.type ? { ...c, label: e.target.value } : c)) })}
                          placeholder="ชื่อปุ่ม"
                          className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none bg-white shrink-0"
                        />
                        <input
                          value={ch.value}
                          onChange={(e) => onChange({ channels: item.channels.map((c) => (c.type === ch.type ? { ...c, value: e.target.value } : c)) })}
                          placeholder={opt.placeholder}
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none bg-white"
                        />
                        <button
                          onClick={() => onChange({ channels: item.channels.filter((c) => c.type !== ch.type) })}
                          className="text-gray-300 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          ✕
                        </button>
                      </div>
                      {/* Row 2: image upload + button style */}
                      <div className="flex items-center gap-3 mt-2 pl-7">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-gray-400 shrink-0">รูป/โลโก้:</span>
                          {ch.imageUrl ? (
                            <div className="relative shrink-0">
                              <img src={ch.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200" />
                              <button
                                onClick={() => onChange({ channels: item.channels.map((c) => (c.type === ch.type ? { ...c, imageUrl: undefined } : c)) })}
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center leading-none">
                                ✕
                              </button>
                            </div>
                          ) : (
                            <label className="cursor-pointer flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 border border-dashed border-blue-300 rounded-lg px-2 py-1 hover:border-blue-500 transition-colors">
                              <span>+ อัพโหลด</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  fileToDownscaledDataUrl(file, 600)
                                    .then((url) => onChange({ channels: item.channels.map((c) => (c.type === ch.type ? { ...c, imageUrl: url } : c)) }))
                                    .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )}
                          {!ch.imageUrl && (
                            <span className="text-[10px] text-gray-300">{currentIcon}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-auto shrink-0">
                          <span className="text-[10px] text-gray-400">สไตล์:</span>
                          {(["filled", "outline", "ghost"] as UploadCtaButtonStyle[]).map((s) => (
                            <button key={s} onClick={() => onChange({ channels: item.channels.map((c) => (c.type === ch.type ? { ...c, buttonStyle: s } : c)) })}
                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${(ch.buttonStyle ?? "filled") === s ? "border-gray-700 bg-gray-700 text-white" : "border-gray-200 text-gray-400 hover:border-gray-400"}`}>
                              {s === "filled" ? "ทึบ" : s === "outline" ? "กรอบ" : "ข้อความ"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Add channel buttons */}
            <div className="flex flex-wrap gap-1.5">
              {CTA_CHANNEL_OPTS.filter((opt) => !item.channels.find((c) => c.type === opt.type)).map((opt) => (
                <button key={opt.type}
                  onClick={() => onChange({ channels: [...item.channels, { type: opt.type, label: opt.defaultLabel, value: "", icon: opt.icon, buttonStyle: "filled" as UploadCtaButtonStyle }] })}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-500 hover:text-gray-700 transition-colors">
                  + {opt.icon} {opt.type}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CtaSection({ client, setClient }: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
}) {
  const [draft, setDraft] = useState<UploadCtaSettings>(DEFAULT_UPLOAD_CTA);
  const [saved, setSaved] = useState<UploadCtaSettings>(DEFAULT_UPLOAD_CTA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/upload-article/clients/${client.id}/cta`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setDraft(d);
        setSaved(d);
        setOpenId(d.items?.[0]?.id ?? null);
      } else {
        toast.error(d?.error || "โหลด CTA ไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const accentColor = client.theme.theme;
  const border = client.theme.border;

  async function save() {
    setSaving(true);
    try {
      // รูปโลโก้ช่องทาง/แบนเนอร์เป็น base64 ที่อาจใหญ่หลาย MB — ย่อก่อนส่งทุกครั้งกันชนเพดาน 4.5MB ของ Vercel
      const slim: UploadCtaSettings = {
        ...draft,
        items: await Promise.all(draft.items.map(async (item) => ({
          ...item,
          channels: await Promise.all(item.channels.map(async (c) => (
            c.imageUrl ? { ...c, imageUrl: await downscaleDataUrl(c.imageUrl, 600) } : c
          ))),
          banners: await Promise.all(item.banners.map(async (b) => (
            b.imageUrl ? { ...b, imageUrl: await downscaleDataUrl(b.imageUrl, 1200) } : b
          ))),
        }))),
      };
      const r = await fetch(`/api/upload-article/clients/${client.id}/cta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slim),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || "บันทึกไม่สำเร็จ"); return; }
      setDraft(d);
      setSaved(d);
      setClient({ ...client, ctaSummary: uploadCtaSummary(d) });
      toast.success("บันทึก CTA แล้ว");
    } finally {
      setSaving(false);
    }
  }

  function updateItem(id: string, patch: Partial<UploadCtaItem>) {
    setDraft((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }

  function addItem() {
    if (draft.items.length >= UPLOAD_CTA_MAX_ITEMS) return;
    const id = `cta-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const item = defaultUploadCtaItem(id, `CTA ${draft.items.length + 1}`);
    setDraft((p) => ({ ...p, items: [...p.items, item] }));
    setOpenId(id);
  }

  function duplicateItem(id: string) {
    if (draft.items.length >= UPLOAD_CTA_MAX_ITEMS) return;
    const src = draft.items.find((it) => it.id === id);
    if (!src) return;
    const newId = `cta-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const copy: UploadCtaItem = { ...src, id: newId, name: `${src.name} (สำเนา)` };
    setDraft((p) => {
      const idx = p.items.findIndex((it) => it.id === id);
      const items = [...p.items];
      items.splice(idx + 1, 0, copy);
      return { ...p, items };
    });
    setOpenId(newId);
  }

  function removeItem(id: string) {
    const item = draft.items.find((it) => it.id === id);
    if (!item) return;
    if (!window.confirm(`ลบ CTA "${item.name}" ใช่ไหม?`)) return;
    setDraft((p) => ({ ...p, items: p.items.filter((it) => it.id !== id) }));
    if (openId === id) setOpenId(null);
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">กำลังโหลด...</p>;

  const ready = isUploadCtaReady(draft);
  const readyCount = draft.items.filter(isUploadCtaItemReady).length;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-sm font-bold text-brand-navy flex items-center gap-1.5"><Megaphone size={14} /> CTA (Call-to-Action)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              CTA จะถูกใส่เฉพาะบทความที่ติ๊ก "ใส่ CTA" ในแท็บเขียนบทความ — ระบบจะสุ่ม CTA จากรายการด้านล่างไปวางตามจำนวนที่ตั้งไว้ กระจายตามหัวข้อ อันสุดท้ายอยู่ก่อน FAQ
            </p>
          </div>
          <button
            onClick={() => setDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${draft.enabled ? "bg-emerald-500" : "bg-gray-200"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        {draft.enabled && (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">จำนวน CTA ต่อ 1 บทความ</label>
            <select
              value={draft.perArticle}
              onChange={(e) => setDraft((p) => ({ ...p, perArticle: Number(e.target.value) }))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {Array.from({ length: UPLOAD_CTA_MAX_PER_ARTICLE - UPLOAD_CTA_MIN_PER_ARTICLE + 1 }, (_, i) => UPLOAD_CTA_MIN_PER_ARTICLE + i).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        {draft.enabled && (
          <p className={`text-[11px] mt-2 ${ready ? "text-emerald-600" : "text-amber-600"}`}>
            {ready ? `พร้อมใช้งาน — มี ${readyCount} แบบที่ตั้งค่าครบ` : "ยังใช้ไม่ได้ — ต้องมี CTA อย่างน้อย 1 แบบที่ตั้งค่าครบ"}
          </p>
        )}

        {!draft.enabled && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">เปิด CTA เพื่อตั้งค่า</p>
          </div>
        )}
      </div>

      {draft.enabled && (
        <div className="space-y-3">
          {draft.items.map((item) => (
            <CtaItemEditor
              key={item.id}
              item={item}
              onChange={(patch) => updateItem(item.id, patch)}
              accentColor={accentColor}
              border={border}
              isOpen={openId === item.id}
              onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
              onDuplicate={() => duplicateItem(item.id)}
              onRemove={() => removeItem(item.id)}
              canRemove={draft.items.length > 1}
            />
          ))}

          {draft.items.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-2xl">ยังไม่มี CTA — กด "เพิ่ม CTA" ด้านล่าง</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={addItem}
              disabled={draft.items.length >= UPLOAD_CTA_MAX_ITEMS}
              className="flex items-center gap-1 text-xs px-3 py-1.5 border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Plus size={12} /> เพิ่ม CTA
            </button>
            <span className="text-[11px] text-gray-400">{draft.items.length}/{UPLOAD_CTA_MAX_ITEMS} แบบ</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={12} className="mr-1.5 animate-spin" />} บันทึก
        </Button>
        {dirty && <span className="text-xs text-amber-600">ยังไม่ได้บันทึก</span>}
      </div>
    </div>
  );
}
