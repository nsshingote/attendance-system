"use client";

/**
 * components/Leave/LeaveTable.tsx
 * Leave requests table. Shows Approve/Reject actions when `canDecide` is
 * true (Admin/SuperAdmin viewing the "All Leave Requests" list). Admins
 * can also override the category to "Privilege" via onChangeCategory.
 * On mobile, each row becomes a card instead of a table.
 */

import { format, parseISO } from "date-fns";
import { Check, X } from "lucide-react";
import Badge from "@/components/Common/Badge";

export interface LeaveRow {
  id: number;
  user_id: number;
  user_name?: string;
  leave_type_name?: string;
  from_date: string;
  to_date: string;
  total_days: number | null;
  reason: string | null;
  status: string;
  leave_category: string;
}

interface LeaveTableProps {
  requests: LeaveRow[];
  canDecide?: boolean;
  onDecide?: (id: number, status: "Approved" | "Rejected") => void;
  onChangeCategory?: (id: number) => void;
}

const CATEGORY_CLASS: Record<string, string> = {
  Paid: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200",
  Carried: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Unpaid: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
};

function LeaveCard({ request, canDecide, onDecide, onChangeCategory }: any) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm space-y-2">
      {/* Employee name (for admin view) */}
      {canDecide && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink-900">{request.user_name ?? `User #${request.user_id}`}</span>
        </div>
      )}

      {/* Date range */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-500">From:</span>
        <span className="font-medium text-ink-700">{format(parseISO(request.from_date), "dd MMM yyyy")}</span>
        <span className="text-ink-400">→</span>
        <span className="text-ink-500">To:</span>
        <span className="font-medium text-ink-700">{format(parseISO(request.to_date), "dd MMM yyyy")}</span>
      </div>

      {/* Days + Category + Status */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-500">Days:</span>
        <span className="text-sm font-medium text-ink-700">{request.total_days ?? "—"}</span>
        
        <span className="w-px h-4 bg-ink-200" />
        
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            CATEGORY_CLASS[request.leave_category] ?? "bg-ink-100 text-ink-600"
          }`}
        >
          {request.leave_category}
        </span>
        
        <Badge status={request.status} />
      </div>

      {/* Reason */}
      {request.reason && (
        <div className="text-sm text-ink-600">
          <span className="text-ink-500">Reason:</span> {request.reason}
        </div>
      )}

      {/* Actions */}
      {canDecide && (
        <div className="flex items-center gap-2 pt-2 border-t border-ink-100">
          {request.status === "Pending" && (
            <>
              <button
                onClick={() => onDecide?.(request.id, "Approved")}
                className="flex-1 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
              >
                ✅ Approve
              </button>
              <button
                onClick={() => onDecide?.(request.id, "Rejected")}
                className="flex-1 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                ❌ Reject
              </button>
            </>
          )}
          {request.leave_category !== "Privilege" && (
            <button
              onClick={() => onChangeCategory?.(request.id)}
              className="rounded-md bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
            >
              ⭐ Privilege
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeaveTable({ requests, canDecide, onDecide, onChangeCategory }: LeaveTableProps) {
  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No leave requests found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: Table view */}
      <div className="hidden md:block rounded-xl border border-ink-200 bg-white shadow-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              {canDecide && <th className="px-4 py-3 font-medium">Employee</th>}
              <th className="px-4 py-3 font-medium">From</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Days</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {canDecide && <th className="px-4 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {requests.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50/60">
                {canDecide && (
                  <td className="px-4 py-3 font-medium text-ink-900 whitespace-nowrap">
                    {r.user_name ?? `User #${r.user_id}`}
                  </td>
                )}
                <td className="px-4 py-3 text-ink-700 whitespace-nowrap">
                  {format(parseISO(r.from_date), "dd MMM yyyy")}
                </td>
                <td className="px-4 py-3 text-ink-700 whitespace-nowrap">
                  {format(parseISO(r.to_date), "dd MMM yyyy")}
                </td>
                <td className="px-4 py-3 text-ink-700">{r.total_days ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      CATEGORY_CLASS[r.leave_category] ?? "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {r.leave_category}
                  </span>
                </td>
                <td className="max-w-120px table-cell-clamp px-4 py-3 text-ink-600" title={r.reason ?? ""}>
                  {r.reason ?? "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Badge status={r.status} />
                </td>
                {canDecide && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex justify-end gap-1.5">
                      {r.status === "Pending" && (
                        <>
                          <button
                            onClick={() => onDecide?.(r.id, "Approved")}
                            className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                            aria-label="Approve"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            onClick={() => onDecide?.(r.id, "Rejected")}
                            className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                            aria-label="Reject"
                          >
                            <X size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: Card view */}
      <div className="md:hidden space-y-3">
        {requests.map((r) => (
          <LeaveCard
            key={r.id}
            request={r}
            canDecide={canDecide}
            onDecide={onDecide}
            onChangeCategory={onChangeCategory}
          />
        ))}
      </div>
    </>
  );
}
