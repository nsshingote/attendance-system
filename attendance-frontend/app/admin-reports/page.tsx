

"use client";

/**
 * Admin/SuperAdmin view to see all employee daily reports.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { format, parseISO } from "date-fns";
import { Download, FileSpreadsheet, Calendar as CalendarIcon } from "lucide-react";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";
import MonthSelector from "@/components/Calendar/MonthSelector";
import ExpandableText from "@/components/Common/ExpandableText";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";

interface UserOption {
  id: number;
  name: string;
  department: string;
}

interface DepartmentOption {
  id: number;
  name: string;
}

interface ReportRow {
  id: number;
  user_id: number;
  user_name: string;
  department_name: string;
  attendance_date: string;
  department_id: number;
  type_id: number | null;
  subtype_id: number | null;
  type_name: string | null;
  subtype_name: string | null;
  quantity: number | null;
  duration: string | null;
  description: string | null;
  status: string;
  report_display: string;
  created_at: string;
}

interface ReportGroup {
  key: string;
  user_id: number;
  user_name: string;
  department_name: string;
  attendance_date: string;
  status: string;
  activities: ReportRow[];
}
interface PastSubmissionRequest { id: number; user_name: string; attendance_date: string; reason?: string | null; request_type?: string; status: string; }

function uniqueById<T extends { id: number }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export default function AdminReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | "">("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [reports, setReports] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [pastSubmissionRequests, setPastSubmissionRequests] = useState<PastSubmissionRequest[]>([]);
  const latestRequestId = useRef(0);

  useEffect(() => {
    Promise.all([
      api.get<UserOption[]>("/users/"),
      api.get<DepartmentOption[]>("/reports/departments"),
      api.get<PastSubmissionRequest[]>("/reports/past-submission-requests"),
    ])
      .then(([usersRes, departmentsRes, requestsRes]) => {
        // A duplicate option ID makes React reuse the wrong option and can
        // cause the selected employee/department to appear not to change.
        setUsers(uniqueById(usersRes.data || []));
        setDepartments(uniqueById(departmentsRes.data || []));
        setPastSubmissionRequests(requestsRes.data || []);
      })
      .catch(() => toast.error("Failed to load report filters"));
  }, []);

  const fetchReports = async () => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    try {
      const params: { year: number; month: number; employee_ids?: number[]; department_id?: number; date_value?: string } = { year, month };
      if (selectedUserIds.length) params.employee_ids = selectedUserIds;
      if (selectedDepartmentId) params.department_id = selectedDepartmentId;
      if (selectedDate) params.date_value = selectedDate;

      const { data } = await api.get<ReportRow[]>("/reports/all", { params, paramsSerializer: { indexes: null } });
      // Requests can finish out of order when filters are changed quickly.  Do
      // not let an earlier, unfiltered response replace the newest result.
      if (requestId !== latestRequestId.current) return;

      const filteredData = data.filter((report) => {
        const reportMonth = Number(report.attendance_date.slice(5, 7));
        const reportYear = Number(report.attendance_date.slice(0, 4));
        return (
          reportYear === year &&
          reportMonth === month &&
          (selectedUserIds.length === 0 || selectedUserIds.includes(report.user_id)) &&
          (!selectedDepartmentId || report.department_id === selectedDepartmentId) &&
          (!selectedDate || report.attendance_date === selectedDate)
        );
      });
      const groups = new Map<string, ReportGroup>();

      filteredData.forEach((report) => {
        const key = `${report.user_id}-${report.attendance_date}`;
        const group = groups.get(key);

        if (group) {
          group.activities.push(report);
          return;
        }

        groups.set(key, {
          key,
          user_id: report.user_id,
          user_name: report.user_name,
          department_name: report.department_name,
          attendance_date: report.attendance_date,
          status: report.status,
          activities: [report],
        });
      });

      setReports(
        Array.from(groups.values()).sort(
          (a, b) => new Date(b.attendance_date).getTime() - new Date(a.attendance_date).getTime()
        )
      );
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      toast.error(getErrorMessage(error));
      setReports([]);
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [selectedUserIds, selectedDepartmentId, selectedDate, year, month]);

  const clearDateFilter = () => {
    setSelectedDate("");
    setShowDatePicker(false);
  };

  const reviewPastSubmissionRequest = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.put(`/reports/past-submission-requests/${id}`, { status });
      setPastSubmissionRequests((items) => items.map((item) => item.id === id ? { ...item, status } : item));
      toast.success(`Request ${status.toLowerCase()}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const selectedUserName = selectedUserIds.length === 1 ? users.find((user) => user.id === selectedUserIds[0])?.name || "" : "";

  // const getTotalDuration = (activities: ReportRow[]) => {
  //   const durations = activities
  //     .map((activity) => Number(activity.duration))
  //     .filter((duration) => Number.isFinite(duration));

  //   return durations.length > 0
  //     ? durations.reduce((total, duration) => total + duration, 0)
  //     : "—";
  // };

  const durationToMinutes = (value: string | null) => {
  if (!value) return 0;

  const [hours, minutes] = value.split(".");

  return (Number(hours || 0) * 60) + Number(minutes || 0);
};

const minutesToDuration = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}.${String(minutes).padStart(2, "0")}`;
};

const getTotalDuration = (activities: ReportRow[]) => {
  const totalMinutes = activities.reduce((sum, activity) => {
    return sum + durationToMinutes(activity.duration);
  }, 0);

  return totalMinutes > 0 ? minutesToDuration(totalMinutes) : "—";
};

  // Export rows use empty strings (not "—") for missing values so Excel/CSV
  // cells are truly blank and can be summed/averaged without errors.
  const exportRows = reports.flatMap((group) =>
    group.activities.map((activity) => ({
      Employee: group.user_name,
      Department: group.department_name,
      Date: format(parseISO(group.attendance_date), "dd MMM yyyy"),
      Type: activity.type_name || "",
      Subtype: activity.subtype_name || "",
      Quantity: activity.quantity ?? "",
      Duration: activity.duration || "",
      Description: activity.description || "",
      Status: group.status,
    }))
  );

  const handleExportCSV = () => {
    if (reports.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = Object.keys(exportRows[0]);
    const csvContent = [headers.join(","), ...exportRows.map((row) =>
      headers.map((header) => `"${String(row[header as keyof typeof row]).replace(/"/g, '""')}"`).join(",")
    )].join("\n");

    // Prefix with UTF-8 BOM so Excel renders special characters correctly
    // instead of showing garbled text like "â€"".
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
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

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Reports");
    XLSX.writeFile(workbook, `daily_reports_${year}_${month}_${selectedUserName || "all"}.xlsx`);
    toast.success("Excel exported successfully!");
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-base font-semibold text-ink-900">Team Reports</h1>
            <p className="text-xs text-ink-500">
              {selectedUserIds.length ? `Reports for ${selectedUserIds.length === 1 ? selectedUserName : `${selectedUserIds.length} employees`}` : "All employees"}
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <EmployeeMultiSelect employees={users} value={selectedUserIds} onChange={setSelectedUserIds} className="min-w-52" />
            <select
              value={selectedDepartmentId}
              onChange={(event) => setSelectedDepartmentId(event.target.value ? Number(event.target.value) : "")}
              className="min-w-0 rounded border border-ink-200 bg-white px-2 py-1 text-xs"
            >
              <option value="">All Departments</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
            <div className="relative">
              <button onClick={() => setShowDatePicker(!showDatePicker)} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${selectedDate ? "border-brand-500 bg-brand-50 text-brand-600" : "border-ink-200 bg-white text-ink-600"}`}>
                <CalendarIcon size={13} />
                {selectedDate ? new Date(selectedDate).toLocaleDateString() : "Date"}
                {selectedDate && <span onClick={(e) => { e.stopPropagation(); clearDateFilter(); }} className="ml-1 cursor-pointer text-ink-400 hover:text-ink-600">×</span>}
              </button>
              {showDatePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-220px w-260px rounded-lg border border-ink-200 bg-white p-3 shadow-lg">
                    <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setShowDatePicker(false); }} className="w-full rounded border border-ink-200 px-3 py-2 text-sm" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => { setSelectedDate(new Date().toISOString().split("T")[0]); setShowDatePicker(false); }} className="flex-1 rounded bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">Today</button>
                      <button onClick={clearDateFilter} className="flex-1 rounded border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50">Clear</button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <MonthSelector year={year} month={month} onChange={(nextYear, nextMonth) => {
              setYear(nextYear);
              setMonth(nextMonth);
            }} />
            <button onClick={handleExportCSV} className="flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50">
              <Download size={13} /> CSV
            </button>
            <button onClick={handleExportExcel} className="flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50">
              <FileSpreadsheet size={13} /> Excel
            </button>
          </div>
        </div>

        {selectedDate && (
          <div className="flex items-center gap-2 text-sm text-ink-600">
            <span className="font-medium">Filtering by date:</span>
            <span className="rounded bg-brand-50 px-2 py-1 text-brand-700">{new Date(selectedDate).toLocaleDateString()}</span>
            <button onClick={clearDateFilter} className="text-ink-400 hover:text-ink-600">× Clear</button>
          </div>
        )}

        {pastSubmissionRequests.some((request) => request.status === "Pending") && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <h2 className="text-sm font-semibold text-amber-900">Past-day report requests</h2>
            <div className="mt-2 space-y-2">
              {pastSubmissionRequests.filter((request) => request.status === "Pending").map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
                  <span><strong>{request.user_name}</strong> · {request.attendance_date} · <strong>{request.request_type ?? "Missing Report"}</strong>{request.reason ? ` · ${request.reason}` : ""}</span>
                  <span className="flex gap-2">
                    <button onClick={() => reviewPastSubmissionRequest(request.id, "Approved")} className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white">Approve</button>
                    <button onClick={() => reviewPastSubmissionRequest(request.id, "Rejected")} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white">Reject</button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? <Loading /> : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-300 bg-white py-8 text-center">
            <p className="text-sm text-ink-500">No reports found.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-650px text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500">
                    <th className="px-3 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2 font-medium">Dept</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Subtype</th>
                    <th className="px-3 py-2 font-medium">Quantity</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                 {reports.map((group) => (
                    <Fragment key={group.key}>
                      {group.activities.map((activity, index) => (
                        <tr key={activity.id} className={`hover:bg-ink-50/60 ${index === 0 ? "border-t-2 border-ink-200" : "border-t border-ink-100"}`}>
                          {index === 0 && <>
                            <td rowSpan={group.activities.length + 1} className="px-3 py-2 align-top font-medium text-ink-900 whitespace-nowrap">{group.user_name}</td>
                            <td rowSpan={group.activities.length + 1} className="px-3 py-2 align-top text-ink-600 whitespace-nowrap">{group.department_name}</td>
                            <td rowSpan={group.activities.length + 1} className="px-3 py-2 align-top text-ink-600 whitespace-nowrap">{format(parseISO(group.attendance_date), "dd MMM yyyy")}</td>
                          </>}
                          <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.type_name || "—"}</td>
                          <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.subtype_name || "—"}</td>
                          <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.quantity ?? "—"}</td>
                          <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.duration || "—"}</td>
                          <td className="max-w-64 px-3 py-2 text-ink-700"><ExpandableText text={activity.description} limit={52} /></td>
                          {index === 0 && <td rowSpan={group.activities.length + 1} className="px-3 py-2 align-top whitespace-nowrap"><Badge status={group.status} /></td>}
                        </tr>
                      ))}
                      <tr className="border-t border-ink-200 bg-ink-50/40">
                        <td colSpan={3} />
                        <td className="px-3 py-2 font-semibold text-ink-900 whitespace-nowrap">Total: {getTotalDuration(group.activities)}</td>
                        <td />
                      </tr>
                    </Fragment>
                  ))} 
                </tbody>
              </table>
            </div>

            <div className="space-y-2 p-2 md:hidden">
              {reports.map((group) => (
                <div key={group.key} className="rounded-lg border border-ink-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{group.user_name}</p>
                      <p className="text-xs text-ink-500">{group.department_name} • {format(parseISO(group.attendance_date), "dd MMM yyyy")}</p>
                    </div>
                    <Badge status={group.status} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.activities.map((activity) => (
                      <div key={activity.id} className="rounded-md bg-ink-50 px-2.5 py-2 text-xs text-ink-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink-900">{activity.type_name || "—"}</span>
                          <span className="text-ink-400">•</span>
                          <span>{activity.subtype_name || "—"}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-600">
                          <span>Qty: {activity.quantity ?? "—"}</span>
                          <span>Duration: {activity.duration || "—"}</span>
                        </div>
                        {activity.description && <p className="mt-1 text-[11px] text-ink-600">{activity.description}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-ink-100 pt-2 text-xs font-semibold text-ink-800">
                    Total: {getTotalDuration(group.activities)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
