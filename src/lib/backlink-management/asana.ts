/** ตัวเรียก Asana REST แบบบาง (เซิร์ฟเวอร์เท่านั้น) — ห้าม log token */
import { decrypt } from "@/lib/crypto";

const BASE = "https://app.asana.com/api/1.0";
const OPT_FIELDS = "name,completed,completed_at,due_on,assignee.email,permalink_url,modified_at";

export class AsanaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AsanaError";
  }
}

export interface AsanaTask {
  gid: string;
  name?: string;
  completed?: boolean;
  completed_at?: string | null;
  due_on?: string | null;
  assignee?: { email?: string | null } | null;
  permalink_url?: string;
  modified_at?: string;
}

export function resolveToken(config: { tokenEnc?: string | null } | null | undefined): string | null {
  if (config?.tokenEnc) {
    try {
      const t = decrypt(config.tokenEnc);
      if (t) return t;
    } catch {
      /* ถอดรหัสไม่ได้ → ลองใช้ env */
    }
  }
  const env = (process.env.ASANA_ACCESS_TOKEN ?? "").trim();
  return env || null;
}

async function call<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify({ data: body }) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ไม่ใช่ JSON */ }
    if (!res.ok) {
      const msg = json?.errors?.[0]?.message ?? `Asana ตอบกลับสถานะ ${res.status}`;
      throw new AsanaError(res.status, String(msg).slice(0, 300));
    }
    return json as T;
  } catch (e) {
    if (e instanceof AsanaError) throw e;
    if ((e as any)?.name === "AbortError") throw new AsanaError(0, "Asana ตอบช้าเกินกำหนด");
    throw new AsanaError(0, "เชื่อมต่อ Asana ไม่ได้");
  } finally {
    clearTimeout(timer);
  }
}

export async function getMe(token: string): Promise<{ gid: string; name: string; email: string }> {
  const r = await call(token, "GET", "/users/me?opt_fields=name,email");
  return r.data;
}

export interface AsanaProjectOption { gid: string; name: string; workspaceName: string; teamName: string }

/**
 * โปรเจกต์ทั้งหมดที่ token มองเห็น — ไล่ทีละหน้า (หน้าละ 100) จนครบ
 * หยุดเมื่อถึงเพดานจำนวนหรือเวลา แล้วคืน truncated = true ให้หน้าจอบอกผู้ใช้ว่ารายการยังไม่ครบ
 */
export async function listProjects(
  token: string,
  opts: { maxProjects?: number; budgetMs?: number } = {},
): Promise<{ projects: AsanaProjectOption[]; truncated: boolean }> {
  const maxProjects = opts.maxProjects ?? 5000;
  const stopAt = Date.now() + (opts.budgetMs ?? 40_000);
  const ws = await call(token, "GET", "/workspaces?limit=100");
  const projects: AsanaProjectOption[] = [];
  let truncated = false;
  outer: for (const w of ws.data ?? []) {
    let offset = "";
    for (;;) {
      if (projects.length >= maxProjects || Date.now() >= stopAt) { truncated = true; break outer; }
      const qs = `workspace=${encodeURIComponent(w.gid)}&archived=false&limit=100&opt_fields=name,workspace.name,team.name${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
      const r = await call(token, "GET", `/projects?${qs}`);
      for (const p of r.data ?? []) {
        projects.push({ gid: p.gid, name: p.name ?? "", workspaceName: p.workspace?.name ?? w.name ?? "", teamName: p.team?.name ?? "" });
      }
      offset = r.next_page?.offset ?? "";
      if (!offset) break;
    }
  }
  if (projects.length > maxProjects) { projects.length = maxProjects; truncated = true; }
  projects.sort((a, b) => a.name.localeCompare(b.name, "th"));
  return { projects, truncated };
}

export async function getProject(token: string, gid: string): Promise<{ gid: string; name: string }> {
  const r = await call(token, "GET", `/projects/${encodeURIComponent(gid)}?opt_fields=name`);
  return r.data;
}

export async function createTask(
  token: string,
  p: { projectGid: string; name: string; notes: string; assigneeEmail?: string | null; dueOn?: string | null },
): Promise<{ gid: string; permalink_url: string; assigneeDropped: boolean }> {
  const base: Record<string, unknown> = { name: p.name, notes: p.notes, projects: [p.projectGid] };
  if (p.dueOn) base.due_on = p.dueOn;
  const q = "?opt_fields=permalink_url";
  let dropped = false;
  try {
    const r = await call(token, "POST", `/tasks${q}`, p.assigneeEmail ? { ...base, assignee: p.assigneeEmail } : base);
    return { gid: r.data.gid, permalink_url: r.data.permalink_url ?? "", assigneeDropped: false };
  } catch (e) {
    if (p.assigneeEmail && e instanceof AsanaError && (e.status === 400 || e.status === 403) && /assignee/i.test(e.message)) {
      dropped = true;
    } else {
      throw e;
    }
  }
  const r = await call(token, "POST", `/tasks${q}`, base);
  return { gid: r.data.gid, permalink_url: r.data.permalink_url ?? "", assigneeDropped: dropped };
}

export async function updateTask(token: string, gid: string, fields: Record<string, unknown>): Promise<void> {
  await call(token, "PUT", `/tasks/${encodeURIComponent(gid)}`, fields);
}

export async function getTask(token: string, gid: string): Promise<AsanaTask | null> {
  try {
    const r = await call(token, "GET", `/tasks/${encodeURIComponent(gid)}?opt_fields=${OPT_FIELDS}`);
    return r.data as AsanaTask;
  } catch (e) {
    if (e instanceof AsanaError && e.status === 404) return null;
    throw e;
  }
}

export async function addComment(token: string, gid: string, text: string): Promise<void> {
  await call(token, "POST", `/tasks/${encodeURIComponent(gid)}/stories`, { text });
}

export async function listProjectTasks(token: string, projectGid: string, modifiedSinceIso: string): Promise<AsanaTask[]> {
  const out: AsanaTask[] = [];
  let offset = "";
  for (let page = 0; page < 5; page++) {
    const qs = `project=${encodeURIComponent(projectGid)}&modified_since=${encodeURIComponent(modifiedSinceIso)}&limit=100&opt_fields=${OPT_FIELDS}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const r = await call(token, "GET", `/tasks?${qs}`);
    out.push(...((r.data ?? []) as AsanaTask[]));
    offset = r.next_page?.offset ?? "";
    if (!offset) break;
  }
  return out;
}

export async function createWebhook(token: string, projectGid: string, targetUrl: string): Promise<{ gid: string }> {
  const r = await call(token, "POST", "/webhooks", {
    resource: projectGid,
    target: targetUrl,
    filters: [
      { resource_type: "task", action: "changed", fields: ["completed", "due_on", "assignee", "name"] },
      { resource_type: "task", action: "deleted" },
      { resource_type: "task", action: "removed" },
    ],
  });
  return { gid: r.data.gid };
}

export async function deleteWebhook(token: string, gid: string): Promise<void> {
  try {
    await call(token, "DELETE", `/webhooks/${encodeURIComponent(gid)}`);
  } catch (e) {
    if (e instanceof AsanaError && e.status === 404) return;
    throw e;
  }
}
