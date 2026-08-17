"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";

const tabs = [
  { label: "Attendance Corrections", href: "/corrections" },
  { label: "Profile Corrections", href: "/profile-edit-requests" },
  { label: "Report Approvals", href: "/admin-reports" },
] as const;

export default function RequestsPage() {
  const [active, setActive] = useState(0);
  return <AppShell allowedRoles={["admin", "superadmin"]}><div className="mx-auto max-w-7xl space-y-5"><div><h1 className="text-xl font-semibold">Requests</h1><p className="text-sm text-ink-500">Review attendance, profile, and report approvals.</p></div><div className="flex w-fit rounded-lg border border-ink-200 bg-white p-1">{tabs.map((tab, index) => <button key={tab.href} onClick={() => setActive(index)} className={`rounded-md px-4 py-2 text-sm font-medium ${active === index ? "bg-brand-600 text-white" : "text-ink-600"}`}>{tab.label}</button>)}</div><iframe title={tabs[active].label} src={tabs[active].href} className="h-[calc(100vh-14rem)] w-full rounded-xl border border-ink-200 bg-white" /></div></AppShell>;
}
