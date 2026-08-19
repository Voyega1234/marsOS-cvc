"use client";

import { useMemo, useState } from "react";
import {
  LayoutDashboard, Plug, FileText, RefreshCw, Layers, ShieldCheck, Webhook, ScrollText,
} from "lucide-react";

import type { ConnectionRow, ProjectLite, RealWpConnection, SettingsTabId } from "./types";
import { buildRealConnectionRows, MOCK_CONNECTIONS } from "./mockData";
import { ConnectWizard } from "./ConnectWizard";
import { OverviewTab } from "./OverviewTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { CmsPublishingTab } from "./CmsPublishingTab";
import { DataSyncTab } from "./DataSyncTab";
import { EnvironmentsTab } from "./EnvironmentsTab";
import { PermissionsTab } from "./PermissionsTab";
import { WebhooksTab } from "./WebhooksTab";
import { LogsTab } from "./LogsTab";

interface Props {
  wpConnections: RealWpConnection[];
  projects: ProjectLite[];
}

const TABS: { id: SettingsTabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "cms-publishing", label: "CMS & Publishing", icon: FileText },
  { id: "data-sync", label: "Website Data Sync", icon: RefreshCw },
  { id: "environments", label: "Environments", icon: Layers },
  { id: "permissions", label: "Permissions & Security", icon: ShieldCheck },
  { id: "webhooks", label: "Webhooks & Automation", icon: Webhook },
  { id: "logs", label: "Logs & Audit", icon: ScrollText },
];

export function WebsiteConnectionsClient({ wpConnections, projects }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("overview");
  const [wizardOpen, setWizardOpen] = useState(false);

  const realRows = useMemo(() => buildRealConnectionRows(wpConnections, projects), [wpConnections, projects]);
  const [rows, setRows] = useState<ConnectionRow[]>(() => [...realRows, ...MOCK_CONNECTIONS]);

  function goTo(tab: SettingsTabId) {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">Website Connections</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            เชื่อมเว็บไซต์ของ Client เพื่อดึงข้อมูลจริงและใช้กับ Article Brief, Validator และ Publish
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors flex-shrink-0"
        >
          <Plug className="h-4 w-4" />
          Connect Website
        </button>
      </div>

      <div className="flex flex-col lg:flex-row items-start gap-5">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible w-full lg:w-[216px] flex-shrink-0 lg:sticky lg:top-4 bg-white rounded-2xl border border-gray-200 p-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 lg:w-full lg:flex-shrink lg:justify-start ${
                  active ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-brand-navy"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 w-full">
          {activeTab === "overview" && (
            <OverviewTab rows={rows} onOpenWizard={() => setWizardOpen(true)} onGoTo={goTo} />
          )}
          {activeTab === "connections" && (
            <ConnectionsTab rows={rows} setRows={setRows} onOpenWizard={() => setWizardOpen(true)} onGoTo={goTo} />
          )}
          {activeTab === "cms-publishing" && <CmsPublishingTab />}
          {activeTab === "data-sync" && <DataSyncTab rows={rows} />}
          {activeTab === "environments" && <EnvironmentsTab />}
          {activeTab === "permissions" && <PermissionsTab />}
          {activeTab === "webhooks" && <WebhooksTab />}
          {activeTab === "logs" && <LogsTab rows={rows} />}
        </div>
      </div>

      <ConnectWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        projects={projects}
        onCreated={(row) => setRows((prev) => [row, ...prev])}
      />
    </div>
  );
}
