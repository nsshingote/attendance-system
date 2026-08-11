"use client";

/**
 * app/users/id/page.tsx
 * Admin/SuperAdmin: single-employee detail view — profile, monthly
 * attendance chart, and calendar side by side.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import UserSummary from "@/components/Users/UserSummary";
import UserCalendar from "@/components/Users/UserCalender";
import UserAttendanceChart from "@/components/Users/AttendanceChart";
import MonthSelector from "@/components/Calendar/MonthSelector";

interface UserDetail {
  id: number;
  name: string;
  mobile: string;
  email: string | null;
  department: string;
  designation: string;
  role: string;
  status: string;
  annual_leave: number;
  leave_encashed: number;
}

interface AttendanceSummary {
  Present: number;
  "Half Day": number;
  Holiday: number;
  Absent: number;
  WFH: number;
  Leave: number;
  "Total Hours": number;
}

type SelectedCalendarDay = {
  date: string;
  status?: string;
  leave_category?: string | null;
  working_day_label?: "Working Day" | "Extra Working Day" | null;
  day_type?: string;
};

const defaultAttendanceSummary: AttendanceSummary = {
  Present: 0,
  "Half Day": 0,
  Holiday: 0,
  Absent: 0,
  WFH: 0,
  Leave: 0,
  "Total Hours": 0,
};

export default function UserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const today = new Date();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary>(defaultAttendanceSummary);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSummary, setRangeSummary] = useState<AttendanceSummary | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedDay, setSelectedDay] = useState<SelectedCalendarDay | null>(null);

  const handleSelectDay = (day: SelectedCalendarDay) => {
    setSelectedDate(day.date);
    setSelectedDay(day);
  };

  const handleSelectedDateChange = (value: string) => {
    setSelectedDate(value);
    setSelectedDay(null);

    if (!value) return;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setYear(parsed.getFullYear());
      setMonth(parsed.getMonth() + 1);
    }
  };

  const loadUserData = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const { data } = await api.get<UserDetail>(`/users/${userId}`);
      setUser(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadAttendanceSummary = async () => {
    if (!userId) return;
    setAttendanceLoading(true);
    try {
      const { data } = await api.get<AttendanceSummary>(`/attendance/summary/${userId}`, {
        params: { year, month },
      });
      setAttendanceSummary(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleAverageRange = async () => {
    if (!userId) return;
    if (!fromDate || !toDate) {
      toast.error("Please select both From Date and To Date.");
      return;
    }
    if (new Date(fromDate) > new Date(toDate)) {
      toast.error("From Date cannot be after To Date.");
      return;
    }

    setRangeLoading(true);
    try {
      const { data } = await api.get<AttendanceSummary>(`/attendance/summary/${userId}`, {
        params: {
          from_date: fromDate,
          to_date: toDate,
        },
      });
      setRangeSummary(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRangeLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
  }, [userId]);

  useEffect(() => {
    loadAttendanceSummary();
  }, [userId, year, month]);

  const formatAverageHours = (totalHours: number, presentDays: number) => {
    if (!presentDays || totalHours <= 0) {
      return "0h 0m";
    }
    const average = totalHours / presentDays;
    const hours = Math.floor(average);
    const minutes = Math.round((average - hours) * 60);
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  };

  const activeDays = attendanceSummary.Present + attendanceSummary["Half Day"] + attendanceSummary.WFH;
  const averageWorkingHours = formatAverageHours(attendanceSummary["Total Hours"], activeDays);
  const rangeActiveDays = rangeSummary
    ? rangeSummary.Present + rangeSummary["Half Day"] + rangeSummary.WFH
    : 0;
  const rangeAverageWorkingHours = rangeSummary
    ? formatAverageHours(rangeSummary["Total Hours"], rangeActiveDays)
    : "-";

  if (loading) {
    return (
      <AppShell allowedRoles={["admin", "superadmin"]}>
        <Loading fullScreen />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell allowedRoles={["admin", "superadmin"]}>
        <p className="text-sm text-ink-500">User not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        {/* User Summary */}
        <UserSummary user={user} />

        <div className="grid grid-cols-1 gap-6">
          <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-6">
            {/* Chart Section */}
            <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-ink-900">Attendance Breakdown</h3>
                <MonthSelector
                  year={year}
                  month={month}
                  onChange={(y, m) => {
                    setYear(y);
                    setMonth(m);
                    setSelectedDate("");
                    setSelectedDay(null);
                  }}
                />
              </div>
              <UserAttendanceChart userId={user.id} year={year} month={month} />
            </div>

            {/* Average Working Hours */}
            <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-ink-900">Average Working Hours</h3>
              </div>
              <div className="rounded-2xl bg-ink-50 p-6">
                <div className="grid gap-4">
                  <p className="text-sm text-ink-600">Average across present days, half days, and approved WFH</p>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm text-ink-600">
                      From Date
                      <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1 text-sm text-ink-600">
                      To Date
                      <input
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <button
                    onClick={handleAverageRange}
                    disabled={rangeLoading}
                    className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {rangeLoading ? "Calculating..." : "Average"}
                  </button>

                  <div className="rounded-xl bg-white p-4 border border-ink-200 text-center">
                    <p className="text-sm text-ink-600">Selected range average</p>
                    <p className="mt-3 text-2xl font-semibold text-ink-900">
                      {rangeSummary ? rangeAverageWorkingHours : "—"}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm text-ink-600">
                    <div className="rounded-xl bg-white p-4 border border-ink-200">
                      <p className="font-medium text-ink-700">Total Hours</p>
                      <p className="mt-1 text-ink-900">{rangeSummary ? `${rangeSummary["Total Hours"]}h` : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-white p-4 border border-ink-200">
                      <p className="font-medium text-ink-700">Present Days</p>
                      <p className="mt-1 text-ink-900">{rangeSummary ? rangeActiveDays : "—"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Calendar Section */}
          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-ink-900">Attendance Calendar</h3>
              <div className="grid gap-3 sm:flex sm:items-center sm:gap-3">
                <MonthSelector
                  year={year}
                  month={month}
                  onChange={(y, m) => {
                    setYear(y);
                    setMonth(m);
                    setSelectedDate("");
                    setSelectedDay(null);
                  }}
                />
                <label className="min-w-0 text-sm text-ink-700">
                  Select date
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleSelectedDateChange(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
            <UserCalendar
              userId={user.id}
              year={year}
              month={month}
              selectedDate={selectedDate || undefined}
              onSelectDay={handleSelectDay}
              canOverride
            />
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Attendance Status</h3>
                <p className="mt-1 text-sm text-ink-500">Selected day status and override details.</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4">
                <p className="text-sm text-ink-500">Selected date</p>
                <p className="mt-2 text-lg font-semibold text-ink-900">
                  {selectedDate ? new Date(selectedDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No date selected"}
                </p>
              </div>
              {selectedDay ? (
                <div className="rounded-2xl border border-ink-200 bg-white p-4">
                  <div className="space-y-3 text-sm text-ink-600">
                    <p>
                      <span className="font-medium text-ink-900">Status:</span> {selectedDay.status || "Unknown"}
                    </p>
                    {selectedDay.leave_category && (
                      <p>
                        <span className="font-medium text-ink-900">Leave category:</span> {selectedDay.leave_category}
                      </p>
                    )}
                    {selectedDay.working_day_label && (
                      <p>
                        <span className="font-medium text-ink-900">Day type:</span> {selectedDay.working_day_label}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-500">
                  Choose a day on the calendar or use the date selector to view override status here.
                </div>
              )}
              <div className="rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-600">
                Override actions are shown here when a date is selected. Use the attendance page for detailed override controls.
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}