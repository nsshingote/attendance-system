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

export default function UserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const today = new Date();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      api.get<UserDetail>(`/users/${userId}`),
      api.get(`/leave/balance/${userId}`),
    ])
      .then(([userRes]) => {
        setUser(userRes.data);
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [userId]);

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

        {/* Chart & Calendar side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                }}
              />
            </div>
            <UserAttendanceChart userId={user.id} year={year} month={month} />
          </div>

          {/* Calendar Section */}
          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-ink-900">Attendance Calendar</h3>
              <MonthSelector
                year={year}
                month={month}
                onChange={(y, m) => {
                  setYear(y);
                  setMonth(m);
                }}
              />
            </div>
            <UserCalendar userId={user.id} year={year} month={month} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}