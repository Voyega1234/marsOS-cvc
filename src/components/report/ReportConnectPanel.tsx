"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Link2, RefreshCw, Save, Unlink } from "lucide-react";

// แผงเชื่อมต่อข้อมูลของแท็บ Report ต่อ client:
// 1) เชื่อม Google (เมล์กลาง apps@convertcake.com) — ระดับ org ครั้งเดียวใช้ทุก client
// 2) ผูก GSC property + GA4 property ของ "โปรเจกต์นี้" — เลือกจากรายการจริงของบัญชีที่เชื่อม
interface Props {
  projectId: string;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  isAdmin: boolean;
  /** path สำหรับเด้งกลับหลัง OAuth เสร็จ (แท็บ Report ของโปรเจกต์นี้) */
  returnTo: string;
  onSaved?: () => void;
}

export function ReportConnectPanel({ projectId, gscSiteUrl, ga4PropertyId, isAdmin, returnTo, onSaved }: Props) {
  const [conn, setConn] = useState<{ connected: boolean; email: string | null; configured: boolean; serviceEmail?: string | null; serviceReady?: boolean } | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [props, setProps] = useState<{ id: string; name: string }[]>([]);
  const [selSite, setSelSite] = useState(gscSiteUrl ?? "");
  const [selProp, setSelProp] = useState(ga4PropertyId ?? "");
  const [loadingLists, setLoadingLists] = useState(false);
  const [saving, setSaving] = useState(false);
  // ฟอร์มตั้งค่า Google OAuth Client ผ่าน UI (โชว์เมื่อยังไม่ configured)
  const [showSetup, setShowSetup] = useState(false);
  const [cId, setCId] = useState("");
  const [cSecret, setCSecret] = useState("");
  const [savingClient, setSavingClient] = useState(false);

  async function saveOauthClient() {
    setSavingClient(true);
    try {
      const r = await fetch("/api/google-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cId, clientSecret: cSecret }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      toast.success("บันทึก OAuth Client แล้ว — กดปุ่มเชื่อมต่อ Google ได้เลย");
      setShowSetup(false); setCId(""); setCSecret("");
      loadStatus();
    } catch (e) { toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); }
    finally { setSavingClient(false); }
  }

  async function loadStatus() {
    try {
      const r = await fetch("/api/google-connect");
      if (r.ok) setConn(await r.json());
    } catch { /* ignore */ }
  }

  async function loadLists() {
    setLoadingLists(true);
    try {
      const [siteRes, propRes] = await Promise.all([
        fetch("/api/report/gsc-sites"),
        fetch("/api/report/ga4-properties"),
      ]);
      if (siteRes.ok) {
        const d = await siteRes.json();
        const list: string[] = (d.sites ?? d ?? []).map((s: { siteUrl?: string } | string) =>
          typeof s === "string" ? s : s.siteUrl ?? ""
        ).filter(Boolean);
        setSites(list);
      }
      if (propRes.ok) {
        const d = await propRes.json();
        const list = (d.properties ?? d ?? []).map((p: { propertyId?: string; property?: string; displayName?: string; name?: string }) => ({
          id: String(p.propertyId ?? p.property ?? "").replace("properties/", ""),
          name: p.displayName ?? p.name ?? String(p.propertyId ?? ""),
        })).filter((p: { id: string }) => p.id);
        setProps(list);
      }
    } catch { /* แสดง state ว่างแทน */ }
    finally { setLoadingLists(false); }
  }

  useEffect(() => {
    loadStatus();
    const p = new URLSearchParams(window.location.search);
    if (p.get("gconn") === "ok") toast.success(`เชื่อมต่อ Google สำเร็จ: ${p.get("email") ?? ""}`);
    if (p.get("gconn") === "error") toast.error("เชื่อมต่อ Google ไม่สำเร็จ ลองใหม่อีกครั้ง");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dataReady = Boolean(conn?.connected || conn?.serviceReady);

  useEffect(() => {
    if (dataReady) loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gscSiteUrl: selSite || null, ga4PropertyId: selProp || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("บันทึกการผูก property แล้ว — กำลังโหลดข้อมูลใหม่");
      onSaved?.();
    } catch { toast.error("บันทึกไม่สำเร็จ"); }
    finally { setSaving(false); }
  }

  async function disconnect() {
    if (!confirm("ตัดการเชื่อมต่อ Google ระดับองค์กร? ทุก client จะดึงข้อมูลไม่ได้จนกว่าจะเชื่อมใหม่")) return;
    const r = await fetch("/api/google-connect", { method: "DELETE" });
    if (r.ok) { toast.success("ตัดการเชื่อมต่อแล้ว"); loadStatus(); }
  }

  if (!conn) return null;
  // ข้อมูลการเชื่อมต่อ/Service Email เป็นของทีมหลังบ้านเท่านั้น — client login ห้ามเห็น
  if (!isAdmin) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
      {/* แถว 1: การเชื่อมต่อ Google ระดับ org */}
      {!conn.connected && conn.serviceReady && conn.serviceEmail ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>ใช้ Service Email: <b>{conn.serviceEmail}</b> — เว็บไหนอยากให้ดึงข้อมูล เอาเมล์นี้ไปเพิ่มใน GSC + GA4 ของเว็บนั้น</span>
          <button onClick={() => { navigator.clipboard?.writeText(conn.serviceEmail ?? ''); toast.success('คัดลอกเมล์แล้ว'); }}
            className="ml-auto rounded-lg border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
            คัดลอกเมล์
          </button>
        </div>
      ) : conn.connected ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="size-3.5 shrink-0" />
          <span>Google เชื่อมแล้ว: <b>{conn.email}</b></span>
          {isAdmin && (
            <button onClick={disconnect} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-red-600 transition-colors">
              <Unlink className="size-3" /> ตัดการเชื่อมต่อ
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
            <span>
              ยังไม่ได้เชื่อม Google —
              {conn.configured
                ? " เชื่อมด้วยเมล์ที่มี access GSC/GA4 (แนะนำ apps@convertcake.com)"
                : " ต้องตั้งค่า OAuth Client ของแอปก่อน (ครั้งเดียวทั้งระบบ)"}
            </span>
            {isAdmin && conn.configured && (
              <a href={`/api/google-connect/start?returnTo=${encodeURIComponent(returnTo)}`}
                className="ml-auto flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                <Link2 className="size-3" /> เชื่อมต่อ Google
              </a>
            )}
            {isAdmin && !conn.configured && (
              <button onClick={() => setShowSetup(v => !v)}
                className="ml-auto flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                ⚙️ ตั้งค่า Google OAuth (ครั้งเดียว)
              </button>
            )}
          </div>

          {conn.serviceEmail && !conn.serviceReady && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-2.5 text-[11px] leading-5 text-gray-600">
              พบบัญชี <b>{conn.serviceEmail}</b> ในเครื่องแล้ว แต่ token ยังไม่มีสิทธิ์ GSC/GA4 —
              รันคำสั่งนี้ใน Terminal <b>ครั้งเดียว</b> (จะเปิด browser ให้ login) แล้วรีเฟรชหน้านี้:
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-white border border-gray-200 px-2 py-1 text-[10px] select-all">
                  gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
                </code>
                <button onClick={() => { navigator.clipboard?.writeText('gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform'); toast.success('คัดลอกคำสั่งแล้ว'); }}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50">คัดลอก</button>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">login ด้วยเมล์ที่มีสิทธิ์ GSC/GA4 ของลูกค้า (เช่น apps@convertcake.com) — ไม่ต้องตั้ง OAuth Client เลย</p>
            </div>
          )}

          {isAdmin && !conn.configured && showSetup && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
              <p className="text-[11px] leading-5 text-gray-600">
                สร้าง OAuth Client ที่{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-brand-blue underline">
                  Google Cloud Console → Credentials
                </a>{" "}
                → Create OAuth client ID → ชนิด <b>Web application</b> แล้วใส่ Redirect URI:{" "}
                <code className="rounded bg-white px-1 py-0.5 text-[10px] border border-gray-200 select-all">
                  {typeof window !== "undefined" ? `${window.location.origin}/api/google-connect/callback` : "/api/google-connect/callback"}
                </code>
                {" "}จากนั้นเอา 2 ค่ามากรอกตรงนี้ — ระบบเก็บให้เอง ไม่ต้องแก้ไฟล์ env
              </p>
              <input value={cId} onChange={(e) => setCId(e.target.value)}
                placeholder="Client ID — ลงท้าย .apps.googleusercontent.com"
                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-mono" />
              <input value={cSecret} onChange={(e) => setCSecret(e.target.value)} type="password"
                placeholder="Client Secret"
                className="h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs font-mono" />
              <button onClick={saveOauthClient} disabled={savingClient || !cId.trim() || !cSecret.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-blue px-3 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-50">
                <Save className="size-3" /> {savingClient ? "กำลังบันทึก..." : "บันทึก OAuth Client"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* แถว 2: ผูก property ของโปรเจกต์นี้ (เฉพาะ admin + เชื่อม Google แล้ว) */}
      {isAdmin && dataReady && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
          <select value={selSite} onChange={(e) => setSelSite(e.target.value)}
            className="h-8 min-w-[220px] flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs">
            <option value="">— เลือก GSC property ของ client นี้ —</option>
            {gscSiteUrl && !sites.includes(gscSiteUrl) && <option value={gscSiteUrl}>{gscSiteUrl} (ค่าปัจจุบัน)</option>}
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={selProp} onChange={(e) => setSelProp(e.target.value)}
            className="h-8 min-w-[220px] flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs">
            <option value="">— เลือก GA4 property —</option>
            {ga4PropertyId && !props.some((p) => p.id === ga4PropertyId) && (
              <option value={ga4PropertyId}>{ga4PropertyId} (ค่าปัจจุบัน)</option>
            )}
            {props.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
          <button onClick={loadLists} disabled={loadingLists} title="โหลดรายการใหม่"
            className="flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs text-gray-500 hover:bg-gray-50">
            <RefreshCw className={`size-3 ${loadingLists ? "animate-spin" : ""}`} />
          </button>
          <button onClick={save} disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-blue px-3 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-50">
            <Save className="size-3" /> {saving ? "กำลังบันทึก..." : "บันทึกการผูก"}
          </button>
        </div>
      )}
    </div>
  );
}
