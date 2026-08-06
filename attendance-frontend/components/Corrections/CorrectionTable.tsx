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
  if (!isoString) return "—";
  const date = parseISTDateTime(isoString);
  if (!date) return isoString || "—";
  const datePart = date.toLocaleDateString("en-IN", {
    day: "2-digit",
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
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            {canDecide && <th className="px-4 py-3 font-medium">Employee</th>}
            <th className="px-4 py-3 font-medium">Check-In Change</th>
            <th className="px-4 py-3 font-medium">Check-Out Change</th>
            <th className="px-4 py-3 font-medium">Correction Reason</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {canDecide && <th className="px-4 py-3 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {corrections.map((c) => (
            <tr key={c.id} className="hover:bg-ink-50/60">
              {canDecide && (
                <td className="px-4 py-3 font-medium text-ink-900">
                  {c.requester_name ?? `User #${c.requested_by}`}
                </td>
              )}
              <td className="px-4 py-3 text-xs text-ink-600">
                {c.new_check_in ? (
                  <div className="space-y-0.5">
                    <p className="font-mono">
                      {c.old_check_in ? formatISTDateTime(c.old_check_in) : "—"}
                      {" → "}
                      <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_in)}</span>
                    </p>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-xs text-ink-600">
                {c.new_check_out ? (
                  <div className="space-y-0.5">
                    <p className="font-mono">
                      {c.old_check_out ? formatISTDateTime(c.old_check_out) : "—"}
                      {" → "}
                      <span className="font-semibold text-ink-900">{formatISTDateTime(c.new_check_out)}</span>
                    </p>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 max-w-240px truncate text-xs text-ink-600">
                {c.reason ?? "—"}
              </td>
              <td className="px-4 py-3">
                <Badge status={c.status} />
              </td>
              {canDecide && (
                <td className="px-4 py-3">
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
  );
}