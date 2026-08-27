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
import ExpandableText from "@/components/Common/ExpandableText";
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
  
  let lateReason = "";
  let earlyReason = "";
  
  // Parse tagged reasons: [LATE_ENTRY] reason text; [EARLY_CHECKOUT] reason text
  if (reason.includes("[LATE_ENTRY]") || reason.includes("[EARLY_CHECKOUT]")) {
    // Split by semicolon first to separate multiple tagged reasons
    const parts = reason.split(";").map(s => s.trim());
    
    for (const part of parts) {
      if (part.startsWith("[LATE_ENTRY]")) {
        lateReason = part.replace("[LATE_ENTRY]", "").trim();
      } else if (part.startsWith("[EARLY_CHECKOUT]")) {
        earlyReason = part.replace("[EARLY_CHECKOUT]", "").trim();
      }
    }
    
    return { lateReason, earlyReason, remark: "" };
  }
  
  // Fallback for legacy untagged reasons (maintain backward compatibility)
  if (reason.includes(";")) {
    const parts = reason.split(";").map(s => s.trim());
    return {
      lateReason: parts[0] || "",
      earlyReason: parts[1] || "",
      remark: "",
    };
  }
  
  // If status is Late, assume the reason is for late entry
  if (status === "Late") {
    return { lateReason: reason, earlyReason: "", remark: "" };
  }
  
  // Otherwise assume early checkout (for backward compatibility)
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
        <div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-900px table-fixed text-left text-sm">
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
                      <td className="max-w-160px min-w-0 wrap-break-word whitespace-normal px-4 py-3 text-xs leading-5 text-ink-500">
                        <ExpandableText text={lateReason} limit={42} />
                      </td>
                      <td className="max-w-160px min-w-0 wrap-break-word whitespace-normal px-4 py-3 text-xs leading-5 text-ink-500">
                        <ExpandableText text={earlyReason} limit={42} />
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

          <div className="space-y-2 p-2 md:hidden">
            {rows.map((r) => {
              const { lateReason, earlyReason, remark } = parseReason(r.reason, r.status);
              const reportStatus = getReportStatus(r.report, r.has_report);
              const isSubmitted = reportStatus === "✅ Submitted";
              return (
                <div key={r.user_id} className="rounded-lg border border-ink-200 bg-white p-2.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{r.user_name}</p>
                      <p className="text-xs text-ink-500">{r.department}</p>
                    </div>
                    <Badge status={r.status} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-700">
                    <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Check In</p><p className="mt-1 font-mono">{formatLocalTime(r.check_in)}</p></div>
                    <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Check Out</p><p className="mt-1 font-mono">{formatLocalTime(r.check_out)}</p></div>
                    <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Hours</p><p className="mt-1 font-mono">{formatHoursWorked(r.check_in, r.check_out)}</p></div>
                    <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Report</p><p className={`mt-1 font-medium ${isSubmitted ? "text-green-600" : "text-red-500"}`}>{reportStatus}</p></div>
                  </div>
                  {(lateReason || earlyReason || remark) && (
                    <div className="mt-2 rounded-md bg-ink-50 px-2 py-2 text-[11px] text-ink-600">
                      {lateReason && <p><span className="font-semibold text-ink-700">Late:</span> <ExpandableText text={lateReason} limit={42} /></p>}
                      {earlyReason && <p><span className="font-semibold text-ink-700">Early:</span> <ExpandableText text={earlyReason} limit={42} /></p>}
                      {remark && !lateReason && !earlyReason && <p><ExpandableText text={remark} limit={42} /></p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
