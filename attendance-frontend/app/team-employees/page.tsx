"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import UserTable, { UserRow } from "@/components/Users/UserTable";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { hasPermission, usePermissions } from "@/lib/permissions";

export default function TeamEmployeesPage() {
  const session = getSession();
  const { permissions } = usePermissions();
  const allowed = session?.role === "team_leader" &&
    hasPermission(permissions, "employees.team_view");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    api.get<UserRow[]>("/users/")
      .then(({ data }) => setUsers(data))
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [allowed]);

  return (
    <AppShell allowedRoles={["team_leader"]} requiredPermission="employees.team_view">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Team Employees</h1>
          <p className="text-sm text-ink-500">Employees in your active team</p>
        </div>
        {loading ? <Loading /> : (
          <UserTable
            users={users}
            onEdit={() => undefined}
            onResetDevice={() => undefined}
            onToggleStatus={() => undefined}
            readOnly
          />
        )}
      </div>
    </AppShell>
  );
}
