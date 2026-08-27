"use client";

/**
 * components/Dashboard/AdminDashboard.tsx
 * Admin/SuperAdmin landing dashboard: their own check-in/out card, stats
 * including Half Day, a full-width Today's Attendance table, and an
 * attendance breakdown chart below it.
 */

import { useEffect, useState, useCallback } from "react";
import { Users, UserCheck, Clock, UserX, Plane, ClipboardEdit, Smartphone, Sunrise, CalendarDays, House, MessageSquare } from "lucide-react";
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
  wfh_today?: number;
  extra_working_day_today?: number;
  pending_corrections: number;
  pending_leave_requests: number;
  pending_half_day_requests: number;
  pending_wfh_requests: number;
  feedback_count: number;
  new_feedback_count: number;
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
    { status: "WFH", count: summary.wfh_today || 0 },
    { status: "Extra Working Day", count: summary.extra_working_day_today || 0 },
    { status: "Absent", count: summary.absent_today || 0 },
    { status: "Holiday", count: summary.holiday_today || 0 },
  ];

  const checkedIn = selfSnapshot?.check_in !== null && selfSnapshot?.check_in !== undefined;
  const checkedOut = selfSnapshot?.check_out !== null && selfSnapshot?.check_out !== undefined;

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-ink-900">Dashboard</h1>
          <p className="text-sm text-ink-500">Overview of today&apos;s workforce activity</p>
        </div>

        {selfSnapshot && (
          <div className="rounded-xl border border-ink-200 bg-white p-4 md:p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-ink-500">Your Attendance Today</p>
                <div className="mt-1.5">
                  <Badge status={selfSnapshot.today_status} />
                </div>
              </div>
              <div className="flex gap-3">
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total Employees" value={summary.total_employees} icon={Users} tone="brand" />
          <StatCard label="Present Today" value={summary.present_today} icon={UserCheck} tone="green" />
          <StatCard label="Late Today" value={summary.late_today} icon={Clock} tone="lime" />
          <StatCard label="Half Day Today" value={summary.half_day_today} icon={Sunrise} tone="violet" />
          <StatCard label="Absent Today" value={summary.absent_today} icon={UserX} tone="red" />
          <StatCard label="Pending Leaves" value={summary.pending_leave_requests} icon={Plane} tone="amber" />
          <StatCard label="Pending Half Day" value={summary.pending_half_day_requests} icon={Sunrise} tone="violet" />
          <StatCard label="Pending WFH" value={summary.pending_wfh_requests} icon={House} tone="violet" />
          <StatCard label="WFH Today" value={summary.wfh_today || 0} icon={House} tone="violet" />
          <StatCard label="Pending Requests" value={summary.pending_corrections} icon={ClipboardEdit} tone="amber" />
          <StatCard label="New Feedback" value={summary.new_feedback_count} icon={MessageSquare} tone="green" />
          <StatCard label="Holidays This Month" value={summary.holiday_today || 0} icon={CalendarDays} tone="violet" />
        </div>

        {/* Today's Attendance Table */}
        <div className="w-full min-w-0">
          <TodayAttendanceTable />
        </div>

        {/* Attendance Breakdown Chart */}
        <div className="w-full">
          <AttendanceChart data={attendanceData} />
        </div>
      </div>
    </div>
  );
}
