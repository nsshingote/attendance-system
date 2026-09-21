"use client";

/**
 * app/dashboard/page.tsx
 * Renders AdminDashboard or EmployeeDashboard depending on the logged-in role.
 */

import AppShell from "@/components/AppShell";
import AdminDashboard from "@/components/Dashboard/AdminDashboard";
import EmployeeDashboard from "@/components/Dashboard/EmployeeDashboard";
import { getSession, isAdmin } from "@/lib/auth";
import { hasPermission, usePermissions } from "@/lib/permissions";

export default function DashboardPage() {
  const session = getSession();
  const { permissions } = usePermissions();
  const adminDashboard = isAdmin(session?.role) || hasPermission(permissions, "attendance.all_view");

  return (
    <AppShell>
      <div className="w-full max-w-full overflow-x-hidden">
        <div className="pb-20 md:pb-6">
          {adminDashboard ? <AdminDashboard /> : <EmployeeDashboard />}
        </div>
      </div>
    </AppShell>
  );
}