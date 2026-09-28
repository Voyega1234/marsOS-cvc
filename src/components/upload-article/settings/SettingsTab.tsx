"use client";

/**
 * แท็บ "Project Setting" (ไอคอนเฟือง) — รวมทุกการตั้งค่าของลูกค้า Upload Article รายนี้ไว้ที่เดียว:
 * เว็บไซต์ & Connect, สแกนเว็บปลายทาง, สไตล์บทความ, Internal Link, รูปภาพ, Content Engine, ลบลูกค้า
 * ตำแหน่งซับแท็บ: เมนูแนวตั้งด้านซ้ายบนจอใหญ่ / แถบเลื่อนแนวนอนบนมือถือ
 */
import { useState } from "react";
import { Cpu, Globe, ImageIcon, Link2, Megaphone, Palette, ScanSearch, Sparkles, Trash2, UserRound } from "lucide-react";
import type { UploadClientDTO } from "@/lib/upload-article/types";
import ConnectTab from "../tabs/ConnectTab";
import ScanSection from "./ScanSection";
import StyleSection from "./StyleSection";
import InternalLinksSection from "./InternalLinksSection";
import UploadContentEngine from "./UploadContentEngine";
import ImagesSection from "./ImagesSection";
import CtaSection from "./CtaSection";
import AuthorSection from "./AuthorSection";
import TestImageSection from "./TestImageSection";
import DangerSection from "./DangerSection";
import PbnSitesSection from "../pbn/PbnSitesSection";
import { useThemeDraft } from "./useThemeDraft";

export type SettingsSection = "website" | "scan" | "style" | "links" | "images" | "cta" | "author" | "test-image" | "engine" | "danger";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Globe }[] = [
  { id: "website", label: "เว็บไซต์ & Connect", icon: Globe },
  { id: "scan", label: "สแกนเว็บปลายทาง", icon: ScanSearch },
  { id: "style", label: "สไตล์บทความ", icon: Palette },
  { id: "links", label: "Internal Link", icon: Link2 },
  { id: "images", label: "รูปภาพ", icon: ImageIcon },
  { id: "cta", label: "CTA", icon: Megaphone },
  { id: "author", label: "Author Box", icon: UserRound },
  { id: "test-image", label: "Test Image", icon: Sparkles },
  { id: "engine", label: "Content Engine", icon: Cpu },
  { id: "danger", label: "ลบลูกค้า", icon: Trash2 },
];

export default function SettingsTab({
  client, setClient, onDeleted, userRole, section, onSectionChange, mode = "upload",
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  onDeleted: () => void;
  userRole: string;
  section?: SettingsSection;
  onSectionChange?: (s: SettingsSection) => void;
  /** "pbn" = หน้า PBN Backlinks: เว็บไซต์ = รายการเว็บ PBN ทั้งหมด, ไม่มีเมนูลบโปรเจกต์ */
  mode?: "upload" | "pbn";
}) {
  const isPbn = mode === "pbn";
  const sections = isPbn
    ? SECTIONS.filter(s => s.id !== "danger").map(s => (s.id === "website" ? { ...s, label: "เว็บ PBN & Connect" } : s))
    : SECTIONS;
  const [internalSection, setInternalSection] = useState<SettingsSection>("website");
  const requested = section ?? internalSection;
  // โหมด PBN ไม่มีเมนูลบ — ลิงก์เก่า ?section=danger ตกกลับไปหน้าเว็บ
  const active = isPbn && requested === "danger" ? "website" : requested;

  function go(s: SettingsSection) {
    setInternalSection(s);
    onSectionChange?.(s);
  }

  // ธีม (สี/ฟอนต์/หน้าตา FAQ) ใช้ร่วมกันระหว่างแท็บย่อย "scan" และ "style" — อยู่ที่นี่ไม่ให้หายตอนสลับแท็บ
  const themeDraft = useThemeDraft(client, setClient);

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* มือถือ: แถบเลื่อนแนวนอน */}
      <div className="md:hidden -mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1.5 pb-1 w-max">
          {sections.map(s => (
            <button key={s.id} onClick={() => go(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors ${
                active === s.id ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}>
              <s.icon size={13} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* จอใหญ่: เมนูแนวตั้งด้านซ้าย */}
      <div className="hidden md:block w-52 shrink-0">
        <div className="space-y-1 sticky top-4">
          {sections.map(s => (
            <button key={s.id} onClick={() => go(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                active === s.id ? "bg-brand-mist text-brand-blue" : "text-gray-500 hover:bg-gray-50 hover:text-brand-navy"
              }`}>
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {active === "website" && (isPbn
          ? <PbnSitesSection client={client} setClient={setClient} />
          : <ConnectTab client={client} setClient={setClient} />)}
        {active === "scan" && (
          <ScanSection client={client} setClient={setClient}
            setThemeDraft={themeDraft.setThemeDraft} applyScannedTheme={themeDraft.applyScannedTheme} />
        )}
        {active === "style" && (
          <StyleSection themeDraft={themeDraft.themeDraft} setThemeDraft={themeDraft.setThemeDraft}
            setColor={themeDraft.setColor} savingTheme={themeDraft.savingTheme} saveTheme={themeDraft.saveTheme}
            showFaqEditor={themeDraft.showFaqEditor} setShowFaqEditor={themeDraft.setShowFaqEditor} />
        )}
        {active === "links" && <InternalLinksSection clientId={client.id} />}
        {active === "images" && (
          <ImagesSection client={client} setClient={setClient}
            openEngine={() => go("engine")} />
        )}
        {active === "cta" && <CtaSection client={client} setClient={setClient} />}
        {active === "author" && <AuthorSection client={client} setClient={setClient} />}
        {active === "test-image" && <TestImageSection client={client} />}
        {active === "engine" && <UploadContentEngine client={client} userRole={userRole} />}
        {active === "danger" && !isPbn && <DangerSection client={client} onDeleted={onDeleted} />}
      </div>
    </div>
  );
}
