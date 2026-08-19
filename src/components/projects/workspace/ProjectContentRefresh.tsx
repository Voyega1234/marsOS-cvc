"use client";

import { useEffect, useState } from "react";

import { ContentRefreshClient } from "@/components/refresh/ContentRefreshClient";

// Content Refresh ต่อโปรเจกต์ (ย้ายมาจากเมนู Studio — คำสั่งผู้ใช้ 2026-08-06)
// ดึงข้อมูลจาก GSC ด้วย auth ชุดเดียวกับหน้า Report (Gmail ที่เชื่อม → OIDC → ADC)
interface Props {
  project: { id: string; name: string; clientName?: string | null; website?: string | null; gscSiteUrl?: string | null; ga4PropertyId?: string | null };
}

export function ProjectContentRefresh({ project }: Props) {
  const [items, setItems] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/refresh?projectId=${project.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`โหลดรายการไม่สำเร็จ (${r.status})`);
        setItems(await r.json());
      })
      .catch((e) => setError((e as Error).message));
  }, [project.id]);

  if (error) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>;
  }
  if (!items) return <div className="p-8 text-sm text-gray-400">กำลังโหลด Content Refresh...</div>;

  // การตั้งค่า Service Email + ผูก property ย้ายไปอยู่ Project Settings (ฟันเฟือง) > GSC · GA4
  return (
    <div className="space-y-3">
    <ContentRefreshClient
      initialItems={items as never[]}
      projects={[{ id: project.id, name: project.clientName ?? project.name }]}
      defaultProjectId={project.id}
      defaultSiteUrl={project.gscSiteUrl ?? (project.website ? `sc-domain:${project.website.replace(/^https?:\/\//, "")}` : "")}
    />
    </div>
  );
}
