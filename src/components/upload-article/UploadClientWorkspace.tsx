"use client";

/**
 * Workspace ของลูกค้า Upload Article หนึ่งราย — แท็บหลัก 7 แท็บ (Keyword / เขียนบทความ / นำเข้า /
 * Generate / Review / Push / Publish) + ปุ่มเฟือง "Project Setting" เปิดแท็บ settings (ไม่อยู่ในแถบ pill)
 * โหลดรายละเอียด client ด้วย fetch (ไม่พึ่ง prisma type ฝั่ง server) ตาม spec — 404 แสดงว่าไม่พบลูกค้า
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Loader2, Network, Settings } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UploadArticleDTO, UploadClientDTO, UploadOwnerTag } from "@/lib/upload-article/types";
import type { OwnerControls } from "@/components/upload-article/ArticleOwnerSelect";
import type { SettingsSection } from "@/components/upload-article/settings/SettingsTab";
import { useUploadSetupChecklist } from "@/components/upload-article/settings/useUploadSetupChecklist";
import ClientAvatar from "@/components/upload-article/ClientAvatar";

// แต่ละแท็บโหลดโค้ดของตัวเองตอนถูกเปิดครั้งแรก (Radix แสดงเฉพาะแท็บที่เลือกอยู่แล้ว) — หน้าแรกไม่ต้องแบกโค้ดครบทุกแท็บ
// ระหว่างรอแสดงตัวหมุนแบบเดียวกับตอนโหลดข้อมูลลูกค้า
function TabLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
      <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
    </div>
  );
}
const KeywordTab = dynamic(() => import("@/components/upload-article/tabs/KeywordTab"), { loading: TabLoading });
const WriteTab = dynamic(() => import("@/components/upload-article/tabs/WriteTab"), { loading: TabLoading });
const ImportOutlineTab = dynamic(() => import("@/components/upload-article/tabs/ImportOutlineTab"), { loading: TabLoading });
const ImportTab = dynamic(() => import("@/components/upload-article/tabs/ImportTab"), { loading: TabLoading });
const GenerateTab = dynamic(() => import("@/components/upload-article/tabs/GenerateTab"), { loading: TabLoading });
const ReviewTab = dynamic(() => import("@/components/upload-article/tabs/ReviewTab"), { loading: TabLoading });
const PushTab = dynamic(() => import("@/components/upload-article/tabs/PushTab"), { loading: TabLoading });
const PublishTab = dynamic(() => import("@/components/upload-article/tabs/PublishTab"), { loading: TabLoading });
const IndexTab = dynamic(() => import("@/components/upload-article/tabs/IndexTab"), { loading: TabLoading });
const SettingsTab = dynamic(() => import("@/components/upload-article/settings/SettingsTab"), { loading: TabLoading });
const PbnReportTab = dynamic(() => import("@/components/upload-article/pbn/PbnReportTab"), { loading: TabLoading });
const PbnMonitorTab = dynamic(() => import("@/components/upload-article/pbn/PbnMonitorTab").then(m => m.PbnMonitorTab), { loading: TabLoading });
const UploadGscReportTab = dynamic(() => import("@/components/upload-article/report/UploadGscReportTab"), { loading: TabLoading });

export type TabId = "keyword" | "write" | "import" | "outline" | "generate" | "review" | "push" | "publish" | "index" | "report" | "monitor" | "settings";

// Report = GSC ของเว็บลูกค้า (upload ปกติ) หรือ GSC/GA4 แยกตามเว็บ PBN (mode="pbn") — คนละ component กัน
const TAB_ORDER: Exclude<TabId, "settings">[] = ["keyword", "write", "import", "outline", "generate", "review", "push", "publish", "index", "report"];
// Monitor = GSC ของเว็บ PBN (เฉพาะหน้า PBN Backlinks ต่อจาก Report)
const PBN_TAB_ORDER: Exclude<TabId, "settings">[] = [...TAB_ORDER, "monitor"];

const TAB_LABELS: Record<Exclude<TabId, "settings">, string> = {
  keyword: "Keyword",
  write: "Write Article",
  import: "Import Article",
  outline: "Import Outline",
  generate: "Generate",
  review: "Review",
  push: "Push",
  publish: "Publish",
  index: "Request Index",
  report: "Report",
  monitor: "Monitor",
};

const SETTINGS_SECTIONS: SettingsSection[] = ["checklist", "website", "scan", "style", "links", "images", "cta", "author", "test-image", "engine", "danger"];

function resolveInitialTab(t: string | undefined, order: Exclude<TabId, "settings">[]): TabId {
  if (t === "connect" || t === "settings") return "settings";
  if (t && (order as string[]).includes(t)) return t as TabId;
  return "import";
}

function resolveInitialSection(t?: string, s?: string): SettingsSection {
  if (t === "connect") return "website";
  if (s && (SETTINGS_SECTIONS as string[]).includes(s)) return s as SettingsSection;
  return "website";
}

export default function UploadClientWorkspace({
  clientId, initialTab, initialSection, userRole, mode = "upload",
}: {
  clientId: string;
  initialTab?: string;
  initialSection?: string;
  userRole: string;
  /** "pbn" = หน้า PBN Backlinks (โปรเจกต์เดียว, URL /pbn-backlinks, มีแท็บ Report, push เลือกเว็บ PBN) */
  mode?: "upload" | "pbn";
}) {
  const router = useRouter();
  const isPbn = mode === "pbn";
  const tabOrder = isPbn ? PBN_TAB_ORDER : TAB_ORDER;
  const basePath = isPbn ? "/pbn-backlinks" : `/upload-article/${clientId}`;
  const [client, setClient] = useState<UploadClientDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundFlag, setNotFoundFlag] = useState(false);

  const [articles, setArticles] = useState<UploadArticleDTO[]>([]);
  const [articleDetails, setArticleDetails] = useState<Record<string, UploadArticleDTO>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>(resolveInitialTab(initialTab, tabOrder));
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(resolveInitialSection(initialTab, initialSection));

  // badge แจ้งเตือนบนปุ่ม Project Setting — ตรวจใหม่ทุกครั้งที่สลับแท็บ/เมนูตั้งค่า หรือข้อมูลลูกค้าเปลี่ยน (Upload เท่านั้น)
  const checklist = useUploadSetupChecklist(clientId, !isPbn, `${tab}|${settingsSection}|${client?.updatedAt ?? ""}`);
  const checklistMissing = checklist.status?.missingRequired ?? 0;

  // preselect keyword ids ที่ยกมาจากแท็บ Keyword ตอนกด "ไปเขียนบทความ"
  const [writePreselect, setWritePreselect] = useState<string[]>([]);

  const refreshClient = useCallback(async () => {
    const r = await fetch(`/api/upload-article/clients/${clientId}`);
    if (r.status === 404) { setNotFoundFlag(true); return; }
    if (r.ok) setClient(await r.json());
  }, [clientId]);

  const refreshArticles = useCallback(async () => {
    const r = await fetch(`/api/upload-article/clients/${clientId}/articles`);
    if (r.ok) {
      const list: UploadArticleDTO[] = await r.json();
      setArticles(list);
    }
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // สอง request นี้ไม่ขึ้นต่อกัน — ยิงพร้อมกัน แล้วค่อยปิดสถานะโหลดเมื่อครบทั้งคู่ (เหมือนเดิม)
      await Promise.all([refreshClient(), refreshArticles()]);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [refreshClient, refreshArticles]);

  const loadArticleDetail = useCallback(async (id: string, force = false): Promise<UploadArticleDTO | null> => {
    if (!force && articleDetails[id]) return articleDetails[id];
    const r = await fetch(`/api/upload-article/articles/${id}`);
    if (!r.ok) return null;
    const detail: UploadArticleDTO = await r.json();
    setArticleDetails(prev => ({ ...prev, [id]: detail }));
    setArticles(prev => prev.map(a => a.id === id ? { ...a, ...detail } : a));
    return detail;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleDetails]);

  /** อัปเดต state ทั้ง list + detail cache หลัง PATCH/generate/push สำเร็จ */
  const applyArticleUpdate = useCallback((updated: UploadArticleDTO) => {
    setArticleDetails(prev => ({ ...prev, [updated.id]: { ...prev[updated.id], ...updated } }));
    setArticles(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
  }, []);

  const removeArticle = useCallback((id: string) => {
    setArticles(prev => prev.filter(a => a.id !== id));
    setArticleDetails(prev => { const n = { ...prev }; delete n[id]; return n; });
    setSelectedId(prev => prev === id ? null : prev);
  }, []);

  // ผู้ดูแลบทความ (pushPrefs.ownerTags/articleOwners) — เก็บใน state ของ client ที่นี่ที่เดียว ให้ Report/นำเข้า/Publish ตรงกัน
  const setArticleOwner = useCallback((articleId: string, tagId: string | null) => {
    setClient(prev => {
      if (!prev) return prev;
      const articleOwners = { ...(prev.pushPrefs.articleOwners ?? {}) };
      if (tagId) articleOwners[articleId] = tagId;
      else delete articleOwners[articleId];
      return { ...prev, pushPrefs: { ...prev.pushPrefs, articleOwners } };
    });
  }, []);

  const applyOwnerTags = useCallback((ownerTags: UploadOwnerTag[], articleOwners: Record<string, string>) => {
    setClient(prev => prev ? { ...prev, pushPrefs: { ...prev.pushPrefs, ownerTags, articleOwners } } : prev);
  }, []);

  // บทความที่กำลังเขียนอยู่ (WRITING) ยังไม่พร้อมให้แท็บอื่นเห็น — กันคนกดใช้งานบทความที่ยังไม่เสร็จ
  const visibleArticles = useMemo(() => articles.filter(a => a.status !== "WRITING"), [articles]);
  // ชุดที่ใช้หาแถวซ้ำ (ชิป "ซ้ำ" + รายการในหน้าต่างยืนยันลบ) — PBN ส่งว่าง: variant ชื่อซ้ำกันโดยตั้งใจ
  const dupPool = useMemo(() => (isPbn ? [] : articles), [isPbn, articles]);

  if (notFoundFlag) {
    return (
      <div className="p-10 text-center">
        <p className="text-gray-500 text-sm">ไม่พบลูกค้ารายนี้ — อาจถูกลบไปแล้ว</p>
        <Link href="/upload-article" className="text-brand-blue text-sm underline mt-2 inline-block">กลับไปหน้ารวมลูกค้า</Link>
      </div>
    );
  }

  if (loading || !client) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
        <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
      </div>
    );
  }

  const host = client.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const ownerTags = client.pushPrefs.ownerTags ?? [];
  const articleOwners = client.pushPrefs.articleOwners ?? {};
  // โหมด PBN ไม่มีผู้ดูแล (Report ของ PBN เป็นคนละตัว) — ไม่ส่ง controls = ไม่แสดง dropdown
  const ownerControls: OwnerControls | undefined = isPbn
    ? undefined
    : { ownerTags, articleOwners, onOwnerChange: setArticleOwner, goToReport: () => goTab("report") };
  const selected = selectedId ? articles.find(a => a.id === selectedId) ?? null : null;

  const goTab = (t: TabId, id?: string, section?: SettingsSection) => {
    if (id) setSelectedId(id);
    setTab(t);
    if (t === "settings") {
      const sec = section ?? settingsSection;
      setSettingsSection(sec);
      router.replace(`${basePath}?tab=settings&section=${sec}`, { scroll: false });
    } else {
      router.replace(`${basePath}?tab=${t}`, { scroll: false });
    }
  };

  const openSettings = (section: SettingsSection) => goTab("settings", undefined, section);

  const onSectionChange = (s: SettingsSection) => {
    setSettingsSection(s);
    router.replace(`${basePath}?tab=settings&section=${s}`, { scroll: false });
  };

  return (
    <div className="w-full space-y-5">
      <div className="page-header !mb-0">
        {!isPbn && (
          <Link href="/upload-article" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/70 text-gray-500 hover:text-brand-navy hover:bg-white">
            <ArrowLeft size={16} />
          </Link>
        )}
        {/* โลโก้ลูกค้า — กดเพื่ออัปโหลด/เปลี่ยน (PBN ไม่ใช่ลูกค้ารายเดียว จึงไม่แสดง) */}
        {!isPbn && (
          <ClientAvatar
            clientId={client.id}
            name={client.name}
            theme={client.theme.theme}
            logo={client.logo ?? null}
            size={48}
            onChange={logo => setClient(prev => prev ? { ...prev, logo } : prev)}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">{isPbn ? "PBN Backlinks" : "Upload Article"}</p>
          <h1 className="page-title truncate">{client.name}</h1>
          <p className="page-subtitle flex items-center gap-1.5">
            {isPbn
              ? <><Network size={13} /> เขียนบทความหลายเวอร์ชันต่อ keyword แล้ว push ไปเว็บ PBN คนละเว็บ</>
              : <><Globe size={13} /> {host || "ยังไม่ตั้งเว็บไซต์"}</>}
          </p>
        </div>
        <button
          // ยังตั้งค่าไม่ครบ = เปิดหน้า Checklist ให้เห็นว่าขาดอะไร
          onClick={() => goTab("settings", undefined, checklistMissing > 0 && tab !== "settings" ? "checklist" : undefined)}
          title={checklistMissing > 0 ? `Project Setting — ยังตั้งค่าไม่ครบ ${checklistMissing} ข้อ` : "Project Setting"}
          className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
            tab === "settings" ? "bg-brand-blue/10 text-brand-blue border-brand-blue/20"
              : checklistMissing > 0 ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
              : "bg-white/80 text-gray-600 border-gray-200 hover:bg-white hover:text-brand-navy"
          }`}
        >
          <Settings size={13} /> Project Setting
          {checklistMissing > 0 && (
            <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow">
              {checklistMissing}
            </span>
          )}
        </button>
      </div>

      <Tabs value={tab === "settings" ? "" : tab} onValueChange={v => goTab(v as TabId)}>
        <TabsList className="utabs !inline-flex !h-auto !w-full !justify-start !rounded-none !border-0 !border-b !border-gray-200/80 !bg-transparent !p-0">
          {tabOrder.map(t => (
            <TabsTrigger key={t} value={t} className="utab !rounded-none !bg-transparent !px-0 !pb-3 !pt-1 data-[state=active]:!bg-transparent data-[state=active]:!shadow-none data-[state=active]:!text-brand-navy">{TAB_LABELS[t]}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="keyword" className="mt-5">
          <KeywordTab
            client={client}
            onWrite={ids => { setWritePreselect(ids); goTab("write"); }}
            goToReview={id => goTab("review", id)}
            setClient={setClient}
            isPbn={isPbn}
          />
        </TabsContent>

        <TabsContent value="write" className="mt-5">
          <WriteTab
            client={client}
            articles={articles}
            preselectIds={writePreselect}
            clearPreselect={() => setWritePreselect([])}
            refreshArticles={refreshArticles}
            applyArticleUpdate={applyArticleUpdate}
            goToReview={id => goTab("review", id)}
            onOpenSettings={openSettings}
            variantsEnabled={isPbn}
            setClient={setClient}
          />
        </TabsContent>

        <TabsContent value="import" className="mt-5">
          <ImportTab
            client={client}
            articles={visibleArticles}
            allArticles={dupPool}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            refreshArticles={refreshArticles}
            refreshClient={refreshClient}
            removeArticle={removeArticle}
            owners={ownerControls}
            pbn={isPbn}
          />
        </TabsContent>

        <TabsContent value="outline" className="mt-5">
          <ImportOutlineTab
            clientId={clientId}
            writeProps={{
              client,
              articles,
              preselectIds: writePreselect,
              clearPreselect: () => setWritePreselect([]),
              refreshArticles,
              applyArticleUpdate,
              goToReview: id => goTab("review", id),
              onOpenSettings: openSettings,
              variantsEnabled: isPbn,
              setClient,
            }}
            pbn={isPbn}
          />
        </TabsContent>

        <TabsContent value="generate" className="mt-5">
          <GenerateTab
            pbn={isPbn}
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            selected={selected}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            goToReview={id => goTab("review", id)}
            onOpenSettings={openSettings}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-5">
          <ReviewTab
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            allArticles={dupPool}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            removeArticle={removeArticle}
            refreshClient={refreshClient}
            pbn={isPbn}
          />
        </TabsContent>

        <TabsContent value="push" className="mt-5">
          <PushTab
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            allArticles={dupPool}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            onOpenSettings={openSettings}
            pbn={isPbn}
            removeArticle={removeArticle}
            refreshClient={refreshClient}
          />
        </TabsContent>

        <TabsContent value="publish" className="mt-5">
          <PublishTab
            articles={visibleArticles}
            goToPush={id => goTab("push", id)}
            owners={ownerControls}
          />
        </TabsContent>

        <TabsContent value="index" className="mt-5">
          <IndexTab
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            loadArticleDetail={loadArticleDetail}
            goToReport={() => goTab("report")}
            onOpenPbnSites={() => openSettings("website")}
            pbn={isPbn}
          />
        </TabsContent>

        <TabsContent value="report" className="mt-5">
          {isPbn ? (
            <PbnReportTab onOpenSettings={() => openSettings("website")} />
          ) : (
            <UploadGscReportTab
              clientId={clientId}
              ownerTags={ownerTags}
              articleOwners={articleOwners}
              onOwnerTagsChange={applyOwnerTags}
              onOwnerChange={setArticleOwner}
            />
          )}
        </TabsContent>

        {isPbn && (
          <TabsContent value="monitor" className="mt-5">
            <PbnMonitorTab onOpenSettings={() => openSettings("website")} />
          </TabsContent>
        )}
      </Tabs>

      {tab === "settings" && (
        <SettingsTab
          client={client}
          setClient={setClient}
          onDeleted={() => router.push("/upload-article")}
          userRole={userRole}
          section={settingsSection}
          onSectionChange={onSectionChange}
          mode={mode}
          checklistMissing={checklistMissing}
          onChecklistStatus={checklist.setStatus}
        />
      )}
    </div>
  );
}
