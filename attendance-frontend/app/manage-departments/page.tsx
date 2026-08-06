"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";

interface Department {
  id: number;
  name: string;
  is_active: boolean;
}

interface UserOption {
  id: number;
  name: string;
  email?: string | null;
  role?: string;
}

interface UserDepartmentAssignment {
  id: number;
  user_id: number;
  department_id: number;
  is_primary: boolean;
  created_at: string;
  department_name?: string;
}

export default function ManageDepartmentsPage() {
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<UserDepartmentAssignment[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [newPrimary, setNewPrimary] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [departmentToDeleteId, setDepartmentToDeleteId] = useState<number | null>(null);
  const [reassignDepartmentId, setReassignDepartmentId] = useState<number | null>(null);
  const [reassignmentCompleted, setReassignmentCompleted] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState<number | null>(null);
  const [reportTypeCount, setReportTypeCount] = useState<number | null>(null);
  const [reportSubtypeCount, setReportSubtypeCount] = useState<number | null>(null);
  const [defaultRowCount, setDefaultRowCount] = useState<number | null>(null);
  const [reportDataCount, setReportDataCount] = useState<number | null>(null);
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [deletingDepartment, setDeletingDepartment] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        await Promise.all([loadDepartments(), loadUsers()]);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadUserAssignments(selectedUserId);
    } else {
      setAssignments([]);
    }
  }, [selectedUserId]);

  const loadDepartments = async () => {
    try {
      const { data } = await api.get<Department[]>("/reports/departments");
      setDepartments(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const loadUsers = async () => {
    try {
      const { data } = await api.get<UserOption[]>("/users/");
      setUsers(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const loadDepartmentAssignments = async (deptId: number) => {
    try {
      const res = await api.get(`/reports/admin/departments/${deptId}/assignments`);
      setAssignmentCount(res.data.count ?? 0);
      setReportTypeCount(res.data.report_type_count ?? 0);
      setReportSubtypeCount(res.data.report_subtype_count ?? 0);
      setDefaultRowCount(res.data.default_row_count ?? 0);
      setReportDataCount(res.data.report_data_count ?? 0);
    } catch (error) {
      setAssignmentCount(null);
      setReportTypeCount(null);
      setReportSubtypeCount(null);
      setDefaultRowCount(null);
      setReportDataCount(null);
    }
  };

  const loadUserAssignments = async (userId: number) => {
    try {
      const { data } = await api.get<UserDepartmentAssignment[]>(`/users/${userId}/departments`);
      const assignmentList = data.map((assignment) => ({
        ...assignment,
        department_name: departments.find((dept) => dept.id === assignment.department_id)?.name || "Unknown",
      }));
      setAssignments(assignmentList);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDepartmentDeleteChange = async (deptId: number | null) => {
    setDepartmentToDeleteId(deptId);
    setReassignDepartmentId(null);
    setReassignmentCompleted(false);
    if (deptId) {
      await loadDepartmentAssignments(deptId);
    } else {
      setAssignmentCount(null);
      setReportTypeCount(null);
      setReportSubtypeCount(null);
      setDefaultRowCount(null);
      setReportDataCount(null);
    }
  };

  const handleCreateDepartment = async () => {
    if (!newDeptName.trim()) {
      toast.error("Enter a department name");
      return;
    }

    setCreatingDepartment(true);
    try {
      const { data } = await api.post("/reports/admin/departments", { name: newDeptName.trim() });
      toast.success("Department created successfully");
      setDepartments((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDeptName("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCreatingDepartment(false);
    }
  };

  const handleReassignUsers = async () => {
    if (!departmentToDeleteId || !reassignDepartmentId) {
      toast.error("Select another department before reassignment.");
      return;
    }

    try {
      await api.post(`/reports/admin/departments/${departmentToDeleteId}/reassign-users`, {
        target_department_id: reassignDepartmentId,
      });
      toast.success("Users reassigned successfully.");
      setReassignmentCompleted(true);
      await loadDepartmentAssignments(departmentToDeleteId);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDeleteDepartment = async () => {
    if (!departmentToDeleteId) {
      toast.error("Select a department to delete");
      return;
    }

    if ((assignmentCount ?? 0) > 0 && !reassignmentCompleted) {
      toast.error("Reassign users before deleting this department.");
      return;
    }

    const departmentName = departments.find((dept) => dept.id === departmentToDeleteId)?.name || "this department";
    if (!confirm(`Delete department ${departmentName}? This will remove it from future use and preserve historical reports.`)) {
      return;
    }

    setDeletingDepartment(true);
    try {
      await api.delete(`/reports/admin/departments/${departmentToDeleteId}`);
      toast.success("Department deleted successfully");
      setDepartmentToDeleteId(null);
      setReassignDepartmentId(null);
      setReassignmentCompleted(false);
      setAssignmentCount(null);
      setReportTypeCount(null);
      setReportSubtypeCount(null);
      setDefaultRowCount(null);
      setReportDataCount(null);
      await loadDepartments();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeletingDepartment(false);
    }
  };

  const handleAssignDepartment = async () => {
    if (!selectedUserId || !selectedDepartmentId) {
      toast.error("Choose a user and a department to assign");
      return;
    }

    setSavingAssignment(true);
    try {
      await api.post(`/users/${selectedUserId}/departments`, {
        department_id: selectedDepartmentId,
        is_primary: newPrimary,
      });
      toast.success(newPrimary ? "Primary department assigned" : "Secondary department assigned");
      setSelectedDepartmentId(null);
      setNewPrimary(false);
      await loadUserAssignments(selectedUserId);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleSetPrimary = async (assignment: UserDepartmentAssignment) => {
    if (!selectedUserId) return;
    setSavingAssignment(true);
    try {
      await api.put(`/users/${selectedUserId}/departments/primary`, {
        department_id: assignment.department_id,
        is_primary: true,
      });
      toast.success("Primary department updated");
      await loadUserAssignments(selectedUserId);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRemoveAssignment = async (assignment: UserDepartmentAssignment) => {
    if (!selectedUserId) return;
    if (!confirm(`Remove ${assignment.department_name || "this department"} from this user?`)) return;

    setSavingAssignment(true);
    try {
      await api.delete(`/users/${selectedUserId}/departments/${assignment.id}`);
      toast.success("Department assignment removed");
      await loadUserAssignments(selectedUserId);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingAssignment(false);
    }
  };

  const availableDepartmentsForUser = departments.filter(
    (dept) => !assignments.some((assignment) => assignment.department_id === dept.id)
  );

  if (loading) return <Loading fullScreen />;

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Manage Departments</h1>
          <p className="text-sm text-ink-500">
            Create departments, remove them safely, and manage user department assignments without changing historical report data.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
              <h2 className="text-base font-semibold text-ink-900">Create Department</h2>
              <p className="mt-1 text-sm text-ink-500">Add a new department for future reporting and department assignment flows.</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Department name"
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                />
                <button
                  onClick={handleCreateDepartment}
                  disabled={creatingDepartment}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  {creatingDepartment ? "Creating..." : "Create Department"}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-red-200 bg-white p-6 shadow-card">
              <h2 className="text-base font-semibold text-ink-900">Delete Department</h2>
              <p className="mt-1 text-sm text-ink-500">Reassign users before removing a department so future reporting continues smoothly.</p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Department to Delete</label>
                  <select
                    value={departmentToDeleteId || ""}
                    onChange={(e) => handleDepartmentDeleteChange(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  >
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Reassign Users To</label>
                  <select
                    value={reassignDepartmentId || ""}
                    onChange={(e) => {
                      setReassignDepartmentId(e.target.value ? Number(e.target.value) : null);
                      setReassignmentCompleted(false);
                    }}
                    disabled={!departmentToDeleteId}
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm disabled:bg-ink-50"
                  >
                    <option value="">Select department</option>
                    {departments.filter((dept) => dept.id !== departmentToDeleteId).map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {departmentToDeleteId && assignmentCount !== null && (
                <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
                  <p className="font-medium">This department has {assignmentCount} assigned user{assignmentCount === 1 ? "" : "s"}.</p>
                  <div className="mt-2 space-y-1 text-xs text-yellow-800">
                    <p>{reportTypeCount !== null ? `${reportTypeCount} report type${reportTypeCount === 1 ? "" : "s"}` : "Loading report type count..."}</p>
                    <p>{reportSubtypeCount !== null ? `${reportSubtypeCount} report subtype${reportSubtypeCount === 1 ? "" : "s"}` : "Loading report subtype count..."}</p>
                    <p>{defaultRowCount !== null ? `${defaultRowCount} default row${defaultRowCount === 1 ? "" : "s"}` : "Loading default row count..."}</p>
                    <p>{reportDataCount !== null ? `${reportDataCount} report data row${reportDataCount === 1 ? "" : "s"}` : "Loading report data count..."}</p>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={handleReassignUsers}
                  disabled={!departmentToDeleteId || !reassignDepartmentId || reassignmentCompleted || (assignmentCount ?? 0) === 0}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  {reassignmentCompleted ? "Reassignment Complete" : "Reassign Users"}
                </button>
                <button
                  onClick={handleDeleteDepartment}
                  disabled={!departmentToDeleteId || ((assignmentCount ?? 0) > 0 && !reassignmentCompleted) || deletingDepartment}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deletingDepartment ? "Deleting..." : "Delete Department"}
                </button>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
            <h2 className="text-base font-semibold text-ink-900">User Department Assignments</h2>
            <p className="mt-1 text-sm text-ink-500">Assign a department as the primary or a secondary department for any user here.</p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Select User</label>
                <select
                  value={selectedUserId || ""}
                  onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <option value="">Select user</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>

              {selectedUserId && (
                <>
                  <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
                    <div className="space-y-3">
                      {assignments.length === 0 ? (
                        <p className="text-sm text-ink-500">No department assignments yet.</p>
                      ) : (
                        assignments.map((assignment) => (
                          <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white p-3">
                            <div>
                              <p className="font-medium text-ink-900">{assignment.department_name}</p>
                              <p className="text-xs text-ink-500">{assignment.is_primary ? "Primary department" : "Secondary department"}</p>
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
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-ink-200 p-4">
                    <h3 className="text-sm font-semibold text-ink-900">Add New Assignment</h3>
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-ink-700">Department</label>
                        <select
                          value={selectedDepartmentId || ""}
                          onChange={(e) => setSelectedDepartmentId(e.target.value ? Number(e.target.value) : null)}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                        >
                          <option value="">Select department</option>
                          {availableDepartmentsForUser.map((dept) => (
                            <option key={dept.id} value={dept.id}>{dept.name}</option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-ink-600">
                        <input
                          type="checkbox"
                          checked={newPrimary}
                          onChange={(e) => setNewPrimary(e.target.checked)}
                          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        />
                        Set as primary department
                      </label>
                      <button
                        onClick={handleAssignDepartment}
                        disabled={savingAssignment || !selectedDepartmentId}
                        className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                      >
                        {savingAssignment ? "Saving..." : "Assign Department"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
