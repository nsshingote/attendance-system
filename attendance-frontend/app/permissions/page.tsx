"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import api, { getErrorMessage } from "@/lib/api";

type Permission = {
  id: number;
  key: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
};

const moduleLabels: Record<string, string> = {
  attendance: "Attendance",
  reports: "Reports",
  leave: "Leave",
  corrections: "Corrections",
  employees: "Employees",
  kundli: "Kundli",
  dashboard: "Dashboard",
  teams: "Teams",
  resources: "Resources",
  report_structure: "Report Structure",
  departments: "Manage Departments",
  requests: "Requests",
  holidays: "Holidays",
  monthly_summary: "Monthly Summary",
  device_requests: "Device Requests",
  notification_emails: "Notification Emails",
  office_ips: "Office IPs",
  activity_logs: "Activity Logs",
  feedback: "Feedback",
  settings: "Settings",
  recycle_bin: "Recycle Bin",
  changed_logs: "Changed Logs",
  employee_documents: "Employee Documents",
};

const featureLabels: Record<string, string> = {
  letters: "Letters",
  salary_slips: "Salary Slips",
  letter_templates: "Letter Templates",
};

type ConfigurableRole = "admin" | "team_leader";

const teamLeaderPermissionKeys = new Set([
  "dashboard.view",
  "attendance.view_own", "attendance.team_view", "attendance.all_view",
  "reports.team_view", "reports.all_view",
  "leave.view_own", "leave.team_view", "leave.all_view", "leave.approve",
  "corrections.view_own", "corrections.team_view", "corrections.all_view", "corrections.approve",
  "kundli.team_view", "kundli.create", "kundli.edit", "kundli.delete",
  "employees.view_own", "employees.team_view", "employees.all_view",
]);

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<ConfigurableRole>("admin");

  const grouped = useMemo(() => permissions
    .filter((permission) => role === "admin"
      ? permission.key !== "permissions.manage"
      : teamLeaderPermissionKeys.has(permission.key))
    .reduce<Record<string, Permission[]>>((result, permission) => {
    const moduleKey = permission.module.split(".")[0];
    (result[moduleKey] ||= []).push(permission);
    return result;
  }, {}), [permissions, role]);

  const load = useCallback(async () => {
    try {
      const [allResponse, assignedResponse] = await Promise.all([
        api.get<Permission[]>("/permissions/"),
        api.get<number[]>(`/permissions/role/${role}`),
      ]);
      setPermissions(allResponse.data);
      const dashboard = allResponse.data.find((permission) => permission.key === "dashboard.view");
      setSelected(dashboard && !assignedResponse.data.includes(dashboard.id)
        ? [...assignedResponse.data, dashboard.id]
        : assignedResponse.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [role]);

  // Loading the selected role is an external API synchronization.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const toggle = (permission: Permission) => {
    if (permission.key === "dashboard.view") return;
    setSelected((current) => current.includes(permission.id)
      ? current.filter((id) => id !== permission.id)
      : [...current, permission.id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/permissions/role/${role}`, { permission_ids: selected });
      toast.success(`${role === "admin" ? "Admin" : "Team Leader"} permissions updated`);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell allowedRoles={["superadmin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Role Permissions</h1>
            <p className="text-sm text-ink-500">Configure detailed Admin and Team Leader access. Salary Slip access is sensitive.</p>
          </div>
          <button onClick={save} disabled={saving || loading} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
        <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-1">
          {(["admin", "team_leader"] as ConfigurableRole[]).map((option) => (
            <button key={option} onClick={() => setRole(option)} className={`rounded-md px-4 py-2 text-sm font-medium ${role === option ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"}`}>
              {option === "admin" ? "Admin" : "Team Leader"}
            </button>
          ))}
        </div>
        {loading ? <Loading /> : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([module, items]) => (
              <section key={module} className="rounded-xl border border-ink-200 bg-white p-5">
                <h2 className="mb-1 font-semibold text-ink-900">{moduleLabels[module] || module}</h2>
                {module === "employee_documents" && <p className="mb-3 text-xs text-amber-700">Salary Slips contain sensitive compensation data and are enforced by the backend.</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((permission) => (
                    <label key={permission.id} className="flex items-start gap-3 rounded-lg border border-ink-100 p-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(permission.id)}
                        disabled={permission.key === "dashboard.view"}
                        onChange={() => toggle(permission)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink-800">{permission.module.includes(".") ? `${featureLabels[permission.module.split(".")[1]] || permission.module.split(".")[1]} · ${permission.name}` : permission.name}</span>
                        <span className="block text-xs text-ink-500">{permission.key}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
