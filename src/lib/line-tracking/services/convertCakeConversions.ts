// Convert Cake only: every status sends a conversion to every connected platform, LOST
// included. Other projects keep their per-status rules (LOST off, per-platform toggles).
// Event names come from the project's rule when one is set, else the platform default;
// LOST has no default anywhere, so it goes out as the custom event CC_LOST_EVENT (custom
// names already pass through every sender, like "line_block").
import { PLATFORMS } from "@/lib/line-tracking/platforms";
import type { LeadStatus } from "@/lib/line-tracking/enums";
import type { PlatformsConfig } from "@/lib/line-tracking/platforms";

export const CC_LOST_EVENT = "lead_lost";

/** Platform → event for this status, every platform enabled. */
export function ccPlatformsForStatus(status: LeadStatus, rulePlatforms: PlatformsConfig): PlatformsConfig {
  const out: PlatformsConfig = {};
  for (const def of PLATFORMS) {
    const eventName =
      rulePlatforms[def.id]?.eventName || def.events[status] || (status === "LOST" ? CC_LOST_EVENT : "");
    if (eventName) out[def.id] = { enabled: true, eventName };
  }
  return out;
}
