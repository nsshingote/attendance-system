"use client";

import { useEffect, useMemo, useState } from "react";
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
};

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => permissions.reduce<Record<string, Permission[]>>((result, permission) => {
    (result[permission.module] ||= []).push(permission);
    return result;
  }, {}), [permissions]);

  const load = async () => {
    try {
      const [allResponse, assignedResponse] = await Promise.all([
        api.get<Permission[]>("/permissions/"),
        api.get<number[]>("/permissions/role/team_leader"),
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
  };

  useEffect(() => { load(); }, []);

  const toggle = (permission: Permission) => {
    if (permission.key === "dashboard.view") return;
    setSelected((current) => current.includes(permission.id)
      ? current.filter((id) => id !== permission.id)
      : [...current, permission.id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/permissions/role/team_leader", { permission_ids: selected });
      toast.success("Team Leader permissions updated");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Team Leader Permissions</h1>
            <p className="text-sm text-ink-500">Manage the existing permissions assigned to the Team Leader role.</p>
          </div>
          <button onClick={save} disabled={saving || loading} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
        {loading ? <Loading /> : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([module, items]) => (
              <section key={module} className="rounded-xl border border-ink-200 bg-white p-5">
                <h2 className="mb-3 font-semibold text-ink-900">{moduleLabels[module] || module}</h2>
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
                        <span className="block text-sm font-medium text-ink-800">{permission.name}</span>
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
