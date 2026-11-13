"use client";

/**
 * แท็บ "Project Setting" (ไอคอนเฟือง) — รวมทุกการตั้งค่าของลูกค้า Upload Article รายนี้ไว้ที่เดียว:
 * Checklist (upload เท่านั้น), Website & Connect, Article Style (สแกนเว็บ + สไตล์), Internal Link, Images, Content Engine, Delete Client
 * ตำแหน่งซับแท็บ: เมนูแนวตั้งด้านซ้ายบนจอใหญ่ / แถบเลื่อนแนวนอนบนมือถือ
 */
import { useEffect, useState } from "react";
import { ClipboardCheck, Cpu, Globe, ImageIcon, Link2, Megaphone, Palette, Sparkles, Trash2, UserRound } from "lucide-react";
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
import UploadSetupChecklist from "./UploadSetupChecklist";
import type { UploadSetupChecklistStatus } from "./useUploadSetupChecklist";
import PbnSitesSection from "../pbn/PbnSitesSection";
import { useThemeDraft } from "./useThemeDraft";
import PbnStylePicker from "../pbn/PbnStylePicker";
import { usePbnSites } from "../pbn/usePbnSites";
import { usePbnProfiles } from "../pbn/usePbnProfiles";
import { usePbnSiteThemeDraft, usePbnStyles } from "../pbn/usePbnSiteThemeDraft";
import { PBN_MAIN_PROFILE } from "@/lib/upload-article/pbn-sets";

export type SettingsSection = "checklist" | "website" | "scan" | "style" | "links" | "images" | "cta" | "author" | "test-image" | "engine" | "danger";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Globe }[] = [
  { id: "checklist", label: "Checklist", icon: ClipboardCheck },
  { id: "website", label: "Website & Connect", icon: Globe },
  { id: "scan", label: "Article Style", icon: Palette },
  { id: "links", label: "Internal Link", icon: Link2 },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "cta", label: "CTA", icon: Megaphone },
  { id: "author", label: "Author Box", icon: UserRound },
  { id: "test-image", label: "Test Image", icon: Sparkles },
  { id: "engine", label: "Content Engine", icon: Cpu },
  { id: "danger", label: "Delete Client", icon: Trash2 },
];

export default function SettingsTab({
  client, setClient, onDeleted, userRole, section, onSectionChange, mode = "upload",
  checklistMissing = 0, onChecklistStatus,
}: {
  client: UploadClientDTO;
  setClient: (c: UploadClientDTO) => void;
  onDeleted: () => void;
  userRole: string;
  section?: SettingsSection;
  onSectionChange?: (s: SettingsSection) => void;
  /** "pbn" = หน้า PBN Backlinks: เว็บไซต์ = รายการเว็บ PBN ทั้งหมด, ไม่มีเมนูลบโปรเจกต์ */
  mode?: "upload" | "pbn";
  /** จำนวนข้อบังคับที่ยังไม่ครบ — แสดงเลขแดงที่เมนู Checklist */
  checklistMissing?: number;
  onChecklistStatus?: (s: UploadSetupChecklistStatus) => void;
}) {
  const isPbn = mode === "pbn";
  // Checklist เป็นของ Upload Article เท่านั้น — PBN ไม่มี
  const sections = isPbn
    ? SECTIONS.filter(s => s.id !== "danger" && s.id !== "checklist" && s.id !== "links").map(s => (s.id === "website" ? { ...s, label: "PBN Sites & Connect" } : s))
    : SECTIONS;
  const [internalSection, setInternalSection] = useState<SettingsSection>("website");
  const requested = section ?? internalSection;
  // โหมด PBN ไม่มีเมนูลบ/Checklist — ลิงก์เก่า ?section=danger ตกกลับไปหน้าเว็บ
  const requestedNorm: SettingsSection = requested === "style" ? "scan" : requested; // ลิงก์เก่า "style" = หน้าเดียวกับ scan
  // PBN ไม่มี Internal Link — ลิงก์เดียวในบทความคือ Backlink ไป URL ปลายทางที่ตั้งในแท็บ Keyword
  const active = isPbn && (requestedNorm === "danger" || requestedNorm === "checklist" || requestedNorm === "links") ? "website" : requestedNorm;

  function go(s: SettingsSection) {
    setInternalSection(s);
    onSectionChange?.(s);
  }

  // ธีม (สี/ฟอนต์/หน้าตา FAQ) ใช้ร่วมกันระหว่างแท็บย่อย "scan" และ "style" — อยู่ที่นี่ไม่ให้หายตอนสลับแท็บ
  const mainThemeDraft = useThemeDraft(client, setClient);

  // ── PBN เท่านั้น: สไตล์บทความตามเว็บ + set ข้อมูลโปรเจกต์ของ Content Engine (Upload Article ไม่โหลด/ไม่แสดง) ──
  const pbnSites = usePbnSites(isPbn);
  const pbnProfiles = usePbnProfiles(isPbn);
  const pbnStyles = usePbnStyles(isPbn);
  const [styleSiteId, setStyleSiteId] = useState<string | null>(null);
  const [ceSetId, setCeSetId] = useState<string>(PBN_MAIN_PROFILE);
  const styleSite = styleSiteId ? pbnSites.sites.find(s => s.id === styleSiteId) : undefined;
  const siteThemeDraft = usePbnSiteThemeDraft(
    client, isPbn && styleSite ? styleSite.id : null, styleSite?.name || "", pbnStyles.styles,
    st => pbnStyles.setStyles(prev => ({ ...prev, [st.siteId]: st })),
  );
  const themeDraft = isPbn && styleSite ? siteThemeDraft : mainThemeDraft;
  const ceSetValid = ceSetId === PBN_MAIN_PROFILE || pbnProfiles.profiles.some(p => p.id === ceSetId);
  const activeCeSet = isPbn && ceSetValid ? ceSetId : PBN_MAIN_PROFILE;

  // เพิ่ม/ลบเว็บหรือ set ที่เมนูเว็บไซต์แล้วสลับมา — โหลดรายการใหม่ให้ตัวเลือกตรงกับของจริง
  const { reload: reloadSites } = pbnSites;
  const { reload: reloadProfiles } = pbnProfiles;
  const { reload: reloadStyles } = pbnStyles;
  useEffect(() => {
    if (!isPbn) return;
    if (active === "scan") { void reloadSites(); void reloadStyles(); }
    if (active === "engine") void reloadProfiles();
  }, [isPbn, active, reloadSites, reloadStyles, reloadProfiles]);

  const stylePicker = isPbn ? (
    <PbnStylePicker sites={pbnSites.sites} styles={pbnStyles.styles} siteId={styleSite ? styleSite.id : null}
      onSelect={setStyleSiteId}
      onStyleChange={st => pbnStyles.setStyles(prev => ({ ...prev, [st.siteId]: st }))}
      onStyleDeleted={id => pbnStyles.setStyles(prev => { const n = { ...prev }; delete n[id]; return n; })} />
  ) : null;

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* มือถือ: แถบเลื่อนแนวนอน */}
      <div className="md:hidden -mx-1 px-1 overflow-x-auto">
        <div className="flex gap-1.5 pb-1 w-max">
          {sections.map(s => (
            <button key={s.id} onClick={() => go(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                active === s.id ? "bg-brand-navy text-white border-brand-navy" : "bg-white/70 text-gray-500 border-white/80 hover:bg-white"
              }`}>
              <s.icon size={13} /> {s.label}
              {s.id === "checklist" && checklistMissing > 0 && <MissingBadge n={checklistMissing} />}
            </button>
          ))}
        </div>
      </div>

      {/* จอใหญ่: เมนูแนวตั้งด้านซ้าย */}
      <div className="hidden md:block w-52 shrink-0">
        <div className="space-y-1 sticky top-[4.5rem] glass rounded-3xl p-2">
          {sections.map(s => (
            <button key={s.id} onClick={() => go(s.id)}
              className={`w-full flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium text-left transition-colors ${
                active === s.id ? "bg-brand-blue text-white shadow-sm" : "text-gray-500 hover:bg-white/80 hover:text-brand-navy"
              }`}>
              <s.icon size={15} /> <span className="flex-1">{s.label}</span>
              {s.id === "checklist" && checklistMissing > 0 && <MissingBadge n={checklistMissing} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {active === "checklist" && !isPbn && (
          <UploadSetupChecklist clientId={client.id} onNavigate={go} onStatus={onChecklistStatus} />
        )}
        {active === "website" && (isPbn
          ? <PbnSitesSection client={client} setClient={setClient} />
          : <ConnectTab client={client} setClient={setClient} />)}
        {active === "scan" && (
          <div className="space-y-4">
            {stylePicker}
            <ScanSection key={`scan:${styleSite?.id || "main"}`} client={client} setClient={setClient}
              applyScannedTheme={themeDraft.applyScannedTheme}
              defaultUrl={styleSite?.siteUrl || undefined} />
            <StyleSection key={`style:${styleSite?.id || "main"}`} themeDraft={themeDraft.themeDraft} setThemeDraft={themeDraft.setThemeDraft}
              setColor={themeDraft.setColor} savingTheme={themeDraft.savingTheme} saveTheme={themeDraft.saveTheme}
              showFaqEditor={themeDraft.showFaqEditor} setShowFaqEditor={themeDraft.setShowFaqEditor}
              client={isPbn ? undefined : client} dirty={themeDraft.dirty} />
          </div>
        )}
        {active === "links" && <InternalLinksSection clientId={client.id} hideArticles={isPbn} />}
        {active === "images" && (
          <ImagesSection client={client} setClient={setClient}
            openEngine={() => go("engine")} />
        )}
        {active === "cta" && <CtaSection client={client} setClient={setClient} />}
        {active === "author" && <AuthorSection client={client} setClient={setClient} />}
        {active === "test-image" && <TestImageSection client={client} />}
        {active === "engine" && (isPbn ? (
          <div className="space-y-4">
            <div className="bg-white/75 border border-white/80 rounded-2xl p-4 shadow-sm space-y-2">
              <p className="text-sm font-semibold text-brand-navy">Content Engine ของ set</p>
              <select value={activeCeSet} onChange={e => setCeSetId(e.target.value)}
                className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm bg-white">
                <option value={PBN_MAIN_PROFILE}>set หลัก{client.website ? ` — ${client.website}` : ""}</option>
                {pbnProfiles.profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.website ? ` — ${p.website}` : ""}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400">
                แต่ละ set มี Content Engine (Business Skill / Master Prompt / Layer) ของตัวเอง — ตอนเขียนบทความเลือก set แล้วใช้ Content Engine ของ set นั้น.
                เพิ่ม set ได้ที่เมนู “เว็บ PBN &amp; Connect”
              </p>
            </div>
            <UploadContentEngine key={activeCeSet} client={client} userRole={userRole} setId={activeCeSet} />
          </div>
        ) : <UploadContentEngine client={client} userRole={userRole} />)}
        {active === "danger" && !isPbn && <DangerSection client={client} onDeleted={onDeleted} />}
      </div>
    </div>
  );
}

function MissingBadge({ n }: { n: number }) {
  return (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center">
      {n}
    </span>
  );
}
