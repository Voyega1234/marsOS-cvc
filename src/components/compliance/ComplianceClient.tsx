"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, UnderlineTabs } from "@/components/ds";
import { api, type IndustryOpt } from "./shared";
import CheckTab from "./CheckTab";
import HistoryTab from "./HistoryTab";
import RulesTab from "./RulesTab";
import AuditTab from "./AuditTab";

type Tab = "check" | "history" | "rules" | "audit";

export default function ComplianceClient({ userRole }: { userRole: string }) {
  const [tab, setTab] = useState<Tab>("check");
  const [industries, setIndustries] = useState<IndustryOpt[]>([]);
  const [loadError, setLoadError] = useState("");

  const loadIndustries = useCallback(async () => {
    const { ok, data } = await api<{ industries: IndustryOpt[] }>("/api/compliance/industries");
    if (ok && Array.isArray(data.industries)) { setIndustries(data.industries); setLoadError(""); }
    else setLoadError(data.error || "โหลดรายการอุตสาหกรรมไม่สำเร็จ");
  }, []);

  useEffect(() => { void loadIndustries(); }, [loadIndustries]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Compliance Checker"
        subtitle="ตรวจบทความกับกฎโฆษณารายอุตสาหกรรมก่อนเผยแพร่"
      />
      {loadError && (
        <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          โหลดรายการอุตสาหกรรมไม่สำเร็จ — {loadError}
        </div>
      )}
      <UnderlineTabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "check", label: "ตรวจบทความ" },
          { id: "history", label: "ผลตรวจและอนุมัติ" },
          { id: "rules", label: "คลังกฎ" },
          { id: "audit", label: "Audit Log" },
        ]}
      />
      {tab === "check" && <CheckTab industries={industries} userRole={userRole} onGoRules={() => setTab("rules")} />}
      {tab === "history" && <HistoryTab industries={industries} userRole={userRole} />}
      {tab === "rules" && <RulesTab industries={industries} userRole={userRole} onChanged={loadIndustries} />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}
