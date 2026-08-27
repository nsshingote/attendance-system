"use client";

/**
 * components/Leave/LeaveTable.tsx
 * Leave requests table. Shows Approve/Reject actions when `canDecide` is
 * true (Admin/SuperAdmin viewing the "All Leave Requests" list). Admins
 * can also override the category to "Privilege" via onChangeCategory.
 * The table stays compact and horizontally scrollable on mobile.
 */

import { format, parseISO } from "date-fns";
import { Check, X } from "lucide-react";
import Badge from "@/components/Common/Badge";
import ExpandableText from "@/components/Common/ExpandableText";

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
  allocation_summary?: string;
  allocations?: { allocation_date: string; leave_category: string }[];
}

interface LeaveTableProps {
  requests: LeaveRow[];
  canDecide?: boolean;
  onDecide?: (id: number, status: "Approved" | "Rejected") => void;
  onChangeCategory?: (id: number) => void;
  onEditAllocations?: (id: number) => void;
}

const CATEGORY_CLASS: Record<string, string> = {
  Paid: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200",
  Carried: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Unpaid: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  Privilege: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
  Mixed: "bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200",
};

export default function LeaveTable({ requests, canDecide, onDecide, onChangeCategory, onEditAllocations }: LeaveTableProps) {
  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No leave requests found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
      <table className="w-full min-w-900px table-fixed text-left text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500 sm:text-xs">
            {canDecide && <th className="px-3 py-3 font-medium sm:px-4">Employee</th>}
            <th className="px-3 py-3 font-medium sm:px-4">From</th>
            <th className="px-3 py-3 font-medium sm:px-4">To</th>
            <th className="px-3 py-3 font-medium sm:px-4">Days</th>
            <th className="px-3 py-3 font-medium sm:px-4">Category</th>
            <th className="px-3 py-3 font-medium sm:px-4">Reason</th>
            <th className="px-3 py-3 font-medium sm:px-4">Status</th>
            {canDecide && <th className="px-3 py-3 text-right font-medium sm:px-4">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {requests.map((r) => (
            <tr key={r.id} className="hover:bg-ink-50/60">
              {canDecide && (
                <td className="wrap-break-word whitespace-normal px-3 py-3 font-medium text-ink-900 sm:px-4">
                  {r.user_name ?? `User #${r.user_id}`}
                </td>
              )}
              <td className="px-3 py-3 whitespace-nowrap text-ink-700 sm:px-4">
                {format(parseISO(r.from_date), "dd MMM yyyy")}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-ink-700 sm:px-4">
                {format(parseISO(r.to_date), "dd MMM yyyy")}
              </td>
              <td className="px-3 py-3 text-ink-700 sm:px-4">{r.total_days ?? "—"}</td>
              <td className="px-3 py-3 whitespace-nowrap sm:px-4">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    CATEGORY_CLASS[r.allocation_summary ?? r.leave_category] ?? "bg-ink-100 text-ink-600"
                  }`}
                >
                  {r.allocation_summary || r.leave_category}
                </span>
              </td>
              <td className="w-[16rem] max-w-[16rem] wrap-break-word whitespace-normal px-3 py-3 align-top text-ink-600 sm:px-4">
                <ExpandableText text={r.reason} limit={42} />
                <span className="hidden">{r.reason ?? "—"}</span>
              </td>
              <td className="px-3 py-3 whitespace-nowrap sm:px-4">
                <Badge status={r.status} />
              </td>
              {canDecide && (
                <td className="px-3 py-3 whitespace-nowrap sm:px-4">
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
                    {canDecide && r.leave_category !== "Privilege" && (
                      <button
                        onClick={() => onChangeCategory?.(r.id)}
                        className="rounded-md bg-violet-50 px-2 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
                        aria-label="Grant privilege leave"
                      >
                        Privilege
                      </button>
                    )}
                    {canDecide && (
                      <button
                        onClick={() => onEditAllocations?.(r.id)}
                        className="rounded-md bg-sky-50 px-2 py-1.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100"
                        aria-label="Edit allocations"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
