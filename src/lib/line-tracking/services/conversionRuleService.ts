import { prisma } from "@/lib/prisma";
import { LEAD_STATUS } from "@/lib/line-tracking/enums";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import {
  RULE_SCHEMA_KEY,
  RULE_SCHEMA_VERSION,
  STATUS_ENABLED_DEFAULT,
  defaultPlatformsForStatus,
  fillMissingPlatforms,
  healLegacyEventName,
} from "@/lib/line-tracking/platforms";
import { stringifyJson } from "@/lib/line-tracking/json";

/**
 * Seed default conversion rules for a project. Rules are driven entirely by the
 * platform registry (src/lib/platforms.ts), so every platform is covered.
 * Existing rules are left untouched (upsert update: {}).
 */
export async function seedDefaultRules(projectId: string, defaultValue = 0) {
  // One round-trip instead of one upsert per lead status (7 sequential queries on a
  // remote Postgres). `skipDuplicates` relies on the projectId+leadStatus unique
  // constraint and reproduces the old `update: {}` exactly — rows that already exist
  // are left untouched, missing rows are created with the same defaults.
  await prisma.conversionRule.createMany({
    data: LEAD_STATUS.map((status) => ({
      projectId,
      leadStatus: status,
      enabled: STATUS_ENABLED_DEFAULT[status],
      platformsJson: stringifyJson(defaultPlatformsForStatus(status)),
      defaultValue,
    })),
    skipDuplicates: true,
  });
}

/**
 * Ensure every rule's platformsJson includes any newly-added platforms (fills
 * gaps with registry defaults) without overriding the user's existing toggles,
 * and upgrade event names that are still on the old duplicated defaults.
 *
 * ค่า default มีผลตอนสร้างโปรเจกต์เท่านั้น โปรเจกต์เก่าจึงค้างชื่อ event ชุดเดิม
 * ตลอดไปถ้าไม่มีตัวไล่แก้ให้ — ฟังก์ชันนี้คือตัวนั้น เรียกตอนเปิดหน้า Conversion
 * Mapping จึงอัปเกรดให้เองโดยไม่ต้องรัน SQL มือ (ดู healLegacyEventName:
 * แตะเฉพาะชื่อที่ยังตรงกับค่าเดิมของระบบ ชื่อที่ทีมพิมพ์เองไม่ถูกแตะ)
 */
export async function syncRulePlatforms(projectId: string) {
  const rules = await prisma.conversionRule.findMany({ where: { projectId } });
  // Work out every needed update first, then issue them concurrently — the updates
  // are independent rows, so paying their latency one after another was pure waste.
  const updates: { id: string; platformsJson: string; enabled?: boolean }[] = [];
  for (const rule of rules) {
    const current = JSON.parse(rule.platformsJson || "{}") as Record<
      string,
      { enabled: boolean; eventName: string }
    >;
    const status = rule.leadStatus as LeadStatus;
    const defaults = defaultPlatformsForStatus(status);
    // A platform added to the registry after this rule was stored comes in OFF —
    // existing projects never start sending to it until someone turns it on.
    const added = fillMissingPlatforms(current, defaults);
    let changed = added.length > 0;
    for (const [pid, cfg] of Object.entries(current)) {
      if (pid === RULE_SCHEMA_KEY) continue;
      const healed = healLegacyEventName(pid, status, cfg.eventName);
      if (healed) {
        current[pid] = { ...cfg, eventName: healed };
        changed = true;
      }
    }

    // อัปเกรดสวิตช์ "ค่าเริ่มต้น" ครั้งเดียวต่อรูล — ค่า defaultOn มีผลแค่ตอนสร้าง
    // โปรเจกต์ โปรเจกต์ที่สร้างก่อนหน้าจึงค้างชุดเดิม (แพลตฟอร์มโฆษณาไม่ยิงตอน NEW)
    // ทั้งที่เชื่อมต่อผ่านแล้ว แตะเฉพาะตัวที่ยัง "ไม่เคยถูกทีมแตะ" คือปิดอยู่และชื่อ
    // event ยังตรงกับค่าของระบบเป๊ะ ๆ ส่วนที่ทีมเปลี่ยนชื่อ/เปิดเองไว้ไม่ยุ่ง
    const version = Number(current[RULE_SCHEMA_KEY]?.eventName) || 0;
    let enableRule: boolean | undefined;
    if (version < RULE_SCHEMA_VERSION) {
      for (const [pid, def] of Object.entries(defaults)) {
        if (added.includes(pid)) continue; // just filled in OFF — keep it that way
        const cfg = current[pid];
        if (def.enabled && cfg && !cfg.enabled && cfg.eventName === def.eventName) {
          current[pid] = { ...cfg, enabled: true };
        }
      }
      // สวิตช์ระดับสถานะด้วย — enqueueForLead เช็ค rule.enabled ก่อนถึงจะดูรายแพลตฟอร์ม
      // ถ้าไม่ปลดตรงนี้ QUOTED ของโปรเจกต์เก่า (ค่าเดิมคือปิด) จะยังหายไปจาก funnel
      if (!rule.enabled && STATUS_ENABLED_DEFAULT[status]) enableRule = true;
      // ประทับรุ่นไว้เสมอ ไม่งั้นรอบหน้าจะเปิดสวิตช์ที่ทีมเพิ่งปิดกลับมาอีก
      current[RULE_SCHEMA_KEY] = { enabled: false, eventName: String(RULE_SCHEMA_VERSION) };
      changed = true;
    }

    if (changed) {
      updates.push({ id: rule.id, platformsJson: stringifyJson(current), enabled: enableRule });
    }
  }
  await Promise.all(
    updates.map((u) =>
      prisma.conversionRule.update({
        where: { id: u.id },
        data: {
          platformsJson: u.platformsJson,
          ...(u.enabled === undefined ? {} : { enabled: u.enabled }),
        },
      })
    )
  );
}

export function getRuleForStatus(projectId: string, leadStatus: LeadStatus) {
  return prisma.conversionRule.findUnique({
    where: { projectId_leadStatus: { projectId, leadStatus } },
  });
}

export function listRules(projectId: string) {
  return prisma.conversionRule.findMany({
    where: { projectId },
    orderBy: { leadStatus: "asc" },
  });
}
