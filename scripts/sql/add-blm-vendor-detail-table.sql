-- Backlink Management: BlmVendorDetail (ข้อมูลเสริมของคลังเว็บ: ราคาแยกประเภท, UR, ภาษา, อายุลิงก์, Rate Card, สถานะข้อมูล, รหัสอ้างอิง)
-- CREATE only, รันซ้ำได้ปลอดภัย — ไม่แตะตาราง BlmVendorSite เดิม
-- ต้องรัน 1 ครั้งใน Supabase SQL editor ของโปรเจกต์ "SEO PROJECT" (ref falakbebwdnrbkvnamrs)

BEGIN;

CREATE TABLE IF NOT EXISTS "plans_seo_pipeline"."BlmVendorDetail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorSiteId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT '',
    "urlRating" DOUBLE PRECISION,
    "priceBacklink" DOUBLE PRECISION,
    "pricePublisherWeb" DOUBLE PRECISION,
    "pricePublisherWebFb" DOUBLE PRECISION,
    "priceCvcWeb" DOUBLE PRECISION,
    "priceCvcWebFb" DOUBLE PRECISION,
    "pricePr" DOUBLE PRECISION,
    "priceNote" TEXT NOT NULL DEFAULT '',
    "expiration" TEXT NOT NULL DEFAULT '',
    "rateCardUrl" TEXT NOT NULL DEFAULT '',
    "dataStatus" TEXT NOT NULL DEFAULT '',
    "refId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlmVendorDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlmVendorDetail_vendorSiteId_key" ON "plans_seo_pipeline"."BlmVendorDetail"("vendorSiteId");
CREATE INDEX IF NOT EXISTS "BlmVendorDetail_organizationId_idx" ON "plans_seo_pipeline"."BlmVendorDetail"("organizationId");

COMMIT;
