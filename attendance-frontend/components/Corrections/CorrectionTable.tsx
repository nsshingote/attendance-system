"use client";

/**
 * components/Corrections/CorrectionTable.tsx
 * Attendance correction requests table with Approve/Reject for admins.
 * Shows check-in and check-out corrections in separate columns, each
 * with its own remark, since a request may correct one or both.
 *
 * Timestamps are stored in the database as IST (without timezone),
 * so they are displayed as-is without conversion.
 */

import { Check, X } from "lucide-react";
import Badge from "@/components/Common/Badge";
import { parseISTDateTime } from "@/lib/date";

export interface CorrectionRow {
  id: number;
  attendance_id: number;
  requested_by: number;
  requester_name?: string;
  reason?: string | null;
  old_check_in: string | null;
  new_check_in: string | null;
  old_check_out: string | null;
  new_check_out: string | null;
  status: string;
  created_at: string;
}

interface CorrectionTableProps {
  corrections: CorrectionRow[];
  canDecide?: boolean;
  onDecide?: (id: number, status: "Approved" | "Rejected") => void;
}

function formatISTDateTime(isoString: string | null): string {
  if (!isoString) return "Not recorded";
  const date = parseISTDateTime(isoString);
  if (!date) return isoString || "Not recorded";
  const datePart = date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  const timePart = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

export default function CorrectionTable({ corrections, canDecide, onDecide }: CorrectionTableProps) {
  if (corrections.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No correction requests found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-card">
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-180 text-left text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              {canDecide && <th className="px-3 py-2.5 font-medium">Employee</th>}
              <th className="px-3 py-2.5 font-medium">Check-In Change</th>
              <th className="px-3 py-2.5 font-medium">Check-Out Change</th>
              <th className="px-3 py-2.5 font-medium">Reason</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              {canDecide && <th className="px-3 py-2.5 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {corrections.map((c) => (
              <tr key={c.id} className="hover:bg-ink-50/60">
                {canDecide && (
                  <td className="px-3 py-2 font-medium text-ink-900">
                    {c.requester_name ?? `User #${c.requested_by}`}
                  </td>
                )}
                <td className="px-3 py-2 text-[11px] text-ink-600">
                  {c.new_check_in ? (
                    <div className="space-y-0.5">
                      <p className="font-mono leading-4">
                        <span>{formatISTDateTime(c.old_check_in)}</span>
                        <span className="mx-1 text-ink-400">→</span>
                        <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_in)}</span>
                      </p>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-ink-600">
                  {c.new_check_out ? (
                    <div className="space-y-0.5">
                      <p className="font-mono leading-4">
                        <span>{formatISTDateTime(c.old_check_out)}</span>
                        <span className="mx-1 text-ink-400">→</span>
                        <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_out)}</span>
                      </p>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-48 truncate px-3 py-2 text-[11px] text-ink-600" title={c.reason ?? ""}>
                  {c.reason ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge status={c.status} />
                </td>
                {canDecide && (
                  <td className="px-3 py-2">
                    {c.status === "Pending" && (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => onDecide?.(c.id, "Approved")}
                          className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                          aria-label="Approve"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          onClick={() => onDecide?.(c.id, "Rejected")}
                          className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                          aria-label="Reject"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 p-2 sm:hidden">
        {corrections.map((c) => (
          <div key={c.id} className="rounded-lg border border-ink-200 bg-white p-2.5 shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2">
              <div className="min-w-0">
                {canDecide && (
                  <p className="text-sm font-semibold text-ink-900">
                    {c.requester_name ?? `User #${c.requested_by}`}
                  </p>
                )}
                <p className="text-[11px] text-ink-500">{c.status}</p>
              </div>
              <Badge status={c.status} />
            </div>

            <div className="mt-2 space-y-2 text-xs text-ink-700">
              {c.new_check_in && (
                <div className="rounded-md bg-ink-50 px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Check-In</p>
                  <p className="mt-1 font-mono leading-4">
                    <span>{formatISTDateTime(c.old_check_in)}</span>
                    <span className="mx-1 text-ink-400">→</span>
                    <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_in)}</span>
                  </p>
                </div>
              )}

              {c.new_check_out && (
                <div className="rounded-md bg-ink-50 px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Check-Out</p>
                  <p className="mt-1 font-mono leading-4">
                    <span>{formatISTDateTime(c.old_check_out)}</span>
                    <span className="mx-1 text-ink-400">→</span>
                    <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_out)}</span>
                  </p>
                </div>
              )}

              <div className="rounded-md bg-ink-50 px-2 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Reason</p>
                <p className="mt-1 text-xs text-ink-700">{c.reason ?? "—"}</p>
              </div>
            </div>

            {canDecide && c.status === "Pending" && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onDecide?.(c.id, "Approved")}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-green-50 px-2.5 py-2 text-xs font-semibold text-green-700 hover:bg-green-100"
                  aria-label="Approve"
                >
                  <Check size={14} /> Approve
                </button>
                <button
                  onClick={() => onDecide?.(c.id, "Rejected")}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                  aria-label="Reject"
                >
                  <X size={14} /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
