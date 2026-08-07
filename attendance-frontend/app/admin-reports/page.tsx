

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
interface PastSubmissionRequest { id: number; user_name: string; attendance_date: string; reason?: string | null; status: string; }

function uniqueById<T extends { id: number }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export default function AdminReportsPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
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
      const params: { year: number; month: number; user_id?: number; department_id?: number; date_value?: string } = { year, month };
      if (selectedUserId) params.user_id = selectedUserId;
      if (selectedDepartmentId) params.department_id = selectedDepartmentId;
      if (selectedDate) params.date_value = selectedDate;

      const { data } = await api.get<ReportRow[]>("/reports/all", { params });
      // Requests can finish out of order when filters are changed quickly.  Do
      // not let an earlier, unfiltered response replace the newest result.
      if (requestId !== latestRequestId.current) return;

      const filteredData = data.filter((report) => {
        const reportMonth = Number(report.attendance_date.slice(5, 7));
        const reportYear = Number(report.attendance_date.slice(0, 4));
        return (
          reportYear === year &&
          reportMonth === month &&
          (!selectedUserId || report.user_id === selectedUserId) &&
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
  }, [selectedUserId, selectedDepartmentId, selectedDate, year, month]);

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

  const selectedUserName = users.find((user) => user.id === selectedUserId)?.name || "";

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
      <div className="space-y-5">
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-base font-semibold text-ink-900">Team Reports</h1>
              <p className="mt-1 text-sm text-ink-500">{selectedUserId ? `Reports for ${selectedUserName}` : "All employees"}</p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-[auto_auto_auto_auto] xl:w-auto xl:flex-row xl:items-center">
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value ? Number(event.target.value) : "")}
                className="min-w-0 rounded-2xl border border-ink-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">All Employees</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <select
                value={selectedDepartmentId}
                onChange={(event) => setSelectedDepartmentId(event.target.value ? Number(event.target.value) : "")}
                className="min-w-0 rounded-2xl border border-ink-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">All Departments</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
              <div className="relative">
                <button onClick={() => setShowDatePicker(!showDatePicker)} className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-sm ${selectedDate ? "border-brand-500 bg-brand-50 text-brand-600" : "border-ink-200 bg-white text-ink-600"}`}>
                  <span className="inline-flex items-center gap-2"><CalendarIcon size={16} />{selectedDate ? new Date(selectedDate).toLocaleDateString() : "Date"}</span>
                  {selectedDate && <span onClick={(e) => { e.stopPropagation(); clearDateFilter(); }} className="cursor-pointer text-ink-400 hover:text-ink-600">×</span>}
                </button>
                {showDatePicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 min-w-60 rounded-2xl border border-ink-200 bg-white p-3 shadow-lg">
                      <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setShowDatePicker(false); }} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => { setSelectedDate(new Date().toISOString().split("T")[0]); setShowDatePicker(false); }} className="flex-1 rounded-2xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">Today</button>
                        <button onClick={clearDateFilter} className="flex-1 rounded-2xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50">Clear</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="min-w-0">
                <MonthSelector year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} />
              </div>
              <button onClick={handleExportCSV} className="flex items-center justify-center gap-2 rounded-2xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">
                <Download size={16} /> CSV
              </button>
              <button onClick={handleExportExcel} className="flex items-center justify-center gap-2 rounded-2xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">
                <FileSpreadsheet size={16} /> Excel
              </button>
            </div>
          </div>
        </div>

        {selectedDate && (
          <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">Filtering by date:</span>
              <span className="rounded-full bg-white px-3 py-1 text-brand-700 shadow-sm">{new Date(selectedDate).toLocaleDateString()}</span>
              <button onClick={clearDateFilter} className="text-brand-700 underline">Clear</button>
            </div>
          </div>
        )}

        {pastSubmissionRequests.some((request) => request.status === "Pending") && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-amber-900">Past-day report requests</h2>
                <p className="mt-1 text-sm text-amber-800">Approve or reject requests from employees for late report submissions.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {pastSubmissionRequests.filter((request) => request.status === "Pending").map((request) => (
                <div key={request.id} className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-semibold">{request.user_name}</p>
                      <p className="text-ink-600">{request.attendance_date}{request.reason ? ` · ${request.reason}` : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => reviewPastSubmissionRequest(request.id, "Approved")} className="rounded-2xl bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700">Approve</button>
                      <button onClick={() => reviewPastSubmissionRequest(request.id, "Rejected")} className="rounded-2xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">Reject</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-white py-10 text-center shadow-card">
            <p className="text-sm text-ink-500">No reports found.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">Report groups</p>
                <p className="mt-3 text-2xl font-semibold text-ink-900">{reports.length}</p>
              </div>
              <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">Total activities</p>
                <p className="mt-3 text-2xl font-semibold text-ink-900">{reports.reduce((sum, group) => sum + group.activities.length, 0)}</p>
              </div>
              <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-500">Selected employees</p>
                <p className="mt-3 text-2xl font-semibold text-ink-900">{selectedUserId ? selectedUserName || "Filter active" : "All"}</p>
              </div>
            </div>

            <div className="space-y-4">
              {reports.map((group) => (
                <div key={group.key} className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{group.user_name}</p>
                      <p className="mt-1 text-sm text-ink-500">{group.department_name} · {format(parseISO(group.attendance_date), "dd MMM yyyy")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge status={group.status} className="text-sm px-3 py-1 rounded-full" />
                      <span className="text-sm text-ink-600">{group.activities.length} activity{group.activities.length === 1 ? "" : "ies"}</span>
                    </div>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-ink-100 bg-ink-50">
                    <table className="w-full min-w-155 text-left text-sm">
                      <thead>
                        <tr className="border-b border-ink-200 bg-white text-xs uppercase tracking-wide text-ink-500">
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Subtype</th>
                          <th className="px-3 py-2">Quantity</th>
                          <th className="px-3 py-2">Duration</th>
                          <th className="px-3 py-2">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {group.activities.map((activity) => (
                          <tr key={activity.id} className="hover:bg-white/80">
                            <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.type_name || "—"}</td>
                            <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.subtype_name || "—"}</td>
                            <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.quantity ?? "—"}</td>
                            <td className="px-3 py-2 text-ink-700 whitespace-nowrap">{activity.duration || "—"}</td>
                            <td className="max-w-65 table-cell-clamp px-3 py-2 text-ink-600" title={activity.description || ""}>{activity.description || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm text-ink-600">
                    <span>Total duration</span>
                    <span className="font-semibold text-ink-900">{getTotalDuration(group.activities)}</span>
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
