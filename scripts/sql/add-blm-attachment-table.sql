-- Backlink Management: ไฟล์แนบของคำขอ Backlink
--   BlmAttachment     = ข้อมูลกำกับ (ชื่อไฟล์ ชนิด ขนาด สถานะการส่งไป Asana)
--   BlmAttachmentBlob = ตัวไฟล์ (bytea) แยกตารางเพื่อให้การอ่านรายการไม่ดึงไบต์ขึ้นมา
-- CREATE only, รันซ้ำได้ปลอดภัย — ไม่แตะตารางเดิม
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL DEFAULT '',
    "asanaAttachmentGid" TEXT NOT NULL DEFAULT '',
    "asanaPushedTaskGid" TEXT NOT NULL DEFAULT '',
    "asanaPushStartedAt" TIMESTAMP(3),
    "asanaSyncError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlmAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmAttachmentBlob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "BlmAttachmentBlob_pkey" PRIMARY KEY ("id")
);

-- ไฟล์ส่วนใหญ่บีบอัดมาแล้ว (รูป, docx, pdf) — ไม่ต้องให้ Postgres บีบซ้ำ
ALTER TABLE "plans_seo_pipeline"."BlmAttachmentBlob" ALTER COLUMN "data" SET STORAGE EXTERNAL;

CREATE INDEX IF NOT EXISTS "BlmAttachment_organizationId_requestId_idx" ON "plans_seo_pipeline"."BlmAttachment"("organizationId", "requestId");
CREATE INDEX IF NOT EXISTS "BlmAttachmentBlob_organizationId_idx" ON "plans_seo_pipeline"."BlmAttachmentBlob"("organizationId");

COMMIT;
