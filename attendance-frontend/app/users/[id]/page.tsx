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

interface DepartmentOption {
  id: number;
  name: string;
}

interface UserDepartmentAssignment {
  id: number;
  user_id: number;
  department_id: number;
  is_primary: boolean;
  created_at: string;
  department_name?: string;
}

export default function UserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const today = new Date();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [assignments, setAssignments] = useState<UserDepartmentAssignment[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [newPrimary, setNewPrimary] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);

  const loadUserData = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const [userRes, deptRes, assignmentRes] = await Promise.all([
        api.get<UserDetail>(`/users/${userId}`),
        api.get<DepartmentOption[]>(`/reports/departments`),
        api.get<UserDepartmentAssignment[]>(`/users/${userId}/departments`),
      ]);

      setUser(userRes.data);
      setDepartments(deptRes.data);

      const assignmentList = assignmentRes.data.map((assignment) => ({
        ...assignment,
        department_name: deptRes.data.find((dept) => dept.id === assignment.department_id)?.name || "Unknown",
      }));
      setAssignments(assignmentList);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
  }, [userId]);

  const availableDepartments = departments.filter(
    (dept) => !assignments.some((assignment) => assignment.department_id === dept.id)
  );

  const handleAssignDepartment = async () => {
    if (!selectedDepartmentId) {
      toast.error("Choose a department to assign");
      return;
    }

    setSavingAssignment(true);
    try {
      await api.post(`/users/${userId}/departments`, {
        department_id: selectedDepartmentId,
        is_primary: newPrimary,
      });
      toast.success("Department assigned successfully");
      setSelectedDepartmentId(null);
      setNewPrimary(false);
      await loadUserData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleSetPrimary = async (assignment: UserDepartmentAssignment) => {
    setSavingAssignment(true);
    try {
      await api.put(`/users/${userId}/departments/primary`, {
        department_id: assignment.department_id,
        is_primary: true,
      });
      toast.success("Primary department updated");
      await loadUserData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRemoveAssignment = async (assignment: UserDepartmentAssignment) => {
    if (!confirm(`Remove ${assignment.department_name} from ${user?.name}?`)) return;
    setSavingAssignment(true);
    try {
      await api.delete(`/users/${userId}/departments/${assignment.id}`);
      toast.success("Department assignment removed");
      await loadUserData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

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

        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Department Assignments</h3>
              <p className="text-sm text-ink-500">Primary and secondary department assignments are now managed from the Manage Departments page.</p>
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
            Use the Manage Departments section in the admin sidebar to create departments, delete them safely, reassign users, and manage each user&apos;s primary or secondary department assignments.
          </div>
        </div>

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