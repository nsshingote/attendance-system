"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import api, { getErrorMessage } from "@/lib/api";
import { refreshPermissions } from "@/lib/permissions";

type Permission = {
  id: number;
  key: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
};
type Role = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  is_active: boolean;
  permission_ids: number[];
};
type User = { id: number; name: string; email?: string | null; mobile: string; status: string; role?: string | null; role_key?: string | null };
type Effect = "allow" | "deny";
type Override = { permission_id: number; effect: Effect };

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignmentType, setAssignmentType] = useState<"role" | "user">("role");
  const [target, setTarget] = useState("");
  const [rolePermissionIds, setRolePermissionIds] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Effect>>({});
  const [dirtyOverrides, setDirtyOverrides] = useState<Set<number>>(new Set());
  const [newRole, setNewRole] = useState({ name: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeRoles = useMemo(() => roles.filter((role) => role.is_active), [roles]);
  const grouped = useMemo(() => permissions.reduce<Record<string, Permission[]>>((groups, permission) => {
    (groups[permission.module] ||= []).push(permission);
    return groups;
  }, {}), [permissions]);

  const loadTargets = useCallback(async () => {
    try {
      const [permissionResponse, roleResponse, userResponse] = await Promise.all([
        api.get<Permission[]>("/permissions/"),
        api.get<Role[]>("/permissions/roles"),
        api.get<User[]>("/users/?status=active"),
      ]);
      setPermissions(permissionResponse.data);
      setRoles(roleResponse.data);
      setUsers(userResponse.data.filter((user) => user.status === "active"));
      const available = assignmentType === "role"
        ? roleResponse.data.filter((role) => role.is_active)
        : userResponse.data.filter((user) => user.status === "active");
      if (!available.some((item) => String(item.id) === target)) {
        setTarget(available[0] ? String(available[0].id) : "");
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [assignmentType, target]);

  const loadAssignment = useCallback(async () => {
    if (!target) {
      setRolePermissionIds([]);
      setOverrides({});
      setDirtyOverrides(new Set());
      return;
    }
    try {
      if (assignmentType === "role") {
        const role = roles.find((item) => String(item.id) === target);
        setRolePermissionIds(role?.permission_ids || []);
      } else {
        const { data } = await api.get<Override[]>(`/permissions/users/${target}/overrides`);
        setOverrides(Object.fromEntries(data.map((item) => [item.permission_id, item.effect])));
        setDirtyOverrides(new Set());
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [assignmentType, roles, target]);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  useEffect(() => { void loadAssignment(); }, [loadAssignment]);

  const changeType = (type: "role" | "user") => {
    setAssignmentType(type);
    setTarget("");
    setRolePermissionIds([]);
    setOverrides({});
    setDirtyOverrides(new Set());
  };

  const toggleRolePermission = (id: number) => {
    setRolePermissionIds((current) => current.includes(id)
      ? current.filter((permissionId) => permissionId !== id)
      : [...current, id]);
  };

  const setUserEffect = (id: number, value: string) => {
    setOverrides((current) => {
      const next = { ...current };
      if (value === "inherit") delete next[id];
      else next[id] = value as Effect;
      return next;
    });
    setDirtyOverrides((current) => new Set(current).add(id));
  };

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      if (assignmentType === "role") {
        await api.put(`/permissions/role/${activeRoles.find((role) => String(role.id) === target)?.key}`, {
          permission_ids: rolePermissionIds,
        });
        toast.success("Role permissions updated");
      } else {
        await Promise.all([...dirtyOverrides].map((permissionId) => {
          const effect = overrides[permissionId];
          return effect
            ? api.put(`/permissions/users/${target}/overrides`, { permission_id: permissionId, effect })
            : api.delete(`/permissions/users/${target}/overrides/${permissionId}`);
        }));
        setDirtyOverrides(new Set());
        toast.success("User permission overrides updated");
      }
      await loadTargets();
      await loadAssignment();
      await refreshPermissions();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newRole.name.trim()) return;
    try {
      await api.post("/permissions/roles", newRole);
      setNewRole({ name: "" });
      await loadTargets();
      toast.success("Role created");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const deactivateRole = async (role: Role) => {
    if (role.is_system || !confirm(`Deactivate ${role.name}?`)) return;
    try {
      await api.put(`/permissions/roles/${role.key}`, { is_active: false });
      await loadTargets();
      toast.success("Role deactivated");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const selectedTarget = assignmentType === "role"
    ? activeRoles.find((role) => String(role.id) === target)?.name
    : users.find((user) => String(user.id) === target)?.name;

  return (
    <AppShell allowedRoles={["superadmin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Permissions</h1>
            <p className="text-sm text-ink-500">Assign every master permission to a role or an individual user.</p>
          </div>
          <button onClick={save} disabled={saving || loading || !target} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>

        <section className="rounded-xl border border-ink-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-ink-700">Assignment type
              <select value={assignmentType} onChange={(event) => changeType(event.target.value as "role" | "user")} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2">
                <option value="role">Role</option>
                <option value="user">Individual User</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink-700">Target
              <select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2">
                <option value="">Select {assignmentType === "role" ? "a role" : "a user"}</option>
                {assignmentType === "role"
                  ? activeRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)
                  : users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.role_key || user.role || "Unknown role"}</option>)}
              </select>
            </label>
          </div>
          {selectedTarget && <p className="mt-3 text-xs text-ink-500">Editing permissions for {selectedTarget}.</p>}
        </section>
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white p-4">
          <input value={newRole.name} onChange={(event) => setNewRole({ ...newRole, name: event.target.value })} placeholder="Role name" className="rounded-lg border border-ink-200 px-3 py-2 text-sm" />
          <button onClick={createRole} className="rounded-lg bg-ink-800 px-3 py-2 text-sm font-semibold text-white">Create role</button>
          {activeRoles.filter((role) => !role.is_system).map((role) => (
            <button key={role.key} onClick={() => deactivateRole(role)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Deactivate {role.name}</button>
          ))}
        </section>

        {loading ? <Loading /> : (
          <section className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            <div className="table-wrapper">
              <table className="w-full min-w:760px text-left text-sm">
                <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Module</th>
                    <th className="px-5 py-3 font-semibold">Permission</th>
                    <th className="px-5 py-3 font-semibold">Key</th>
                    <th className="px-5 py-3 text-center font-semibold">{assignmentType === "role" ? "Allowed" : "User override"}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(grouped).map(([module, items]) => items.map((permission, index) => (
                    <tr key={permission.id} className="border-t border-ink-100 hover:bg-ink-50">
                      <td className="px-5 py-3 font-medium text-ink-800">{index === 0 ? module : ""}</td>
                      <td className="px-5 py-3 font-medium text-ink-800">{permission.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-ink-500">{permission.key}</td>
                      <td className="px-5 py-3 text-center">
                        {assignmentType === "role" ? (
                          <input type="checkbox" aria-label={`Allow ${permission.name}`} checked={rolePermissionIds.includes(permission.id)} disabled={!target} onChange={() => toggleRolePermission(permission.id)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                        ) : (
                          <select aria-label={`${permission.name} override`} value={overrides[permission.id] || "inherit"} disabled={!target} onChange={(event) => setUserEffect(permission.id, event.target.value)} className="rounded border border-ink-200 px-2 py-1 text-sm">
                            <option value="inherit">Inherit role</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
