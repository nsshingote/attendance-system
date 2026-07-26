"use client";

/**
 * components/Dashboard/TodayAttendanceTable.tsx
 * Full-width, detailed table of today's attendance across all employees,
 * shown on the Admin/SuperAdmin dashboard. Includes separate columns for
 * Late Entry Reason and Early Logout Reason, and a Report column showing
 * only ✅ Submitted / ❌ Not Submitted status.
 */

import { useEffect, useState } from "react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";

interface AttendanceReportRow {
  user_id: number;
  user_name: string;
  department: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  reason: string | null;
  report: string | null;
}

// Timezone for India (UTC+5:30)
const TIMEZONE = "Asia/Kolkata";

function formatLocalTime(utcTime: string | null): string {
  if (!utcTime) return "—";
  try {
    const date = parseISO(utcTime);
    const zonedDate = toZonedTime(date, TIMEZONE);
    return format(zonedDate, "hh:mm a");
  } catch {
    return "—";
  }
}

function formatHoursWorked(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "—";
  try {
    const inDate = parseISO(checkIn);
    const outDate = parseISO(checkOut);
    const minutes = differenceInMinutes(outDate, inDate);
    if (minutes <= 0) return "—";
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  } catch {
    return "—";
  }
}

/**
 * Parse reason based on status:
 * - Half Day → goes to Remark column
 * - On Leave → goes to Remark column
 * - Late (checked in after cutoff) → goes to Late Entry Reason
 * - Early Logout (checked out before cutoff) → goes to Early Logout Reason
 * - Present (on time) → nothing
 */
function parseReason(reason: string | null | undefined, status: string): { lateReason: string; earlyReason: string; remark: string } {
  if (!reason) return { lateReason: "", earlyReason: "", remark: "" };
  
  if (status === "Half Day") {
    return { lateReason: "", earlyReason: "", remark: reason };
  }
  
  if (status === "On Leave") {
    return { lateReason: "", earlyReason: "", remark: reason };
  }
  
  if (reason.includes(";")) {
    const parts = reason.split(";").map(s => s.trim());
    return {
      lateReason: parts[0] || "",
      earlyReason: parts[1] || "",
      remark: "",
    };
  }
  
  if (status === "Late") {
    return { lateReason: reason, earlyReason: "", remark: "" };
  }
  
  return { lateReason: "", earlyReason: "", remark: reason };
}

/**
 * Format report for display - only shows Submitted/Not Submitted status
 */
function getReportStatus(report: string | null): string {
  if (!report || report === "Not Submitted" || report.includes("Not Submitted")) {
    return "❌ Not Submitted";
  }
  return "✅ Submitted";
}

export default function TodayAttendanceTable() {
  const [rows, setRows] = useState<AttendanceReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    api
      .get<AttendanceReportRow[]>("/reports/attendance", {
        params: { year: today.getFullYear(), month: today.getMonth() + 1 },
      })
      .then(({ data }) => {
        setRows(
          data
            .filter((r) => r.date === todayIso)
            .sort((a, b) => a.user_name.localeCompare(b.user_name))
        );
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-card">
      <div className="border-b border-ink-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-ink-900">Today&apos;s Attendance</h3>
        <p className="text-xs text-ink-500">{format(new Date(), "EEEE, dd MMMM yyyy")}</p>
      </div>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-ink-500">No attendance marked yet today.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Check In</th>
                <th className="px-4 py-3 font-medium">Check Out</th>
                <th className="px-4 py-3 font-medium">Hours Worked</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Late Entry Reason</th>
                <th className="px-4 py-3 font-medium">Early Logout Reason</th>
                <th className="px-4 py-3 font-medium">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const { lateReason, earlyReason, remark } = parseReason(r.reason, r.status);
                const reportStatus = getReportStatus(r.report);
                const isSubmitted = reportStatus === "✅ Submitted";
                
                return (
                  <tr key={r.user_id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3 font-medium text-ink-900">{r.user_name}</td>
                    <td className="px-4 py-3 text-ink-600">{r.department}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">
                      {formatLocalTime(r.check_in)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">
                      {formatLocalTime(r.check_out)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">
                      {formatHoursWorked(r.check_in, r.check_out)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={r.status} />
                    </td>
                    <td className="max-w-160px truncate px-4 py-3 text-xs text-ink-500" title={lateReason}>
                      {lateReason || "—"}
                    </td>
                    <td className="max-w-160px truncate px-4 py-3 text-xs text-ink-500" title={earlyReason}>
                      {earlyReason || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      <span className={isSubmitted ? "text-green-600" : "text-red-500"}>
                        {reportStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}