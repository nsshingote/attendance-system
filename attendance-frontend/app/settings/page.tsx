"use client";

/**
 * app/settings/page.tsx
 * Admin/SuperAdmin: company-wide attendance settings.
 */

import AppShell from "@/components/AppShell";
import CompanySettings from "@/components/Settings/CompanySettings";

export default function SettingsPage() {
  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Company Settings</h1>
          <p className="text-sm text-ink-500">Office hours, grace period, and weekly off day</p>
        </div>
        <CompanySettings />
      </div>
    </AppShell>
  );
}