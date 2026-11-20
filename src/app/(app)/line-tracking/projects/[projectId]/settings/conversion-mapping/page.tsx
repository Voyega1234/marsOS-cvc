import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConversionRuleRow } from "@/components/line-tracking/ConversionRuleRow";
import { LEAD_STATUS_LABEL } from "@/lib/line-tracking/enums";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import { PLATFORMS, PLATFORM_DATA_SENT } from "@/lib/line-tracking/platforms";
import { syncRulePlatforms } from "@/lib/line-tracking/services/conversionRuleService";
import { projectLeadStatuses } from "@/lib/line-tracking/services/autoPaidProjects";
import { ResizableTable } from "@/components/line-tracking/ResizableTable";
import { guardProjectPage } from "@/lib/line-tracking/pageGuard";

export const dynamic = "force-dynamic";

// Conversion Mapping — moved out of the setup wizard into its own settings
// sub-page. Includes the full event reference table (now with the 🚫 block-OA
// row: line_block fires to EVERY connected platform on unfollow).
export default async function ConversionMappingSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await guardProjectPage(projectId, { clientAllowed: false });
  // เติมแพลตฟอร์มที่เพิ่มเข้ามาทีหลัง + อัปเกรดชื่อ event ชุดเดิมที่ซ้ำกันข้ามสถานะ
  // ก่อนอ่านมาแสดง โปรเจกต์เก่าจึงได้ชื่อใหม่เองโดยไม่ต้องรัน SQL มือ
  // (เขียนเฉพาะแถวที่ต้องแก้จริง ถ้าไม่มีอะไรเปลี่ยนคือ query อ่านอย่างเดียว)
  await syncRulePlatforms(projectId);
  const project = await prisma.ltProject.findUnique({
    where: { id: projectId },
    include: { conversionRules: { orderBy: { leadStatus: "asc" } } },
  });
  if (!project) notFound();
  const statuses = projectLeadStatuses(project);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<>⚡ Conversion Mapping · {project.name}</>}
        subtitle={<>กำหนด event ต่อสถานะ Lead ต่อแพลตฟอร์ม — เลือก Standard event หรือพิมพ์ Custom เอง</>}
        actions={<>
        <Link href={`/line-tracking/projects/${project.id}/settings`} className="btn-secondary text-sm">
          ← Settings
        </Link>
        </>}
      />

      {/* Reference: event names per status × platform */}
      <div className="card p-5 overflow-x-auto">
        <h2 className="text-base font-semibold">📋 Event ทั้งหมด (สถานะ Lead → ชื่อ event แต่ละแพลตฟอร์ม)</h2>
        <p className="mb-2 text-sm text-slate-500">ตารางอ้างอิง — เมื่อ Lead เปลี่ยนสถานะ ระบบยิง event ชื่อนี้ไปแต่ละแพลตฟอร์ม (แก้ชื่อได้ในส่วน Mapping ด้านล่าง)</p>
        <ResizableTable storageKey="lt-conversion-mapping" className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Status</th>
              {PLATFORMS.map((p) => <th key={p.id} className="th">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {statuses.map((st) => (
              <tr key={st} className="border-b border-slate-50">
                <td className="td font-medium">{st}<div className="text-[10px] text-slate-400">{LEAD_STATUS_LABEL[st as LeadStatus]}</div></td>
                {PLATFORMS.map((p) => (
                  <td key={p.id} className="td">{p.events[st as LeadStatus] ?? <span className="text-slate-300">—</span>}</td>
                ))}
              </tr>
            ))}
            {/* 🚫 Block-OA event — fires to every connected platform on unfollow */}
            <tr className="border-b border-slate-50 bg-rose-50/50">
              <td className="td font-medium">🚫 line_block<div className="text-[10px] text-slate-400">ลูกค้าบล็อก LINE OA</div></td>
              {PLATFORMS.map((p) => (
                <td key={p.id} className="td">{p.blockEvent ?? <span className="text-slate-300">—</span>}</td>
              ))}
            </tr>
          </tbody>
        </ResizableTable>
        <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-600">
          🚫 <b>line_block</b> ยิงอัตโนมัติเมื่อลูกค้า <b>บล็อก LINE OA</b> — ส่งไป<b>ทุกแพลตฟอร์มที่เชื่อมต่อแล้ว</b>เหมือน event อื่น
          เพื่อวัดว่าแคมเปญ/ช่องทางไหนพาคนที่มาบล็อกเข้ามา (แอด → ทัก → ปิดการขาย → บล็อก ครบ flow)
        </p>
      </div>

      {/* Reference: what data is sent per platform */}
      <div className="card p-5">
        <h2 className="text-base font-semibold">📤 ส่งข้อมูลอะไรไปบ้าง (ต่อแพลตฟอร์ม)</h2>
        <p className="mb-3 rounded-lg bg-[#06C755]/5 p-2 text-xs text-emerald-600">
          🔒 ไม่ส่งข้อมูลส่วนบุคคลแบบอ่านได้ออกไปเลย — ส่งแค่ click id, id ที่เข้ารหัสแล้ว และค่า conversion ·
          ชื่อจริงกับอีเมลไม่ถูกส่งทุกกรณี ส่วนเบอร์โทรจะถูกส่งก็ต่อเมื่อเปิดสวิตช์ในการ์ด Meta Ads เอง
          และถูกเข้ารหัส SHA-256 ก่อนเสมอ (ค่าเริ่มต้นคือปิด)
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {PLATFORMS.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-1 font-semibold text-slate-700">{p.label}</div>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-500">
                {PLATFORM_DATA_SENT[p.id].map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Editable rules */}
      <div className="card p-5 space-y-3">
        <h2 className="text-base font-semibold">Conversion Mapping (เปิด/ปิด + แก้ชื่อ event ต่อสถานะ)</h2>
        <p className="text-sm text-slate-500">
          กำหนดว่าแต่ละสถานะ Lead จะส่ง event ไปแพลตฟอร์มไหนบ้าง — เลือก Standard event จาก dropdown
          หรือพิมพ์ Custom event เอง (ช่องพิมพ์เองจะชนะ dropdown เมื่อกรอก) เพื่อให้ตรงกับ event ที่มีอยู่แล้วในบัญชีแพลตฟอร์มนั้น ไม่ให้ซ้ำกัน
        </p>
        {project.conversionRules.filter((rule) => statuses.includes(rule.leadStatus as LeadStatus)).map((rule) => (
          <ConversionRuleRow key={rule.id} projectId={project.id} rule={rule} />
        ))}
      </div>
    </div>
  );
}
