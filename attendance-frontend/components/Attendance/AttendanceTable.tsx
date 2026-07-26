"use client";

/**
 * components/Attendance/AttendanceTable.tsx
 * Compact table view of attendance records — fits in one page without scrolling.
 */

import { parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Badge from "@/components/Common/Badge";

export interface AttendanceRecord {
  id: number;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  ip_address: string | null;
  reason?: string | null;
  report?: string | null;
  user_name?: string;
  department?: string;
}

interface AttendanceTableProps {
  records: AttendanceRecord[];
  showRequestCorrection?: boolean;
  onRequestCorrection?: (record: AttendanceRecord) => void;
  showEmployeeName?: boolean;
}

const IST_TIME_ZONE = "Asia/Kolkata";

function formatTime(isoString: string): string {
  if (!isoString) return "—";
  try {
    const date = parseISO(isoString);
    const zonedDate = toZonedTime(date, IST_TIME_ZONE);
    return zonedDate.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function formatDateOnly(dateString: string): string {
  return parseISO(dateString).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatHoursWorked(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "—";
  try {
    const inDate = parseISO(checkIn);
    const outDate = parseISO(checkOut);
    const minutes = Math.round((outDate.getTime() - inDate.getTime()) / 60000);
    if (minutes <= 0) return "—";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  } catch {
    return "—";
  }
}

function parseReason(reason: string | null | undefined, status: string): { lateReason: string; earlyReason: string } {
  if (!reason) return { lateReason: "", earlyReason: "" };
  
  if (reason.includes(";")) {
    const parts = reason.split(";").map(s => s.trim());
    return {
      lateReason: parts[0] || "",
      earlyReason: parts[1] || "",
    };
  }
  
  if (status === "Late") {
    return { lateReason: reason, earlyReason: "" };
  }
  
  return { lateReason: "", earlyReason: reason };
}

function getReportStatus(report: string | null | undefined): string {
  if (!report || report === "Not Submitted") {
    return "❌";
  }
  return "✅";
}

export default function AttendanceTable({
  records,
  showRequestCorrection,
  onRequestCorrection,
  showEmployeeName = false,
}: AttendanceTableProps) {
  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-300 bg-white py-8 text-center">
        <p className="text-sm text-ink-500">No attendance records found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <table className="w-full min-w-700px text-left text-xs">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500">
            {showEmployeeName && (
              <th className="px-2 py-2 font-medium">Employee</th>
            )}
            <th className="px-2 py-2 font-medium">Date</th>
            <th className="px-2 py-2 font-medium">In</th>
            <th className="px-2 py-2 font-medium">Out</th>
            <th className="px-2 py-2 font-medium">Hours</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Late</th>
            <th className="px-2 py-2 font-medium">Early</th>
            <th className="px-2 py-2 font-medium">Report</th>
            {showRequestCorrection && <th className="px-2 py-2 font-medium">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {records.map((r) => {
            const { lateReason, earlyReason } = parseReason(r.reason, r.status);
            const reportStatus = getReportStatus(r.report);
            
            return (
              <tr key={r.id} className="hover:bg-ink-50/60">
                {showEmployeeName && (
                  <td className="px-2 py-2 text-ink-800 whitespace-nowrap font-medium">
                    {r.user_name || "Unknown"}
                  </td>
                )}
                <td className="px-2 py-2 text-ink-800 whitespace-nowrap">
                  {formatDateOnly(r.attendance_date)}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-ink-600 whitespace-nowrap">
                  {r.check_in ? formatTime(r.check_in) : "—"}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-ink-600 whitespace-nowrap">
                  {r.check_out ? formatTime(r.check_out) : "—"}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-ink-600 whitespace-nowrap">
                  {formatHoursWorked(r.check_in, r.check_out)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <Badge status={r.status} />
                </td>
                <td className="px-2 py-2 text-[10px] text-ink-500 whitespace-nowrap max-w-60px truncate">
                  {lateReason || "—"}
                </td>
                <td className="px-2 py-2 text-[10px] text-ink-500 whitespace-nowrap max-w-60px truncate">
                  {earlyReason || "—"}
                </td>
                <td className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                  <span className={reportStatus === "✅" ? "text-green-600" : "text-red-500"}>
                    {reportStatus}
                  </span>
                </td>
                {showRequestCorrection && (
                  <td className="px-2 py-2 whitespace-nowrap">
                    {r.check_out && (
                      <button
                        onClick={() => onRequestCorrection?.(r)}
                        className="text-[10px] font-medium text-brand-600 hover:text-brand-700"
                      >
                        Correct
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}