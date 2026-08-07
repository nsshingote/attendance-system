"use client";

/**
 * app/activity-logs/page.tsx
 * Admin/SuperAdmin: read-only audit trail of user activity. Can be
 * filtered to a specific employee via the dropdown, or left on "All
 * Users" to see everyone's activity together.
 */

import { useEffect, useState, useCallback } from "react";
import { formatInTimeZone } from "date-fns-tz";
import toast from "react-hot-toast";
import { parseISTDateTime } from "@/lib/date";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";

interface ActivityLog {
  id: number;
  user_id: number;
  activity: string;
  created_at: string;
}

interface UserOption {
  id: number;
  name: string;
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<UserOption[]>("/users/")
      .then(({ data }) => setUsers(data))
      .catch(() => {});
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ActivityLog[]>("/activity-logs/", {
        params: {
          limit: 200,
          employee_ids: selectedUserIds.length ? selectedUserIds : undefined,
        },
        paramsSerializer: { indexes: null },
      });
      setLogs(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [selectedUserIds]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const userNameById = (id: number) => users.find((u) => u.id === id)?.name ?? `User #${id}`;

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Activity Logs</h1>
            <p className="text-sm text-ink-500">
              {selectedUserIds.length ? `Activity for ${selectedUserIds.length === 1 ? userNameById(selectedUserIds[0]) : `${selectedUserIds.length} employees`}` : "Recent system activity across all users"}
            </p>
          </div>

          <EmployeeMultiSelect employees={users} value={selectedUserIds} onChange={setSelectedUserIds} allLabel="All Users" />
        </div>

        {loading ? (
          <Loading />
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No activity recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <ul className="divide-y divide-ink-100">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-ink-50/60">
                  <div>
                    <span className="font-medium text-ink-900">{userNameById(log.user_id)}</span>{" "}
                    <span className="text-ink-600">{log.activity}</span>
                  </div>
                  <span className="font-mono text-xs text-ink-400">
                    {(() => {
                      const date = parseISTDateTime(log.created_at);
                      return date ? formatInTimeZone(date, "Asia/Kolkata", "dd MMM yyyy, hh:mm a") : log.created_at;
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
