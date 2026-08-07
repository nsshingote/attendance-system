"use client";

/**
 * components/Dashboard/AdminDashboard.tsx
 * Admin/SuperAdmin landing dashboard: their own check-in/out card, stats
 * including Half Day, a full-width Today's Attendance table, and an
 * attendance breakdown chart below it.
 */

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Users, UserCheck, Clock, UserX, Plane, ClipboardEdit, Smartphone, Sunrise, CalendarDays } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import StatCard from "./StatCard";
import AttendanceChart from "./AttendanceChart";
import TodayAttendanceTable from "./TodayAttendanceTable";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";
import CheckInButton from "@/components/Attendance/CheckInButton";
import CheckOutButton from "@/components/Attendance/CheckOutButton";

interface DashboardSummary {
  total_employees: number;
  present_today: number;
  late_today: number;
  half_day_today: number;
  absent_today: number;
  on_leave_today?: number;
  pending_corrections: number;
  pending_leave_requests: number;  // Changed from pending_leaves to match backend
  pending_device_requests: number;
  holiday_today: number;
  monthly_leave_used?: number;
  today_attendance?: any[];
}

interface SelfSnapshot {
  check_in: string | null;
  check_out: string | null;
  today_status: string;
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selfSnapshot, setSelfSnapshot] = useState<SelfSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSelfSnapshot = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard/me");
      setSelfSnapshot({
        check_in: data.check_in || null,
        check_out: data.check_out || null,
        today_status: data.today_status || "Absent",
      });
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const { data } = await api.get<DashboardSummary>("/dashboard/admin");
        console.log("📊 Dashboard data:", data);
        setSummary(data);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
    fetchSelfSnapshot();
  }, [fetchSelfSnapshot]);

  if (loading) return <Loading fullScreen />;
  if (!summary) return <p className="text-sm text-ink-500">Unable to load dashboard data.</p>;

  const attendanceData = [
    { status: "Present", count: summary.present_today || 0 },
    { status: "Late", count: summary.late_today || 0 },
    { status: "Half Day", count: summary.half_day_today || 0 },
    { status: "Absent", count: summary.absent_today || 0 },
    { status: "Holiday", count: summary.holiday_today || 0 },
  ];

  const checkedIn = selfSnapshot?.check_in !== null && selfSnapshot?.check_in !== undefined;
  const checkedOut = selfSnapshot?.check_out !== null && selfSnapshot?.check_out !== undefined;

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="space-y-5 pb-4 md:space-y-6 md:pb-6">
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-900">Dashboard</h1>
              <p className="mt-1 text-sm text-ink-500">Overview of today&apos;s workforce activity</p>
            </div>
            <div className="rounded-3xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
              <span className="font-semibold text-ink-900">Updated Today</span> · {format(new Date(), "EEEE, dd MMM yyyy")}
            </div>
          </div>
        </div>

        {selfSnapshot && (
          <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm text-ink-500">Your Attendance Today</p>
                <div className="mt-2">
                  <Badge status={selfSnapshot.today_status} className="text-sm px-3 py-1 rounded-full" />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <CheckInButton
                  disabled={checkedIn}
                  onSuccess={fetchSelfSnapshot}
                />
                <CheckOutButton
                  disabled={!checkedIn || checkedOut}
                  onSuccess={fetchSelfSnapshot}
                />
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Employees" value={summary.total_employees} icon={Users} tone="brand" />
          <StatCard label="Present Today" value={summary.present_today} icon={UserCheck} tone="green" />
          <StatCard label="Late Today" value={summary.late_today} icon={Clock} tone="lime" />
          <StatCard label="Half Day Today" value={summary.half_day_today} icon={Sunrise} tone="violet" />
          <StatCard label="Absent Today" value={summary.absent_today} icon={UserX} tone="red" />
          <StatCard label="Pending Leaves" value={summary.pending_leave_requests} icon={Plane} tone="amber" />
          <StatCard label="Pending Corrections" value={summary.pending_corrections} icon={ClipboardEdit} tone="amber" />
          <StatCard label="Holidays This Month" value={summary.holiday_today || 0} icon={CalendarDays} tone="violet" />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Today&apos;s Attendance</h2>
                <p className="mt-1 text-sm text-ink-500">Quick view of check-in status, hours worked and pending reports.</p>
              </div>
              <span className="inline-flex rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-xs text-ink-600">Live update</span>
            </div>
          </div>

          <div className="w-full overflow-x-auto rounded-2xl border border-ink-200 bg-white shadow-card">
            <TodayAttendanceTable />
          </div>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
          <AttendanceChart data={attendanceData} />
        </div>
      </div>
    </div>
  );
}