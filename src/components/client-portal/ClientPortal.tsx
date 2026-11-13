"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Segmented } from "@/components/ds";
import { CLIENT_AWAITING } from "@/lib/client-proposal/constants";
import { ClientReportClient } from "@/components/report/ClientReportClient";
import ClientReviewTab from "./ClientReviewTab";
import ClientPublishedTab from "./ClientPublishedTab";

type PortalTab = "review" | "published" | "report";

export interface PortalArticle { id: string; title: string; status: string; updatedAt: string }

export default function ClientPortal({ user, project, projects, reviewArticles }: {
  user: { name: string | null };
  project: { id: string; name: string; clientName: string | null; website: string | null; gscSiteUrl: string | null; ga4PropertyId: string | null; logoUrl?: string | null };
  projects: { id: string; name: string; clientName: string | null }[];
  reviewArticles: PortalArticle[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get("tab");
  const [tab, setTab] = useState<PortalTab>(initial === "published" || initial === "report" ? initial : "review");

  const approved = reviewArticles.filter((a) => a.status === "APPROVED").length;
  const sentBack = reviewArticles.filter((a) => a.status === "CLIENT_REVISION").length;
  const waiting = reviewArticles.filter((a) => (CLIENT_AWAITING as readonly string[]).includes(a.status)).length;

  const changeTab = (t: PortalTab) => {
    setTab(t);
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set("tab", t);
    params.delete("proposal");
    router.replace(`/projects/${project.id}?${params.toString()}`, { scroll: false });
  };

  const title = project.clientName || project.name;
  const stats = [
    { label: "รอคุณตรวจ", value: waiting },
    { label: "ส่งให้ทีมแก้ไขแล้ว", value: sentBack },
    { label: "อนุมัติแล้ว", value: approved },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 py-2 sm:space-y-10 sm:py-4">
      <section className="rounded-[2rem] bg-gradient-to-br from-brand-navy via-brand-dark to-brand-blue p-6 text-white shadow-lg sm:p-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Convert Cake · Client Portal</p>
            <p className="text-base text-white/80 sm:text-lg">{user.name ? `สวัสดีค่ะ คุณ${user.name}` : "สวัสดีค่ะ"}</p>
            <div className="flex items-center gap-3 sm:gap-4">
              {project.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl bg-white object-contain p-1 shadow-sm sm:h-14 sm:w-14" />
              )}
              <h1 className="min-w-0 break-words text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
            </div>
            {project.website && <p className="break-all text-sm text-white/70">{project.website}</p>}
            {projects.length > 1 && (
              <select
                aria-label="เลือกโปรเจกต์"
                value={project.id}
                onChange={(e) => router.push("/projects/" + e.target.value)}
                className="mt-2 max-w-full rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm text-white outline-none backdrop-blur"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="text-brand-navy">{p.clientName || p.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:w-[420px]">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/20 bg-white/10 p-3 backdrop-blur sm:p-4">
                <div className="text-2xl font-bold tabular-nums sm:text-3xl">{s.value}</div>
                <div className="mt-1 text-[11px] leading-tight text-white/75 sm:text-xs">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex justify-center">
        <Segmented<PortalTab>
          ariaLabel="เมนูพอร์ทัล"
          value={tab}
          onChange={changeTab}
          options={[
            { value: "review", label: "ตรวจบทความ", count: waiting },
            { value: "published", label: "เผยแพร่แล้ว" },
            { value: "report", label: "รายงาน" },
          ]}
        />
      </div>

      {tab === "review" && <ClientReviewTab projectId={project.id} articles={reviewArticles} initialArticleId={sp.get("proposal")} />}
      {tab === "published" && <ClientPublishedTab projectId={project.id} />}
      {tab === "report" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-brand-navy">ผลงานของเว็บไซต์คุณ</h2>
            <p className="text-sm text-gray-500">สรุปการเข้าชมและอันดับบน Google ของเว็บไซต์</p>
          </div>
          <ClientReportClient
            project={{
              id: project.id,
              name: project.clientName ?? project.name,
              website: project.website ?? "",
              gscSiteUrl: project.gscSiteUrl ?? null,
              ga4PropertyId: project.ga4PropertyId ?? null,
            }}
            isClient={true}
          />
        </section>
      )}
    </div>
  );
}
