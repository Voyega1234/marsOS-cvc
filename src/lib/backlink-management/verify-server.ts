/** ตรวจลิงก์ 1 แถวแล้วบันทึกผล (เซิร์ฟเวอร์เท่านั้น) */
import type { BlmRequest } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkBacklink } from "./link-check";
import { pushRequestChange } from "./asana-sync";
import { addEvent } from "./server";
import { statusLabel } from "./types";

export async function verifyRequest(orgId: string, actorId: string | null, row: BlmRequest) {
  const r = await checkBacklink(row.liveUrl, row.targetUrl);
  let newStatus = row.status;
  if ((r.status === "LIVE" || r.status === "NOFOLLOW") && (row.status === "PUBLISHED" || row.status === "LOST")) newStatus = "VERIFIED";
  else if (r.status === "LOST" && row.status === "VERIFIED") newStatus = "LOST";
  await prisma.blmRequest.update({
    where: { id: row.id },
    data: { lastCheckedAt: new Date(), checkStatus: r.status, checkDetail: r.detail.slice(0, 500), foundRel: r.rel.slice(0, 200), status: newStatus },
  });
  await addEvent({
    organizationId: orgId, requestId: row.id, type: "VERIFY", source: actorId ? "user" : "system",
    fromStatus: row.status, toStatus: newStatus, note: `${r.status}: ${r.detail}`, actorId,
  });
  if (newStatus !== row.status) {
    await pushRequestChange(orgId, row.id, `MarsOS: ตรวจลิงก์แล้ว สถานะเปลี่ยนเป็น ${statusLabel(newStatus)} (${r.detail})`);
  }
  return { checkStatus: r.status, status: newStatus };
}
