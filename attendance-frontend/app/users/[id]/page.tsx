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
              <p className="text-sm text-ink-500">Assign, remove, or change the user's primary department.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
            <div className="space-y-3">
              {assignments.length === 0 ? (
                <p className="text-sm text-ink-500">No department assignments found for this user.</p>
              ) : (
                <div className="space-y-3">
                  {assignments.map((assignment) => (
                    <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-ink-50 p-4">
                      <div>
                        <p className="font-medium text-ink-900">{assignment.department_name}</p>
                        {assignment.is_primary ? (
                          <p className="text-xs text-green-700">Primary department</p>
                        ) : (
                          <p className="text-xs text-ink-500">Secondary assignment</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!assignment.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(assignment)}
                            disabled={savingAssignment}
                            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                          >
                            Make Primary
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveAssignment(assignment)}
                          disabled={savingAssignment}
                          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-4">
              <h4 className="text-sm font-semibold text-ink-900">Add Department Assignment</h4>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Department</label>
                  <select
                    value={selectedDepartmentId || ""}
                    onChange={(e) => setSelectedDepartmentId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  >
                    <option value="">Select Department</option>
                    {availableDepartments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="newPrimary"
                    type="checkbox"
                    checked={newPrimary}
                    onChange={(e) => setNewPrimary(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="newPrimary" className="text-sm text-ink-600">Set as primary department</label>
                </div>
                <button
                  onClick={handleAssignDepartment}
                  disabled={savingAssignment || !selectedDepartmentId}
                  className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  Assign Department
                </button>
              </div>
            </div>
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