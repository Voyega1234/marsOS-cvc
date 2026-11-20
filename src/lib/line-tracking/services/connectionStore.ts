import { prisma } from "@/lib/prisma";
import { parseJson, stringifyJson } from "@/lib/line-tracking/json";
import { isRealMode } from "@/lib/line-tracking/connectors";
import type { ConnectionType } from "@/lib/line-tracking/enums";

/** Read a connector's RAW project config (for the edit form). */
export async function getConnectionConfig<T = Record<string, unknown>>(
  projectId: string,
  type: ConnectionType
): Promise<T> {
  const conn = await prisma.projectConnection.findUnique({
    where: { projectId_type: { projectId, type } },
  });
  return parseJson<T>(conn?.configJson, {} as T);
}

/** Credentials are isolated per project; there are no inherited shared secrets. */
export async function getEffectiveConfig<T = Record<string, unknown>>(
  projectId: string,
  type: ConnectionType
): Promise<T> {
  return getConnectionConfig<T>(projectId, type);
}

export async function isConnectorReal(
  projectId: string,
  type: ConnectionType
): Promise<boolean> {
  const config = await getEffectiveConfig(projectId, type);
  return isRealMode(type, config as Record<string, unknown>);
}

/** Upsert connector config, merging with existing values. Recomputes status. */
export async function saveConnectionConfig(
  projectId: string,
  type: ConnectionType,
  patch: Record<string, unknown>
) {
  const existing = await getConnectionConfig<Record<string, unknown>>(projectId, type);
  // Blank incoming secret fields should not wipe stored secrets.
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === "" && typeof existing[k] === "string" && (existing[k] as string).length > 0) {
      continue; // keep existing secret if the field was left blank
    }
    merged[k] = v;
  }
  const connected = isRealMode(type, merged);
  return prisma.projectConnection.upsert({
    where: { projectId_type: { projectId, type } },
    create: {
      projectId,
      type,
      configJson: stringifyJson(merged),
      status: connected ? "CONNECTED" : "NOT_CONNECTED",
    },
    update: {
      configJson: stringifyJson(merged),
      // never downgrade a passing CONNECTED to NOT_CONNECTED just by re-saving
      status: connected ? "CONNECTED" : undefined,
    },
  });
}
