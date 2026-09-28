"use client";

/**
 * Workspace ของลูกค้า Upload Article หนึ่งราย — แท็บหลัก 7 แท็บ (Keyword / เขียนบทความ / นำเข้า /
 * Generate / Review / Push / Publish) + ปุ่มเฟือง "Project Setting" เปิดแท็บ settings (ไม่อยู่ในแถบ pill)
 * โหลดรายละเอียด client ด้วย fetch (ไม่พึ่ง prisma type ฝั่ง server) ตาม spec — 404 แสดงว่าไม่พบลูกค้า
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Loader2, Settings } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import KeywordTab from "@/components/upload-article/tabs/KeywordTab";
import WriteTab from "@/components/upload-article/tabs/WriteTab";
import ImportTab from "@/components/upload-article/tabs/ImportTab";
import GenerateTab from "@/components/upload-article/tabs/GenerateTab";
import ReviewTab from "@/components/upload-article/tabs/ReviewTab";
import PushTab from "@/components/upload-article/tabs/PushTab";
import PublishTab from "@/components/upload-article/tabs/PublishTab";
import SettingsTab, { type SettingsSection } from "@/components/upload-article/settings/SettingsTab";

export type TabId = "keyword" | "write" | "import" | "generate" | "review" | "push" | "publish" | "settings";

const TAB_ORDER: Exclude<TabId, "settings">[] = ["keyword", "write", "import", "generate", "review", "push", "publish"];

const TAB_LABELS: Record<Exclude<TabId, "settings">, string> = {
  keyword: "Keyword",
  write: "เขียนบทความ",
  import: "นำเข้าบทความ",
  generate: "Generate",
  review: "Review",
  push: "Push",
  publish: "Publish",
};

const SETTINGS_SECTIONS: SettingsSection[] = ["website", "scan", "style", "links", "images", "engine", "danger"];

function resolveInitialTab(t?: string): TabId {
  if (t === "connect" || t === "settings") return "settings";
  if (t && (TAB_ORDER as string[]).includes(t)) return t as TabId;
  return "import";
}

function resolveInitialSection(t?: string, s?: string): SettingsSection {
  if (t === "connect") return "website";
  if (s && (SETTINGS_SECTIONS as string[]).includes(s)) return s as SettingsSection;
  return "website";
}

export default function UploadClientWorkspace({
  clientId, initialTab, initialSection, userRole,
}: {
  clientId: string;
  initialTab?: string;
  initialSection?: string;
  userRole: string;
}) {
  const router = useRouter();
  const [client, setClient] = useState<UploadClientDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundFlag, setNotFoundFlag] = useState(false);

  const [articles, setArticles] = useState<UploadArticleDTO[]>([]);
  const [articleDetails, setArticleDetails] = useState<Record<string, UploadArticleDTO>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>(resolveInitialTab(initialTab));
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(resolveInitialSection(initialTab, initialSection));

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
      await refreshClient();
      await refreshArticles();
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

  // บทความที่กำลังเขียนอยู่ (WRITING) ยังไม่พร้อมให้แท็บอื่นเห็น — กันคนกดใช้งานบทความที่ยังไม่เสร็จ
  const visibleArticles = useMemo(() => articles.filter(a => a.status !== "WRITING"), [articles]);

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
  const selected = selectedId ? articles.find(a => a.id === selectedId) ?? null : null;

  const goTab = (t: TabId, id?: string, section?: SettingsSection) => {
    if (id) setSelectedId(id);
    setTab(t);
    if (t === "settings") {
      const sec = section ?? settingsSection;
      setSettingsSection(sec);
      router.replace(`/upload-article/${clientId}?tab=settings&section=${sec}`, { scroll: false });
    } else {
      router.replace(`/upload-article/${clientId}?tab=${t}`, { scroll: false });
    }
  };

  const openSettings = (section: SettingsSection) => goTab("settings", undefined, section);

  const onSectionChange = (s: SettingsSection) => {
    setSettingsSection(s);
    router.replace(`/upload-article/${clientId}?tab=settings&section=${s}`, { scroll: false });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/upload-article" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-brand-navy truncate">{client.name}</h1>
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <Globe size={11} /> {host || "ยังไม่ตั้งเว็บไซต์"}
          </p>
        </div>
        <button
          onClick={() => goTab("settings")}
          title="Project Setting"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            tab === "settings" ? "bg-brand-mist text-brand-blue border-brand-soft/60" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
          }`}
        >
          <Settings size={13} /> Project Setting
        </button>
      </div>

      <Tabs value={tab === "settings" ? "" : tab} onValueChange={v => goTab(v as TabId)}>
        <TabsList className="flex-wrap h-auto">
          {TAB_ORDER.map(t => (
            <TabsTrigger key={t} value={t}>{TAB_LABELS[t]}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="keyword">
          <KeywordTab
            client={client}
            onWrite={ids => { setWritePreselect(ids); goTab("write"); }}
            goToReview={id => goTab("review", id)}
          />
        </TabsContent>

        <TabsContent value="write">
          <WriteTab
            client={client}
            articles={articles}
            preselectIds={writePreselect}
            clearPreselect={() => setWritePreselect([])}
            refreshArticles={refreshArticles}
            applyArticleUpdate={applyArticleUpdate}
            goToReview={id => goTab("review", id)}
            onOpenSettings={openSettings}
          />
        </TabsContent>

        <TabsContent value="import">
          <ImportTab
            client={client}
            articles={visibleArticles}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            refreshArticles={refreshArticles}
            refreshClient={refreshClient}
            removeArticle={removeArticle}
          />
        </TabsContent>

        <TabsContent value="generate">
          <GenerateTab
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

        <TabsContent value="review">
          <ReviewTab
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
          />
        </TabsContent>

        <TabsContent value="push">
          <PushTab
            client={client}
            setClient={setClient}
            articles={visibleArticles}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            onOpenSettings={openSettings}
          />
        </TabsContent>

        <TabsContent value="publish">
          <PublishTab
            articles={visibleArticles}
            goToPush={id => goTab("push", id)}
          />
        </TabsContent>
      </Tabs>

      {tab === "settings" && (
        <SettingsTab
          client={client}
          setClient={setClient}
          onDeleted={() => router.push("/upload-article")}
          userRole={userRole}
          section={settingsSection}
          onSectionChange={onSectionChange}
        />
      )}
    </div>
  );
}
