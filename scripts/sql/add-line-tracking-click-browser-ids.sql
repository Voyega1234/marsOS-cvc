-- LINE Tracking: lt_click_browser_ids — browser identifiers read on the customer's website for one click
-- (GA4 session ids, Meta _fbp / _fbc, TikTok _ttp), so a conversion sent later can be matched by the platform.
-- 1 new table in schema "line_tracking". Touches no existing table. Starts empty. CREATE only, safe to re-run.
-- Until this has been run the module works as before: conversions are sent without these ids.
--
-- Run once in the Supabase SQL editor of project "SEO PROJECT" (the MarsOS database).

BEGIN;

CREATE TABLE IF NOT EXISTS "line_tracking"."lt_click_browser_ids" (
    "clickId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lt_click_browser_ids_pkey" PRIMARY KEY ("clickId"),
    CONSTRAINT "lt_click_browser_ids_clickId_fkey" FOREIGN KEY ("clickId")
        REFERENCES "line_tracking"."lt_ad_click"("clickId") ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
