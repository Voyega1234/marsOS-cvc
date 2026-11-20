import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ds";
import { prisma } from "@/lib/prisma";
import { buildDirectUrl, buildFacebookPostUrl, getTrackingBaseUrl, allChannelTemplates } from "@/lib/line-tracking/services/trackingService";
import { listShortLinks, shortUrl } from "@/lib/line-tracking/services/shortLinkService";
import { createTrackingLinkAction, deleteTrackingLinkAction, createShortLinkAction, deleteShortLinkAction } from "@/lib/line-tracking/actions";
import { SectionCard, StatusBadge, EmptyRow } from "@/components/line-tracking/ui";
import { CopyButton } from "@/components/line-tracking/CopyButton";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

export default async function TrackingLinksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  // project (with its tracking links) + short links run concurrently.
  const [project, shortLinks] = await Promise.all([
    prisma.ltProject.findUnique({
      where: { id: projectId },
      include: { trackingLinks: { orderBy: { createdAt: "desc" } } },
    }),
    listShortLinks(projectId),
  ]);
  if (!project) notFound();

  const templates = allChannelTemplates(project.slug);

  return (
    <div className="space-y-6">
      <PageHeader title={<>Tracking Links · {project.name}</>} subtitle={<>
          Base URL: <code className="text-slate-600">{getTrackingBaseUrl()}/t/{project.slug}</code>
        </>} />

      <SectionCard title="🔗 ลิงก์ Add LINE ตรง (กดแล้วเข้า LINE เลย — สำหรับโพสต์ FB / bio / ไม่มีเว็บ)">
        <p className="mb-3 text-sm text-slate-500">
          ลิงก์แบบ <code>/go/</code> จะ <b>บันทึก click + ช่องทางก่อน</b> แล้วพาเข้า LINE ทันที (ไม่มีหน้าคั่น) —
          เอาไปวางในโพสต์ Facebook, bio, IG, หรือที่ไหนก็ได้ที่ไม่มีเว็บไซต์
        </p>
        <div className="space-y-2">
          <div className="rounded-lg border border-line-500/30 bg-[#06C755]/5 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[#06C755] text-white">โพสต์ Facebook (organic)</span>
              <CopyButton text={buildFacebookPostUrl(project.slug)} label="Copy" />
            </div>
            <code className="block break-all text-xs text-slate-600">{buildFacebookPostUrl(project.slug)}</code>
          </div>
          {(["GOOGLE", "META", "TIKTOK"] as const).map((p) => {
            const url = buildDirectUrl(p, project.slug);
            return (
              <div key={p} className="flex items-center gap-2 rounded-lg border border-slate-100 p-3">
                <StatusBadge status="CONNECTED" label={`${p} · direct`} />
                <code className="flex-1 truncate text-xs text-slate-500">{url}</code>
                <CopyButton text={url} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          💡 ต่างกับด้านล่าง: ลิงก์ <code>/t/</code> จะโชว์หน้า landing (มีปุ่ม/แบรนด์) ก่อนเข้า LINE — เลือกใช้ตามต้องการ
        </p>
      </SectionCard>

      <SectionCard title="🌐 ฝัง Tracking บนเว็บไซต์ (Embed) — สำหรับเว็บที่มีเนื้อหา">
        <p className="mb-3 text-sm text-slate-500">
          วางสคริปต์นี้บนเว็บไซต์ของลูกค้า ({project.websiteUrl ?? "เว็บไซต์ลูกค้า"}) — โฆษณายิงเข้าเว็บจริงตรง ๆ
          สคริปต์จะเก็บ UTM / gclid / fbclid / ttclid / GA client id ให้อัตโนมัติ
        </p>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-800 text-white">1. วางในส่วน &lt;head&gt; หรือก่อน &lt;/body&gt;</span>
              <CopyButton
                text={`<script src="${getTrackingBaseUrl()}/embed.js?project=${project.slug}"></script>`}
                label="Copy script"
              />
            </div>
            <code className="block break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-100 dark:text-slate-800">
              {`<script src="${getTrackingBaseUrl()}/embed.js?project=${project.slug}"></script>`}
            </code>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-800 text-white">2. ใส่ปุ่ม “แอด LINE” (ที่ไหนก็ได้บนหน้า)</span>
              <CopyButton text={`<a data-line-add href="#">➕ แอด LINE คุยกับเรา</a>`} label="Copy button" />
            </div>
            <code className="block break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-100 dark:text-slate-800">
              {`<a data-line-add href="#">➕ แอด LINE คุยกับเรา</a>`}
            </code>
            <p className="mt-1 text-xs text-slate-400">
              สคริปต์จะ auto-fill href ของทุก element ที่มี <code>data-line-add</code> ให้ชี้ไป LINE พร้อม click_id
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Short links (/s/xxx) */}
      <SectionCard title="✂️ Short Link (สั้น + โดเมนตัวเอง — เข้าถึงง่ายกว่า)">
        <p className="mb-3 text-sm text-slate-500">
          ลิงก์ tracking ยาวเกินไป → ย่อเป็น <code>{getTrackingBaseUrl()}/s/xxxxxx</code> สั้น สวย จำง่าย
          เหมาะกับโพสต์ / bio / QR / ออฟไลน์ (นับคลิกได้ด้วย)
        </p>
        <form action={createShortLinkAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <input type="hidden" name="projectId" value={project.id} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">ชื่อ</label>
            <input name="name" required className="field-input" placeholder="FB โปรฯ ก.ค." />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">ช่องทาง (source)</label>
            <select name="source" className="field-input" defaultValue="facebook">
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="line">LINE</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
              <option value="google">Google</option>
              <option value="email">Email</option>
              <option value="offline">ออฟไลน์/QR</option>
              <option value="organic">อื่น ๆ</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">medium</label>
            <input name="medium" className="field-input" placeholder="social" defaultValue="social" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">ปลายทาง</label>
            <select name="dest" className="field-input" defaultValue="go">
              <option value="go">แอด LINE ตรง (เร็ว)</option>
              <option value="t">หน้า Landing</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">✂️ ย่อลิงก์</button>
        </form>

        <div className="mt-4 space-y-2">
          {shortLinks.length === 0 && <p className="text-sm text-slate-400">ยังไม่มี short link</p>}
          {shortLinks.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line-500/30 bg-[#06C755]/5 p-3">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-[#06C755] text-white">{s.name}</span>
              <code className="font-semibold text-emerald-700">{shortUrl(s.code)}</code>
              <span className="text-xs text-slate-400">· {s.clicks} คลิก</span>
              <div className="ml-auto flex items-center gap-2">
                <CopyButton text={shortUrl(s.code)} />
                <form action={deleteShortLinkAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn-secondary text-xs text-rose-500" type="submit">ลบ</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="เทมเพลตลิงก์ทุกช่องทาง (Tracking Links)">
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.key} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-1 flex items-center gap-2">
                <StatusBadge status="CONNECTED" label={t.label} />
                <CopyButton text={t.url} label="Copy link" />
              </div>
              <code className="block break-all text-xs text-slate-500">{t.url}</code>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Custom tracking link builder">
        <form action={createTrackingLinkAction} className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_1fr_auto] md:items-end">
          <input type="hidden" name="projectId" value={project.id} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Platform</label>
            <select name="platform" className="field-input" defaultValue="CUSTOM">
              <option value="GOOGLE">GOOGLE</option>
              <option value="META">META</option>
              <option value="TIKTOK">TIKTOK</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Name</label>
            <input name="name" className="field-input" placeholder="เช่น IG Story ก.ค." />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Custom URL (เว้นว่าง = ใช้เทมเพลต)</label>
            <input name="url" className="field-input" placeholder={`${getTrackingBaseUrl()}/t/${project.slug}?...`} />
          </div>
          <button type="submit" className="btn-primary">+ Add</button>
        </form>
      </SectionCard>

      <SectionCard title="ลิงก์ที่บันทึกไว้">
        <div className="overflow-x-auto"><ResizableTable storageKey="lt-tracking-links" className="min-w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Platform</th>
              <th className="th">Name</th>
              <th className="th">URL</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {project.trackingLinks.length === 0 && <EmptyRow colSpan={4} text="ยังไม่มีลิงก์" />}
            {project.trackingLinks.map((tl) => (
              <tr key={tl.id} className="border-b border-slate-50">
                <td className="td"><StatusBadge status="CONNECTED" label={tl.platform} /></td>
                <td className="td">{tl.name}</td>
                <td className="td max-w-md truncate"><code className="text-xs text-slate-500">{tl.url}</code></td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <CopyButton text={tl.url} />
                    <form action={deleteTrackingLinkAction}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="id" value={tl.id} />
                      <button className="btn-secondary text-xs text-rose-500" type="submit">ลบ</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ResizableTable></div>
      </SectionCard>
    </div>
  );
}
