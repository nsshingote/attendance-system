"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RotateCcw, Trash2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";

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
    <AppShell requiredPermission="recycle_bin.view">
      <div className="space-y-5">
        <div><h1 className="text-2xl font-bold text-ink-900">Recycle Bin</h1>
          <p className="text-sm text-ink-500">Deleted records are retained for 30 days.</p></div>
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {loading ? <p className="p-6 text-ink-500">Loading…</p> :
            entries.length === 0 ? <p className="p-6 text-ink-500">Recycle Bin is empty.</p> :
            <div className="divide-y divide-ink-100">{entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0"><p className="break-words font-medium text-ink-900">{entry.label}</p>
                  <p className="text-xs text-ink-500">
                    {entry.table_name} · deleted by {entry.deleted_by ?? "System"} · {formatStoredUtc(entry.deleted_at)} · expires {formatStoredUtc(entry.expires_at, false)}
                  </p></div>
                <div className="flex shrink-0 gap-2"><button onClick={() => restore(entry.id)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100" aria-label={`Restore ${entry.label}`} title="Restore"><RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden="true" /></button>
                  <button onClick={() => destroy(entry.id)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-red-50 text-red-700 hover:bg-red-100" aria-label={`Permanently delete ${entry.label}`} title="Permanently delete"><Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" /></button></div>
              </div>
            ))}</div>}
        </div>
      </div>
    </AppShell>
  );
}
