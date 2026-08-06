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
  Absent: number;
  "Paid Leave": number;
  "Carried Leave Used": number;
  LWP: number;
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
        api.get<LeaveSummaryRow[]>("/reports/leave-summary"),
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
  window.open(
    `${api.defaults.baseURL}/reports/attendance/export?year=${year}&month=${month}`,
    "_blank"
  );
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
        "Paid Leave": r["Paid Leave"],
        "Carried Leave Used": r["Carried Leave Used"],
        LWP: r.LWP,
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
        "Paid Leave": r.used_leave,
        "Unpaid Leave": 0,
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
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(tab === "attendance" ? "Employee Attendance & Leave Summary" : "Leave Summary", 14, 16);

    if (tab === "attendance") {
      autoTable(doc, {
        startY: 22,
        head: [["Name", "Dept", "Present", "Absent", "Half Day", "Late", "Paid", "Carried", "LWP", "Carry Fwd", "Encashed"]],
        body: employeeSummary.map((r) => [
          r.name,
          r.department,
          r.Present,
          r.Absent,
          r["Half Day"],
          r.Late,
          r["Paid Leave"],
          r["Carried Leave Used"],
          r.LWP,
          r["Carry Forward Balance"],
          r.Encashed,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [79, 70, 229] },
      });
    } else {
      autoTable(doc, {
        startY: 22,
        head: [["Name", "Department", "Paid Leave", "Unpaid Leave", "Carried Leave", "Encashed", "Remaining"]],
        body: leaveSummary.map((r) => [r.name, r.department, r.used_leave, 0, r.carried_leave, r.leave_encashed, r.remaining_leave]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] },
      });
    }

    doc.save(`${tab}_report_${year}_${month}.pdf`);
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
            <p className="text-sm text-ink-500">Employee-wise attendance and leave summaries</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MonthSelector year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
            >
              <Download size={15} />
              CSV
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
            >
              <FileSpreadsheet size={15} />
              Excel
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
            >
              <FileText size={15} />
              PDF
            </button>
          </div>
        </div>

        <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
          <button
            onClick={() => setTab("attendance")}
            className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "attendance" ? "bg-brand-500 text-white" : "text-ink-600"}`}
          >
            Attendance Summary
          </button>
          <button
            onClick={() => setTab("leave")}
            className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "leave" ? "bg-brand-500 text-white" : "text-ink-600"}`}
          >
            Leave Summary
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : tab === "attendance" ? (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Present</th>
                  <th className="px-4 py-3 font-medium">Absent</th>
                  <th className="px-4 py-3 font-medium">Half Day</th>
                  <th className="px-4 py-3 font-medium">Late</th>
                  <th className="px-4 py-3 font-medium">Paid Leave</th>
                  <th className="px-4 py-3 font-medium">LWP</th>
                  <th className="px-4 py-3 font-medium">Carry Fwd Bal.</th>
                  <th className="px-4 py-3 font-medium">Encashed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {employeeSummary.map((r) => (
                  <tr key={r.user_id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3 font-medium text-ink-900">{r.name}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Present}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Absent}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Half Day"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Late}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Paid Leave"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.LWP}</td>
                    <td className="px-4 py-3 text-ink-700">{r["Carry Forward Balance"]}</td>
                    <td className="px-4 py-3 text-ink-700">{r.Encashed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Paid Leave</th>
                  <th className="px-4 py-3 font-medium">Unpaid Leave</th>
                  <th className="px-4 py-3 font-medium">Carried Leave</th>
                  <th className="px-4 py-3 font-medium">Encashed</th>
                  <th className="px-4 py-3 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {leaveSummary.map((r) => (
                  <tr key={r.user_id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3 font-medium text-ink-900">{r.name}</td>
                    <td className="px-4 py-3 text-ink-700">{r.department}</td>
                    <td className="px-4 py-3 text-ink-700">{r.used_leave}</td>
                    <td className="px-4 py-3 text-ink-700">0</td>
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
