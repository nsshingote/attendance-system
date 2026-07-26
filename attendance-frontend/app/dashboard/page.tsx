"use client";

/**
 * app/dashboard/page.tsx
 * Renders AdminDashboard or EmployeeDashboard depending on the logged-in role.
 */

import AppShell from "@/components/AppShell";
import AdminDashboard from "@/components/Dashboard/AdminDashboard";
import EmployeeDashboard from "@/components/Dashboard/EmployeeDashboard";
import { getSession, isAdmin } from "@/lib/auth";

export default function DashboardPage() {
  const session = getSession();

  return (
    <AppShell>
      <div className="w-full max-w-full overflow-x-hidden">
        <div className="pb-20 md:pb-6">
          {isAdmin(session?.role) ? <AdminDashboard /> : <EmployeeDashboard />}
        </div>
      </div>
    </AppShell>
  );
}