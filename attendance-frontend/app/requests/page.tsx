"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import { CorrectionsContent } from "@/app/corrections/page";
import { ProfileEditRequestsContent } from "@/app/profile-edit-requests/page";
import { AdminReportsContent } from "@/app/admin-reports/page";

const tabs = [
  { label: "Attendance Corrections", key: "corrections" },
  { label: "Profile Corrections", key: "profile-edit" },
  { label: "Report Approvals", key: "report-approvals" },
] as const;

export default function RequestsPage() {
  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("corrections");

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Requests</h1>
          <p className="text-sm text-ink-500">Review attendance, profile, and report approvals.</p>
        </div>

        <div className="flex w-fit flex-wrap rounded-lg border border-ink-200 bg-white p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${active === tab.key ? "bg-brand-600 text-white" : "text-ink-600"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {active === "corrections" && <CorrectionsContent />}
        {active === "profile-edit" && <ProfileEditRequestsContent />}
        {active === "report-approvals" && <AdminReportsContent compact />}
      </div>
    </AppShell>
  );
}
