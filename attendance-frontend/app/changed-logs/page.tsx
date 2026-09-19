"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";
import TeamMultiSelect from "@/components/Common/TeamMultiSelect";
import api, { getErrorMessage } from "@/lib/api";
import { parseISTDateTime } from "@/lib/date";
import { formatInTimeZone } from "date-fns-tz";

type ChangedLog = {
  id: number;
  employee_id: number | null;
  employee_name: string | null;
  changed_by_name: string | null;
  category: string;
  item_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

export default function ChangedLogsPage() {
  const [logs, setLogs] = useState<ChangedLog[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ChangedLog[]>("/changed-logs/", {
        params: { employee_ids: selected.length ? selected : undefined, team_ids: selectedTeamIds.length ? selectedTeamIds : undefined },
        paramsSerializer: { indexes: null },
      });
      setLogs(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get<{ id: number; name: string }[]>("/users/").then(({ data }) => setUsers(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [selected, selectedTeamIds]);

  return (
    <AppShell requiredPermission="changed_logs.view">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Changed Logs</h1>
            <p className="text-sm text-ink-500">Old and new values for approved profile and document changes.</p>
          </div>
          <EmployeeMultiSelect employees={users} value={selected} onChange={setSelected} allLabel="All Users" />
          <TeamMultiSelect value={selectedTeamIds} onChange={(ids) => setSelectedTeamIds(ids)} />
        </div>
        {loading ? <Loading /> : logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center text-sm text-ink-500">No changes recorded yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="divide-y divide-ink-100">
              {logs.map((log) => (
                <div key={log.id} className="grid gap-2 px-4 py-4 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
                  <div>
                    <p className="text-xs font-medium text-ink-500">Employee whose data changed</p>
                    <p className="font-semibold text-ink-900">{log.employee_name ?? "Unknown employee"}</p>
                    <p className="text-xs text-ink-500">{log.category} · {log.item_name}</p>
                  </div>
                  <div><p className="text-xs font-medium text-ink-500">Old value</p><p className="break-words text-sm text-red-700">{log.old_value || "—"}</p></div>
                  <div><p className="text-xs font-medium text-ink-500">New value</p><p className="break-words text-sm text-green-700">{log.new_value || "—"}</p></div>
                  <div className="text-xs text-ink-400">
                    <span>Changed by {log.changed_by_name ?? "Unknown"}</span>
                    <br />
                    {(() => { const date = parseISTDateTime(log.created_at); return date ? formatInTimeZone(date, "Asia/Kolkata", "dd MMM yyyy, hh:mm a") : log.created_at; })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
