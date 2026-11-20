import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/line-tracking/json";
import { CONNECTOR_META } from "@/lib/line-tracking/connectors";
import { CONNECTION_TYPES, CONNECTION_LABEL } from "@/lib/line-tracking/enums";
import type { ConnectionType } from "@/lib/line-tracking/enums";

// Which per-lead click id each ad platform needs to attribute a conversion.
const CLICK_ID_FIELD: Partial<Record<ConnectionType, keyof PrismaLeadClickIds>> = {
  MICROSOFT_ADS: "msclkid",
  META_ADS: "fbclid",
  TIKTOK_ADS: "ttclid",
  X_ADS: "twclid",
  SNAPCHAT_ADS: "scclid",
};
type PrismaLeadClickIds = { gclid: string; msclkid: string; fbclid: string; ttclid: string; twclid: string; scclid: string };

// Platforms that HARD-FAIL to send a conversion without the click id (others degrade gracefully).
const HARD_CLICK_ID: ConnectionType[] = ["MICROSOFT_ADS"];

export interface ConnectorReadiness {
  type: ConnectionType;
  label: string;
  ready: boolean;              // all required credentials present
  missingCredentials: string[]; // realKeys not yet filled
  clickIdField: string | null; // which lead click id it uses (null = not click-id based)
  clickIdRequired: boolean;     // true = will hard-fail without it
  leadsWithClickId: number | null; // recent leads that carry the needed click id
  recentLeads: number;          // recent leads total (denominator)
}

/**
 * Per-project readiness report: for every connector, what credentials are still
 * missing, and whether recent leads carry the click id each ad platform needs.
 * Drives the "แจ้งว่าขาดข้อมูลอะไร" panel on the setup page.
 */
export async function getProjectReadiness(projectId: string): Promise<ConnectorReadiness[]> {
  // recent leads (last 90 days) with their click ids — one query, reused per platform.
  // Connector configs used to be fetched one findUnique per type (N+1 over a remote DB);
  // now all rows come back in a single findMany, keyed by type in memory. Configs are
  // isolated per project (no inherited secrets), so this equals the old per-type reads.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [recent, connections] = await Promise.all([
    prisma.lead.findMany({
      where: { projectId, createdAt: { gte: since } },
      select: { gclid: true, msclkid: true, fbclid: true, ttclid: true, twclid: true, scclid: true },
    }),
    prisma.projectConnection.findMany({ where: { projectId } }),
  ]);
  const recentLeads = recent.length;
  const configByType = new Map<string, Record<string, unknown>>(
    connections.map((c) => [c.type, parseJson<Record<string, unknown>>(c.configJson, {})])
  );

  const out: ConnectorReadiness[] = [];
  for (const type of CONNECTION_TYPES) {
    const meta = CONNECTOR_META[type];
    const config = configByType.get(type) ?? {};
    const missingCredentials = meta.realKeys.filter((k) => {
      const v = config[k];
      return v === undefined || v === null || v === "";
    });
    const clickIdField = CLICK_ID_FIELD[type] ?? null;
    const leadsWithClickId = clickIdField
      ? recent.filter((l) => !!l[clickIdField]).length
      : null;

    out.push({
      type,
      label: CONNECTION_LABEL[type],
      ready: missingCredentials.length === 0,
      missingCredentials,
      clickIdField: clickIdField as string | null,
      clickIdRequired: HARD_CLICK_ID.includes(type),
      leadsWithClickId,
      recentLeads,
    });
  }
  return out;
}
