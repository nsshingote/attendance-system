
"use client";

/**
 * app/attendance/page.tsx
 * Employee: own attendance (table + calendar). Admin/SuperAdmin: same page
 * but can pick any employee via a dropdown to view their records.
 *
 * Note: Half Day marking now lives on the Leave page only (app/leave/page.tsx).
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import MonthSelector from "@/components/Calendar/MonthSelector";
import UserCalendar from "@/components/Users/UserCalender";
import AttendanceTable, { AttendanceRecord } from "@/components/Attendance/AttendanceTable";
import CorrectionForm from "@/components/Corrections/Correctionform";
import { Calendar as CalendarIcon } from "lucide-react";

interface UserOption {
  id: number;
  name: string;
}

interface ReportData {
  attendance_date: string;
  report_display: string | null;
}

export default function AttendancePage() {
  const session = getSession();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [view, setView] = useState<"table" | "calendar">("table");
  
  // Date filter state
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(session?.userId);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState({ Present: 0, "Half Day": 0, Absent: 0, Holiday: 0, Leave: 0 });
  const [loading, setLoading] = useState(true);

  const [correctionModal, setCorrectionModal] = useState<AttendanceRecord | null>(null);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const admin = isAdmin(session?.role);

  // Add "All Employees" option for admin
  const userOptions = admin ? [{ id: -1, name: "All Employees" }, ...users] : users;

  useEffect(() => {
    if (!admin) return;
    api
      .get<UserOption[]>("/users/")
      .then(({ data }) => setUsers(data))
      .catch(() => {});
  }, [admin]);

  const fetchData = useCallback(async () => {
    if (!selectedUserId && selectedUserId !== -1) return;
    setLoading(true);
    try {
      // Build params with date filter if selected
      const params: any = { year, month };
      if (selectedDate) {
        params.date_value = selectedDate;
      }

      let attendanceUrl = "";
      let userId = selectedUserId;

      // If "All Employees" selected (id: -1), use the user list endpoint
      if (selectedUserId === -1) {
        attendanceUrl = "/attendance/all";
        // Remove user_id from params
        delete params.user_id;
      } else {
        attendanceUrl = admin && selectedUserId !== session?.userId
          ? `/attendance/user/${selectedUserId}`
          : "/attendance/me";
        if (selectedUserId) {
          params.user_id = selectedUserId;
        }
      }

      const [recordsRes, summaryRes] = await Promise.all([
  api.get<AttendanceRecord[]>(attendanceUrl, { params }),
  api.get(
    `/attendance/summary/${
      userId === -1 ? session?.userId : userId || session?.userId
    }`,
    { params: { year, month } }
  ).catch(() => ({ data: {} })),
]);

const recordsWithReport = (recordsRes.data || []).map((record: any) => ({
  ...record,
  report:
    typeof record.has_report === "boolean"
      ? record.has_report
        ? "Submitted"
        : "Not Submitted"
      : record.report || "Not Submitted",
}));

setRecords(recordsWithReport || []);

setSummary(
  summaryRes.data || {
    Present: 0,
    "Half Day": 0,
    Absent: 0,
    Holiday: 0,
    Leave: 0,
  }
);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedUserId, year, month, admin, session?.userId, selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Clear date filter
  const applyDateFilter = (dateValue: string) => {
    setSelectedDate(dateValue);
    if (dateValue) {
      const parsed = new Date(dateValue);
      setYear(parsed.getFullYear());
      setMonth(parsed.getMonth() + 1);
    }
  };

  const clearDateFilter = () => {
    setSelectedDate("");
    setShowDatePicker(false);
  };

  const submitCorrection = async () => {
    if (!correctionModal) {
      toast.error("No correction selected");
      return;
    }
    setSubmittingCorrection(true);
    try {
      // This will be handled by the CorrectionForm component
      setCorrectionModal(null);
      toast.success("Correction request submitted");
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmittingCorrection(false);
    }
  };

  return (
    <AppShell>
      <div className="w-full max-w-full overflow-x-hidden">
        <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg md:text-xl font-semibold text-ink-900">Attendance</h1>
              <p className="text-sm text-ink-500">
                {admin && selectedUserId !== session?.userId 
                  ? selectedUserId === -1 
                    ? "Viewing all employees" 
                    : "Viewing employee records" 
                  : "Your attendance history"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {admin && (
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(Number(e.target.value))}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                >
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Date Picker Button */}
              <div className="relative min-w-45">
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className={`flex min-w-0 items-center gap-1 rounded-lg border px-3 py-2 text-sm ${
                    selectedDate ? "border-brand-500 bg-brand-50 text-brand-600" : "border-ink-200 bg-white text-ink-600"
                  }`}
                >
                  <CalendarIcon size={16} />
                  {selectedDate ? new Date(selectedDate).toLocaleDateString() : "Date"}
                  {selectedDate && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        clearDateFilter();
                      }}
                      className="ml-1 cursor-pointer text-ink-400 hover:text-ink-600"
                    >
                      ×
                    </span>
                  )}
                </button>

                {showDatePicker && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowDatePicker(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-55 w-65 rounded-lg border border-ink-200 bg-white p-3 shadow-lg">
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => {
                          applyDateFilter(e.target.value);
                          setShowDatePicker(false);
                        }}
                        className="w-full rounded border border-ink-200 px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            const today = new Date().toISOString().split("T")[0];
                            applyDateFilter(today);
                            setShowDatePicker(false);
                          }}
                          className="flex-1 rounded bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
                        >
                          Today
                        </button>
                        <button
                          onClick={clearDateFilter}
                          className="flex-1 rounded border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
                <button
                  onClick={() => setView("table")}
                  className={`rounded-md px-3 py-1.5 font-medium ${view === "table" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                >
                  Table
                </button>
                <button
                  onClick={() => setView("calendar")}
                  className={`rounded-md px-3 py-1.5 font-medium ${view === "calendar" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                >
                  Calendar
                </button>
              </div>

              <MonthSelector
                year={year}
                month={month}
                onChange={(y, m) => {
                  setYear(y);
                  setMonth(m);
                  // Clear date filter when month changes
                  if (selectedDate) clearDateFilter();
                }}
              />
            </div>
          </div>

          {/* Show active filters */}
          {selectedDate && (
            <div className="flex items-center gap-2 text-sm text-ink-600">
              <span className="font-medium">Filtering by date:</span>
              <span className="rounded bg-brand-50 px-2 py-1 text-brand-700">
                {new Date(selectedDate).toLocaleDateString()}
              </span>
              <button
                onClick={clearDateFilter}
                className="text-ink-400 hover:text-ink-600"
              >
                × Clear
              </button>
            </div>
          )}

          {loading ? (
            <Loading />
          ) : view === "table" ? (
            <AttendanceTable
              records={records}
              showRequestCorrection={!admin || selectedUserId === session?.userId}
              onRequestCorrection={setCorrectionModal}
              showEmployeeName={selectedUserId === -1}
            />
          ) : (
            <div className="space-y-3">
              <UserCalendar
                userId={selectedUserId ?? session?.userId!}
                year={year}
                month={month}
                selectedDate={selectedDate || undefined}
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={!!correctionModal}
        onClose={() => setCorrectionModal(null)}
        title="Request Attendance Correction"
      >
        {correctionModal && (
          <CorrectionForm
            attendanceId={correctionModal.id}
            attendanceDate={correctionModal.attendance_date}
            onSuccess={() => {
              setCorrectionModal(null);
              fetchData();
            }}
            onCancel={() => setCorrectionModal(null)}
          />
        )}
      </Modal>
    </AppShell>
  );
}