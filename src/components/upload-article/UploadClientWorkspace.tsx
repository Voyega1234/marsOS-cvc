"use client";

/**
 * Workspace ของลูกค้า Upload Article หนึ่งราย — 6 แท็บ: นำเข้า / Generate / Review / Push / Publish / Connect Website
 * โหลดรายละเอียด client ด้วย fetch (ไม่พึ่ง prisma type ฝั่ง server) ตาม spec — 404 แสดงว่าไม่พบลูกค้า
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Globe, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UploadArticleDTO, UploadClientDTO } from "@/lib/upload-article/types";
import ImportTab from "@/components/upload-article/tabs/ImportTab";
import GenerateTab from "@/components/upload-article/tabs/GenerateTab";
import ReviewTab from "@/components/upload-article/tabs/ReviewTab";
import PushTab from "@/components/upload-article/tabs/PushTab";
import PublishTab from "@/components/upload-article/tabs/PublishTab";
import ConnectTab from "@/components/upload-article/tabs/ConnectTab";

export type TabId = "import" | "generate" | "review" | "push" | "publish" | "connect";

const TAB_LABELS: Record<TabId, string> = {
  import: "นำเข้าบทความ",
  generate: "Generate",
  review: "Review",
  push: "Push",
  publish: "Publish",
  connect: "Connect Website",
};

export default function UploadClientWorkspace({ clientId, initialTab }: { clientId: string; initialTab?: string }) {
  const router = useRouter();
  const [client, setClient] = useState<UploadClientDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundFlag, setNotFoundFlag] = useState(false);

  const [articles, setArticles] = useState<UploadArticleDTO[]>([]);
  const [articleDetails, setArticleDetails] = useState<Record<string, UploadArticleDTO>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const validTab = (initialTab && (Object.keys(TAB_LABELS) as TabId[]).includes(initialTab as TabId))
    ? (initialTab as TabId) : "import";
  const [tab, setTab] = useState<TabId>(validTab);

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

  const goTab = (t: TabId, id?: string) => {
    if (id) setSelectedId(id);
    setTab(t);
    router.replace(`/upload-article/${clientId}?tab=${t}`, { scroll: false });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/upload-article" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-brand-navy truncate">{client.name}</h1>
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <Globe size={11} /> {host || "ยังไม่ตั้งเว็บไซต์"}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => goTab(v as TabId)}>
        <TabsList className="flex-wrap h-auto">
          {(Object.keys(TAB_LABELS) as TabId[]).map(t => (
            <TabsTrigger key={t} value={t}>{TAB_LABELS[t]}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="import">
          <ImportTab
            client={client}
            articles={articles}
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
            articles={articles}
            selected={selected}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            goToReview={id => goTab("review", id)}
          />
        </TabsContent>

        <TabsContent value="review">
          <ReviewTab
            client={client}
            articles={articles}
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
            articles={articles}
            loadArticleDetail={loadArticleDetail}
            articleDetails={articleDetails}
            applyArticleUpdate={applyArticleUpdate}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            goToConnect={() => goTab("connect")}
          />
        </TabsContent>

        <TabsContent value="publish">
          <PublishTab
            articles={articles}
            goToPush={id => goTab("push", id)}
          />
        </TabsContent>

        <TabsContent value="connect">
          <ConnectTab
            client={client}
            setClient={setClient}
            onDeleted={() => router.push("/upload-article")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
