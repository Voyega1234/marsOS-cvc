"use client";

import { Check, X, ShieldCheck } from "lucide-react";

import {
  PERMISSION_ROLES, PERMISSION_CAPABILITIES, ROLE_CAPABILITY_MATRIX,
  SECURITY_CHECKLIST, MOCK_PERMISSION_AUDIT,
} from "./mockData";
import { MockBadge, SectionCard } from "./shared";

export function PermissionsTab() {
  return (
    <div className="space-y-5">
      <SectionCard title="Role × Permission Matrix" description="สิทธิ์ของแต่ละ Role ต่อ Website Connection">
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="py-2 pr-4">Permission</th>
                {PERMISSION_ROLES.map((role) => (
                  <th key={role} className="py-2 px-3 text-center whitespace-nowrap">{role}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PERMISSION_CAPABILITIES.map((cap) => (
                <tr key={cap}>
                  <td className="py-2.5 pr-4 text-gray-700">{cap}</td>
                  {PERMISSION_ROLES.map((role) => {
                    const allowed = ROLE_CAPABILITY_MATRIX[role]?.includes(cap);
                    return (
                      <td key={role} className="py-2.5 px-3 text-center">
                        {allowed ? (
                          <Check className="h-4 w-4 text-emerald-600 inline" />
                        ) : (
                          <X className="h-4 w-4 text-gray-300 inline" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Security Checklist">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SECURITY_CHECKLIST.map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Permission Change Audit"
        action={<MockBadge />}
      >
        <div className="divide-y divide-gray-100">
          {MOCK_PERMISSION_AUDIT.map((entry) => (
            <div key={entry.id} className="py-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">{entry.timestamp}</span>
              <span className="font-medium text-gray-800">{entry.actor}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{entry.connection}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{entry.change}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
