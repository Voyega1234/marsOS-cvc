// CSV import for backlinks — supports Ahrefs, Semrush, Majestic, and generic formats
// Backlink-only scope.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Known column aliases from popular tools
const COL_ALIASES: Record<string, string[]> = {
  sourceUrl:  ["referring page url", "source url", "source", "from url", "page", "referring page", "linking page", "url from"],
  targetUrl:  ["linked page url",    "target url", "target", "to url",   "destination url", "url to", "href"],
  anchorText: ["anchor text",        "anchor",     "link text", "text"],
  domainRating: ["domain rating", "dr", "domain authority", "da", "authority score", "as"],
  sourceDomain: ["referring domain", "domain", "source domain", "from domain"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_-]/g, " ");
}

function mapHeader(header: string): string | null {
  const norm = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    if (aliases.some(a => norm === a || norm.includes(a))) return field;
  }
  return null;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = splitLine(lines[0]);
  const headers = rawHeaders.map(mapHeader);

  return lines.slice(1).map(line => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((field, i) => {
      if (field && values[i]) row[field] = values[i];
    });
    return row;
  }).filter(r => r.sourceUrl || r.targetUrl);
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

// POST /api/backlinks/import-csv
// Multipart form: file=<csv>, projectId=<id>
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId  = session.user.organizationId;
  const userId = session.user.id;

  let projectId: string;
  let csvText: string;

  try {
    const form = await req.formData();
    projectId = (form.get("projectId") as string | null) ?? "";
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    csvText = await file.text();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  // Verify project belongs to org
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found. Check column headers." }, { status: 400 });
  }

  // Get existing sourceUrls to avoid duplicates
  const existing = await prisma.backlinkEntry.findMany({
    where: { organizationId: orgId, projectId },
    select: { sourceUrl: true, targetUrl: true },
  });
  const existingKeys = new Set(existing.map(e => `${e.sourceUrl}||${e.targetUrl}`));

  const toCreate: {
    organizationId: string; projectId: string; createdById: string;
    sourceUrl: string | null; targetUrl: string;
    anchorText: string | null; domainRating: number | null;
    status: string; notes: string;
  }[] = [];

  let skipped = 0;

  for (const row of rows.slice(0, 2000)) { // hard cap 2000 per import
    const sourceUrl = row.sourceUrl?.trim() || null;
    const targetUrl = row.targetUrl?.trim() || "";

    if (!targetUrl || !isValidUrl(targetUrl)) { skipped++; continue; }

    const key = `${sourceUrl}||${targetUrl}`;
    if (existingKeys.has(key)) { skipped++; continue; }
    existingKeys.add(key);

    const dr = row.domainRating ? parseInt(row.domainRating, 10) : null;

    toCreate.push({
      organizationId: orgId,
      projectId,
      createdById: userId,
      sourceUrl,
      targetUrl,
      anchorText: row.anchorText?.trim() || null,
      domainRating: dr && !isNaN(dr) ? Math.min(100, Math.max(0, dr)) : null,
      status: "REQUESTED",
      notes: row.sourceDomain ? `Domain: ${row.sourceDomain}` : "CSV import",
    });
  }

  if (toCreate.length === 0) {
    return NextResponse.json({ imported: 0, skipped, message: "All rows already exist or invalid" });
  }

  await prisma.backlinkEntry.createMany({ data: toCreate });

  return NextResponse.json({
    imported: toCreate.length,
    skipped,
    total: rows.length,
    message: `Imported ${toCreate.length} backlinks (${skipped} skipped)`,
  }, { status: 201 });
}
