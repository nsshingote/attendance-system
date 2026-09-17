"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RotateCcw, Trash2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { Role } from "@/lib/auth";

type Entry = {
  id: number;
  table_name: string;
  record_id: number;
  label: string;
  deleted_by: string | null;
  deleted_at: string;
  expires_at: string;
};

function formatStoredUtc(value: string, includeTime = true) {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  return new Date(normalized).toLocaleString([], includeTime ? undefined : { dateStyle: "short" });
}

export default function RecycleBinPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { setEntries((await api.get<Entry[]>("/recycle-bin/")).data); }
    catch (error) { toast.error(getErrorMessage(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const restore = async (id: number) => {
    try { await api.post(`/recycle-bin/${id}/restore`); toast.success("Record restored"); load(); }
    catch (error) { toast.error(getErrorMessage(error)); }
  };
  const destroy = async (id: number) => {
    if (!confirm("Permanently delete this record? This cannot be undone.")) return;
    try { await api.delete(`/recycle-bin/${id}`); toast.success("Permanently deleted"); load(); }
    catch (error) { toast.error(getErrorMessage(error)); }
  };
  return (
    <AppShell allowedRoles={["admin", "superadmin"] as Role[]}>
      <div className="space-y-5">
        <div><h1 className="text-2xl font-bold text-ink-900">Recycle Bin</h1>
          <p className="text-sm text-ink-500">Deleted records are retained for 30 days.</p></div>
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {loading ? <p className="p-6 text-ink-500">Loading…</p> :
            entries.length === 0 ? <p className="p-6 text-ink-500">Recycle Bin is empty.</p> :
            <div className="divide-y divide-ink-100">{entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 p-4">
                <div><p className="font-medium text-ink-900">{entry.label}</p>
                  <p className="text-xs text-ink-500">
                    {entry.table_name} · deleted by {entry.deleted_by ?? "System"} · {formatStoredUtc(entry.deleted_at)} · expires {formatStoredUtc(entry.expires_at, false)}
                  </p></div>
                <div className="flex gap-2"><button onClick={() => restore(entry.id)} className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700"><RotateCcw size={15} /></button>
                  <button onClick={() => destroy(entry.id)} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><Trash2 size={15} /></button></div>
              </div>
            ))}</div>}
        </div>
      </div>
    </AppShell>
  );
}
