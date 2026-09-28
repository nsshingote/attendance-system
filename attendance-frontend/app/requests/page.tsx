"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { CorrectionsContent } from "@/app/corrections/page";
import { ProfileEditRequestsContent } from "@/app/profile-edit-requests/page";
import { AdminReportsContent } from "@/app/admin-reports/page";
import { getSession } from "@/lib/auth";
import { hasPermission, usePermissions } from "@/lib/permissions";

const tabs = [
  { label: "Attendance Corrections", key: "corrections" },
  { label: "Profile Corrections", key: "profile-edit" },
  { label: "Report Approvals", key: "report-approvals" },
] as const;

export default function RequestsPage() {
  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("corrections");
  const { permissions } = usePermissions();
  const teamLeader = getSession()?.role === "team_leader";
  const legacyRequestsAccess = !teamLeader && hasPermission(permissions, "requests.view");
  const canViewCorrections = legacyRequestsAccess || [
    "corrections.view_own",
    "corrections.team_view",
    "corrections.all_view",
  ].some((key) => hasPermission(permissions, key));
  const canViewProfileCorrections = legacyRequestsAccess || [
    "profile_corrections.team_view",
    "profile_corrections.all_view",
  ].some((key) => hasPermission(permissions, key));
  const canViewReportApprovals = legacyRequestsAccess || [
    "report_approvals.team_view",
    "report_approvals.all_view",
  ].some((key) => hasPermission(permissions, key));
  const visibleTabs = tabs.filter((tab) =>
    (tab.key === "corrections" && canViewCorrections) ||
    (tab.key === "profile-edit" && canViewProfileCorrections) ||
    (tab.key === "report-approvals" && canViewReportApprovals)
  );
  const hasPageAccess = visibleTabs.length > 0;
  const activeTab = visibleTabs.some((tab) => tab.key === active) ? active : visibleTabs[0]?.key;

  return (
    <AppShell
      requiredPermission={teamLeader ? "corrections.team_view" : "requests.view"}
      alternativePermissions={teamLeader
        ? ["corrections.view_own", "corrections.all_view", "profile_corrections.team_view", "profile_corrections.all_view", "report_approvals.team_view", "report_approvals.all_view"]
        : ["profile_corrections.all_view", "report_approvals.all_view"]}
    >
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Requests</h1>
          <p className="text-sm text-ink-500">Review attendance, profile, and report approvals.</p>
        </div>

        {!hasPageAccess ? <p className="text-sm text-ink-500">No request types are available to you.</p> : <>
        <div className="flex w-fit flex-wrap rounded-lg border border-ink-200 bg-white p-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === tab.key ? "bg-brand-600 text-white" : "text-ink-600"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "corrections" && canViewCorrections && <CorrectionsContent />}
        {activeTab === "profile-edit" && canViewProfileCorrections && <ProfileEditRequestsContent />}
        {activeTab === "report-approvals" && canViewReportApprovals && <AdminReportsContent compact />}
        </>}
      </div>
    </AppShell>
  );
}
