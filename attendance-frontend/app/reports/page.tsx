"use client";

/**
 * app/reports/page.tsx
 * Admin/SuperAdmin: employee-wise attendance + leave-category summary,
 * and CSV/Excel/PDF export for a selected month.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import MonthSelector from "@/components/Calendar/MonthSelector";

interface EmployeeSummaryRow {
  user_id: number;
  name: string;
  department: string;
  Present: number;
  Late: number;
  "Half Day": number;
  WFH: number;
  Absent: number;
  "Paid Leave": number;
  "Carried Leave Used": number;
  LWP: number;
  "Privilege Leave": number;
  "Carry Forward Balance": number;
  "Used Paid Leave This Month": boolean;
  Encashed: number;
}

interface LeaveSummaryRow {
  user_id: number;
  name: string;
  department: string;
  carried_leave: number;
  used_leave: number;
  paid_leave: number;
  unpaid_leave: number;
  privilege_leave: number;
  leave_encashed: number;
  remaining_leave: number;
}

export default function ReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [tab, setTab] = useState<"attendance" | "leave">("attendance");

  const [employeeSummary, setEmployeeSummary] = useState<EmployeeSummaryRow[]>([]);
  const [leaveSummary, setLeaveSummary] = useState<LeaveSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, leaveRes] = await Promise.all([
        api.get<EmployeeSummaryRow[]>("/reports/employee-summary", { params: { year, month } }),
        api.get<LeaveSummaryRow[]>("/reports/leave-summary", { params: { year, month } }),
      ]);
      setEmployeeSummary(empRes.data);
      setLeaveSummary(leaveRes.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDownloadCSV = () => {
    const rows = tab === "attendance"
      ? employeeSummary.map((r) => [
          r.name,
          r.department,
          r.Present,
          r.Absent,
          r["Half Day"],
          r.Late,
          r.WFH,
          r["Paid Leave"],
          r["Carried Leave Used"],
          r.LWP,
          r["Privilege Leave"],
          r["Carry Forward Balance"],
          r["Used Paid Leave This Month"] ? "Yes" : "No",
          r.Encashed,
        ])
      : leaveSummary.map((r) => [
          r.name,
          r.department,
          r.paid_leave,
          r.unpaid_leave,
          r.privilege_leave,
          r.carried_leave,
          r.leave_encashed,
          r.remaining_leave,
        ]);

    if (rows.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = tab === "attendance"
      ? ["Employee Name", "Department", "Present", "Absent", "Half Day", "Late", "WFH", "Paid Leave", "Carried Leave Used", "LWP", "Privilege Leave", "Carry Forward Balance", "Used Paid Leave This Month", "Encashed"]
      : ["Name", "Department", "Paid Leave", "Unpaid Leave", "Privilege Leave", "Carried Leave", "Encashed", "Remaining"];
    const escapeCsv = (value: string | number) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tab === "attendance" ? "attendance" : "leave"}_report_${year}_${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (tab === "attendance") {
      if (employeeSummary.length === 0) {
        toast.error("No data to export");
        return;
      }
      const rows = employeeSummary.map((r) => ({
        "Employee Name": r.name,
        Department: r.department,
        Present: r.Present,
        Absent: r.Absent,
        "Half Day": r["Half Day"],
        Late: r.Late,
        WFH: r.WFH,
        "Paid Leave": r["Paid Leave"],
        "Carried Leave Used": r["Carried Leave Used"],
        LWP: r.LWP,
        "Privilege Leave": r["Privilege Leave"],
        "Carry Forward Balance": r["Carry Forward Balance"],
        "Used Paid Leave This Month": r["Used Paid Leave This Month"] ? "Yes" : "No",
        Encashed: r.Encashed,
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
      XLSX.writeFile(workbook, `attendance_report_${year}_${month}.xlsx`);
    } else {
      if (leaveSummary.length === 0) {
        toast.error("No data to export");
        return;
      }
      const rows = leaveSummary.map((r) => ({
        Name: r.name,
        Department: r.department,
        "Paid Leave": r.paid_leave,
        "Unpaid Leave": r.unpaid_leave,
        "Privilege Leave": r.privilege_leave,
        "Carried Leave": r.carried_leave,
        Encashed: r.leave_encashed,
        Remaining: r.remaining_leave,
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Leave");
      XLSX.writeFile(workbook, `leave_report_${year}_${month}.xlsx`);
    }
  };

  const handleExportPDF = () => {
    if (tab === "attendance") {
      if (employeeSummary.length === 0) {
        toast.error("No data to export");
        return;
      }
      const doc = new jsPDF({ orientation: "landscape" });
      const columns = [
        "Employee Name",
        "Department",
        "Present",
        "Absent",
        "Half Day",
        "Late",
        "WFH",
        "Paid Leave",
        "Carried Leave Used",
        "LWP",
        "Privilege Leave",
        "Carry Forward Balance",
        "Used Paid Leave This Month",
        "Encashed",
      ];
      const rows = employeeSummary.map((r) => [
        r.name,
        r.department,
        r.Present,
        r.Absent,
        r["Half Day"],
        r.Late,
        r.WFH,
        r["Paid Leave"],
        r["Carried Leave Used"],
        r.LWP,
        r["Privilege Leave"],
        r["Carry Forward Balance"],
        r["Used Paid Leave This Month"] ? "Yes" : "No",
        r.Encashed,
      ]);
      autoTable(doc, {
        head: [columns],
        body: rows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [243, 244, 246], textColor: [51, 51, 51] },
      });
      doc.save(`attendance_report_${year}_${month}.pdf`);
    } else {
      if (leaveSummary.length === 0) {
        toast.error("No data to export");
        return;
      }
      const doc = new jsPDF({ orientation: "landscape" });
      const columns = ["Name", "Department", "Paid Leave", "Unpaid Leave", "Privilege Leave", "Carried Leave", "Encashed", "Remaining"];
      const rows = leaveSummary.map((r) => [
        r.name,
        r.department,
        r.paid_leave,
        r.unpaid_leave,
        r.privilege_leave,
        r.carried_leave,
        r.leave_encashed,
        r.remaining_leave,
      ]);
      autoTable(doc, {
        head: [columns],
        body: rows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [243, 244, 246], textColor: [51, 51, 51] },
      });
      doc.save(`leave_report_${year}_${month}.pdf`);
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="rounded-1rem border border-ink-200 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
              <p className="mt-1 text-sm text-ink-500">Employee-wise attendance and leave summaries</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
              <button
                onClick={handleDownloadCSV}
                className="flex min-h-11 items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                <Download size={16} /> CSV
              </button>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                <FileSpreadsheet size={16} /> Excel
              </button>
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                <FileText size={16} /> PDF
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-1rem border border-ink-200 bg-white p-2 shadow-card">
          <div className="flex w-full flex-wrap gap-2 p-1">
            <button
              onClick={() => setTab("attendance")}
              className={`rounded-2xl px-4 py-2 text-sm font-medium ${tab === "attendance" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"}`}
            >
              Attendance Summary
            </button>
            <button
              onClick={() => setTab("leave")}
              className={`rounded-2xl px-4 py-2 text-sm font-medium ${tab === "leave" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"}`}
            >
              Leave Summary
            </button>
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : tab === "attendance" ? (
          <div className="overflow-x-auto rounded-1rem border border-ink-200 bg-white shadow-card">
            <table className="w-full min-w-820px table-fixed text-left text-sm">
              <thead className="bg-white">
                <tr className="sticky top-0 border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Present</th>
                  <th className="px-4 py-3 font-medium">Absent</th>
                  <th className="px-4 py-3 font-medium">Half Day</th>
                  <th className="px-4 py-3 font-medium">Late</th>
                  <th className="px-4 py-3 font-medium">WFH</th>
                  <th className="px-4 py-3 font-medium">Paid Leave</th>
                  <th className="px-4 py-3 font-medium">LWP</th>
                  <th className="px-4 py-3 font-medium">Privilege</th>
                  <th className="px-4 py-3 font-medium">Carry Fwd Bal.</th>
                  <th className="px-4 py-3 font-medium">Encashed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {employeeSummary.map((r) => (
                  <tr key={r.user_id} className="hover:bg-ink-50/60">
                    <td className="max-w-36 wrap-break-word whitespace-normal px-4 py-3 font-medium text-ink-900">{r.name}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Present}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Absent}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Half Day"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Late}</td>
                    <td className="px-4 py-3 text-ink-700">{r.WFH}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Paid Leave"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.LWP}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Privilege Leave"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Carry Forward Balance"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Encashed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-1rem border border-ink-200 bg-white shadow-card">
            <table className="w-full min-w-700px table-fixed text-left text-sm">
              <thead className="bg-white">
                <tr className="sticky top-0 border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Paid Leave</th>
                  <th className="px-4 py-3 font-medium">Unpaid Leave</th>
                  <th className="px-4 py-3 font-medium">Privilege Leave</th>
                  <th className="px-4 py-3 font-medium">Carried Leave</th>
                  <th className="px-4 py-3 font-medium">Encashed</th>
                  <th className="px-4 py-3 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {leaveSummary.map((r) => (
                  <tr key={r.user_id} className="hover:bg-ink-50/60">
                    <td className="max-w-36 wrap-break-word whitespace-normal px-4 py-3 font-medium text-ink-900">{r.name}</td>
                    <td className="px-4 py-3 text-ink-700">{r.department}</td>
                    <td className="px-4 py-3 text-ink-700">{r.paid_leave}</td>
                    <td className="px-4 py-3 text-ink-700">{r.unpaid_leave}</td>
                    <td className="px-4 py-3 text-ink-700">{r.privilege_leave}</td>
                    <td className="px-4 py-3 text-ink-700">{r.carried_leave}</td>
                    <td className="px-4 py-3 text-ink-700">{r.leave_encashed}</td>
                    <td className="px-4 py-3 font-medium text-ink-900">{r.remaining_leave}</td>
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
