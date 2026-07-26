"use client";

/**
 * app/admin-reports/page.tsx
 * Admin/SuperAdmin view to see all employee daily reports.
 * Department-specific activity display.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { format, parseISO } from "date-fns";
import { Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";
import MonthSelector from "@/components/Calendar/MonthSelector";

interface UserOption {
  id: number;
  name: string;
  department: string;
}

interface ReportRow {
  id: number;
  user_id: number;
  user_name: string;
  user_department: string;
  attendance_date: string;
  department_id: number;
  type_id: number | null;
  subtype_id: number | null;
  quantity: number | null;
  duration: string | null;
  description: string | null;
  status: string;
  report_display: string;
  created_at: string;
}

export default function AdminReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<UserOption[]>("/users/")
      .then(({ data }) => setUsers(data))
      .catch(() => toast.error("Failed to load users"));
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params: any = { year, month };
      if (selectedUserId) {
        params.user_id = selectedUserId;
      }
      const { data } = await api.get<ReportRow[]>("/reports/all", { params });
      
      const seen = new Set();
      const uniqueReports = data.filter((report) => {
        const key = `${report.user_id}-${report.attendance_date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      setReports(uniqueReports);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [selectedUserId, year, month]);

  const selectedUserName = users.find((u) => u.id === selectedUserId)?.name || "";

  // Format report based on department
  const formatReport = (display: string, department: string) => {
    if (!display) return "—";
    
    // For HR and IT - show simple description
    if (department === "HR" || department === "IT") {
      return display.replace(/\n/g, " | ");
    }
    
    // Split by newlines and filter out empty lines
    const lines = display.split("\n").filter(line => line.trim() !== "");
    
    // Define which activities to show based on department
    let activityOrder: string[] = [];
    
    if (department === "B2C") {
      activityOrder = [
        "quotation",
        "invoice",
        "report",
        "schedule confirmation",
        "calendar update",
        "leadupdate",
        "followup"
      ];
    } else if (department === "B2B") {
      activityOrder = [
        "quotation",
        "invoice",
        "report",
        "schedule confirmation",
        "calendar update"
      ];
    } else {
      // Default - show all
      activityOrder = [
        "quotation",
        "invoice",
        "report",
        "schedule confirmation",
        "calendar update",
        "leadupdate",
        "followup"
      ];
    }
    
    // Group activities and sum quantities
    const activityMap = new Map();
    
    lines.forEach(line => {
      // Remove department prefix if present
      let cleanedLine = line.replace(/^[A-Z0-9]+\s*→\s*/, "");
      
      // Extract activity name and details
      let activity = cleanedLine;
      let quantity = 0;
      let duration = "";
      
      const quantityMatch = cleanedLine.match(/\(Qty:\s*(\d+),?\s*Duration:\s*([^)]+)\)/i);
      if (quantityMatch) {
        activity = cleanedLine.replace(/\s*\(Qty:.*$/, "").trim().toLowerCase();
        quantity = parseInt(quantityMatch[1]);
        duration = quantityMatch[2].trim();
      } else {
        activity = cleanedLine.trim().toLowerCase();
      }
      
      // Normalize activity names
      let normalizedActivity = activity;
      if (activity.includes("quotation") || activity.includes("quote")) {
        normalizedActivity = "quotation";
      } else if (activity.includes("invoice")) {
        normalizedActivity = "invoice";
      } else if (activity.includes("report")) {
        normalizedActivity = "report";
      } else if (activity.includes("schedule confirmation")) {
        normalizedActivity = "schedule confirmation";
      } else if (activity.includes("calendar update")) {
        normalizedActivity = "calendar update";
      } else if (activity.includes("lead update")) {
        normalizedActivity = "leadupdate";
      } else if (activity.includes("follow up") || activity.includes("followup")) {
        normalizedActivity = "followup";
      }
      
      // Group by activity
      if (!activityMap.has(normalizedActivity)) {
        activityMap.set(normalizedActivity, { totalQty: 0, durations: [] });
      }
      const entry = activityMap.get(normalizedActivity);
      entry.totalQty += quantity;
      if (duration) {
        entry.durations.push(duration);
      }
    });
    
    // Format in specified order
    const formattedLines = [];
    
    // Process activities in the defined order
    for (const activity of activityOrder) {
      if (activityMap.has(activity)) {
        const data = activityMap.get(activity);
        
        if (data.totalQty > 0 && data.durations.length > 0) {
          const durationStr = data.durations.join('/');
          formattedLines.push(`${activity}-${data.totalQty}-${durationStr}`);
        } else if (data.totalQty > 0) {
          formattedLines.push(`${activity}-${data.totalQty}`);
        } else if (data.durations.length > 0) {
          const durationStr = data.durations.join('/');
          formattedLines.push(`${activity}-${durationStr}`);
        }
        activityMap.delete(activity);
      }
    }
    
    // Second pass: any remaining activities not in the order list
    for (const [activity, data] of activityMap) {
      if (data.totalQty > 0 && data.durations.length > 0) {
        const durationStr = data.durations.join('/');
        formattedLines.push(`${activity}-${data.totalQty}-${durationStr}`);
      } else if (data.totalQty > 0) {
        formattedLines.push(`${activity}-${data.totalQty}`);
      } else if (data.durations.length > 0) {
        const durationStr = data.durations.join('/');
        formattedLines.push(`${activity}-${durationStr}`);
      }
    }
    
    return formattedLines.join("\n");
  };

  const handleExportCSV = () => {
    if (reports.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = ["Employee", "Department", "Date", "Report", "Status"];
    const rows = reports.map((r) => [
      r.user_name,
      r.user_department,
      format(parseISO(r.attendance_date), "dd MMM yyyy"),
      formatReport(r.report_display, r.user_department).replace(/\n/g, " | "),
      r.status,
    ]);

    let csvContent = headers.join(",") + "\n";
    rows.forEach((row) => {
      csvContent += row.map((cell) => `"${cell}"`).join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily_reports_${year}_${month}_${selectedUserName || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported successfully!");
  };

  const handleExportExcel = () => {
    if (reports.length === 0) {
      toast.error("No data to export");
      return;
    }

    const data = reports.map((r) => ({
      Employee: r.user_name,
      Department: r.user_department,
      Date: format(parseISO(r.attendance_date), "dd MMM yyyy"),
      Report: formatReport(r.report_display, r.user_department).replace(/\n/g, " | "),
      Status: r.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Reports");
    XLSX.writeFile(workbook, `daily_reports_${year}_${month}_${selectedUserName || "all"}.xlsx`);
    toast.success("Excel exported successfully!");
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-ink-900">Team Reports</h1>
            <p className="text-xs text-ink-500">
              {selectedUserId
                ? `Reports for ${selectedUserName}`
                : "All employees"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-ink-200 bg-white px-2 py-1 text-xs"
            >
              <option value="">All Employees</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <MonthSelector
              year={year}
              month={month}
              onChange={(y, m) => {
                setYear(y);
                setMonth(m);
              }}
            />

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              <FileSpreadsheet size={13} />
              Excel
            </button>
          </div>
        </div>

        {/* Reports Table */}
        {loading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-300 bg-white py-8 text-center">
            <p className="text-sm text-ink-500">No reports found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
            <table className="w-full min-w-650px text-left text-xs">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500">
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Dept</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Activities</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {reports.map((r) => (
                  <tr key={`${r.user_id}-${r.attendance_date}`} className="hover:bg-ink-50/60">
                    <td className="px-3 py-2 font-medium text-ink-900 whitespace-nowrap">
                      {r.user_name}
                    </td>
                    <td className="px-3 py-2 text-ink-600 whitespace-nowrap">
                      {r.user_department}
                    </td>
                    <td className="px-3 py-2 text-ink-600 whitespace-nowrap">
                      {format(parseISO(r.attendance_date), "dd MMM yyyy")}
                    </td>
                    <td 
                      className="px-3 py-2 text-[11px] text-ink-700 leading-relaxed"
                      style={{ wordBreak: 'break-word' }}
                    >
                      <div className="space-y-0.5">
                        {formatReport(r.report_display, r.user_department)
                          .split('\n')
                          .map((line, idx) => (
                            <div key={idx} className="whitespace-nowrap">
                              {line}
                            </div>
                          ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}