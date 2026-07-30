"use client";

/**
 * components/Dashboard/TodayAttendanceTable.tsx
 * Full-width, detailed table of today's attendance across all employees,
 * shown on the Admin/SuperAdmin dashboard. Includes separate columns for
 * Late Entry Reason and Early Logout Reason, and a Report column showing
 * only ✅ Submitted / ❌ Not Submitted status.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";
import { parseISTDateTime } from "@/lib/date";

interface AttendanceReportRow {
  user_id: number;
  user_name: string;
  department: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  reason: string | null;
  report: string | null;
  has_report?: boolean;
}

function formatLocalTime(utcTime: string | null): string {
  if (!utcTime) return "—";
  const date = parseISTDateTime(utcTime);
  if (!date) return "—";
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHoursWorked(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "—";
  try {
    const inDate = parseISTDateTime(checkIn);
    const outDate = parseISTDateTime(checkOut);
    if (!inDate || !outDate) return "—";
    const minutes = Math.round((outDate.getTime() - inDate.getTime()) / 60000);
    if (minutes <= 0) return "—";
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  } catch {
    return "—";
  }
}

function parseReason(reason: string | null | undefined, status: string): { lateReason: string; earlyReason: string; remark: string } {
  if (!reason) return { lateReason: "", earlyReason: "", remark: "" };
  
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
  
  return { lateReason: "", earlyReason: reason, remark: reason };
}

function getReportStatus(report: string | null, has_report?: boolean): string {
  if (has_report === true) return "✅ Submitted";
  if (has_report === false) return "❌ Not Submitted";
  if (!report || report === "Not Submitted" || report.includes("Not Submitted")) {
    return "❌ Not Submitted";
  }
  return "✅ Submitted";
}

export default function TodayAttendanceTable() {
  const [rows, setRows] = useState<AttendanceReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date();
    const todayIso = format(today, "yyyy-MM-dd");

    api
      .get<AttendanceReportRow[]>("/attendance/all", {
        params: {
          year: today.getFullYear(),
          month: today.getMonth() + 1,
          // The API expects date_value; using `date` left the filter unused
          // and returned every attendance record for the current month.
          date_value: todayIso,
        },
      })
      .then(({ data }) => {
        setRows(
          data.sort((a, b) => a.user_name.localeCompare(b.user_name))
        );
      })
      .catch((error: any) => {
        const msg = getErrorMessage(error);
        if (error.response?.status === 401 || /Not authenticated/i.test(msg)) {
          setErrorMsg("Authentication required. Please login as an admin to view today's attendance.");
        } else {
          setErrorMsg(msg);
          toast.error(msg);
        }
      })
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
      ) : errorMsg ? (
        <div className="py-8 px-6 text-center">
          <p className="text-sm text-ink-500">{errorMsg}</p>
        </div>
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
                const reportStatus = getReportStatus(r.report, r.has_report);
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
                    <td className="max-w-160px truncate px-4 py-3 text-xs text-ink-500" title={lateReason || remark}>
                      {lateReason || (r.status !== "Late" && !earlyReason ? remark : "") || "—"}
                    </td>
                    <td className="max-w-160px truncate px-4 py-3 text-xs text-ink-500" title={earlyReason || remark}>
                      {earlyReason || (!lateReason ? remark : "") || "—"}
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
