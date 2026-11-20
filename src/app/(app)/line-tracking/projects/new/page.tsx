import Link from "next/link";
import { PageHeader } from "@/components/ds";
import { createProjectAction } from "@/lib/line-tracking/actions";

const BUSINESS_TYPES = [
  "คลินิก / ความงาม",
  "อสังหาริมทรัพย์",
  "การศึกษา / ติวเตอร์",
  "วีซ่า / ท่องเที่ยว",
  "ประกัน / การเงิน",
  "อีคอมเมิร์ซ",
  "บริการทั่วไป",
];

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Create Project · Step 1 of 8" title={<>สร้างโปรเจกต์ลูกค้าใหม่</>} subtitle={<>กรอกข้อมูลพื้นฐาน แล้วระบบจะพาไป Setup Wizard ต่อ</>} />

      <form action={createProjectAction} className="card p-5 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Project name *</label>
          <input name="name" required className="field-input" placeholder="เช่น Project Q3" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Client name *</label>
            <input name="clientName" required className="field-input" placeholder="ชื่อลูกค้าใหม่" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Business type *</label>
            <select name="businessType" required className="field-input" defaultValue="">
              <option value="" disabled>เลือกประเภทธุรกิจ…</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Website URL <span className="text-slate-300">(optional)</span></label>
          <input name="websiteUrl" type="url" className="field-input" placeholder="https://example.com" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Currency</label>
            <select name="currency" className="field-input" defaultValue="THB">
              <option value="THB">THB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Timezone</label>
            <input name="timezone" className="field-input" defaultValue="Asia/Bangkok" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Default conversion value</label>
            <input name="defaultConversionValue" type="number" min="0" step="1" className="field-input" defaultValue={0} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Main sales channel / default LINE OA</label>
          <input name="mainSalesChannel" className="field-input" defaultValue="LINE" placeholder="LINE OA @abcclinic" />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/line-tracking/projects" className="btn-secondary">ยกเลิก</Link>
          <button type="submit" className="btn-primary">สร้างโปรเจกต์ &amp; ไปตั้งค่า →</button>
        </div>
      </form>
    </div>
  );
}
