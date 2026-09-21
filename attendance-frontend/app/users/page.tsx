

"use client";

/**
 * app/users/page.tsx
 * Admin/SuperAdmin: employee directory with search, add/edit, device reset,
 * and Active/Inactive status toggle (click the status badge in the table).
 */

import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Search from "@/components/Common/Search";
import Modal from "@/components/Common/Modal";
import UserTable, { UserRow } from "@/components/Users/UserTable";

interface UserFormValues {
  name: string;
  mobile: string;
  email: string;
  department: string;
  designation: string;
  place_of_posting: string;
  date_of_joining: string;
  role: string;
  role_id?: number;
  attendance_mode: "office" | "onsite";
  password: string;
}

export default function UsersPage() {
  const session = getSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [roles, setRoles] = useState<{ id: number; key: string; name: string; is_active: boolean }[]>([]);
  const [overridePermissions, setOverridePermissions] = useState<{ id: number; key: string; name: string }[]>([]);
  const [overrides, setOverrides] = useState<{ permission_id: number; permission_key: string; effect: string }[]>([]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserFormValues>();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<UserRow[]>("/users/", { params: { search: search || undefined } });
      setUsers(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const handleProfileUpdate = () => fetchUsers();
    window.addEventListener("profile-updated", handleProfileUpdate);
    return () => window.removeEventListener("profile-updated", handleProfileUpdate);
  }, [fetchUsers]);

  useEffect(() => {
    api
      .get<{ id: number; name: string }[]>("/reports/departments")
      .then(({ data }) => setDepartments(data))
      .catch(() => toast.error("Failed to load departments"));
  }, []);

  useEffect(() => {
    if (session?.role !== "superadmin") return;
    api.get<typeof roles>("/permissions/roles")
      .then(({ data }) => setRoles(data.filter((role) => role.is_active)))
      .catch(() => toast.error("Failed to load roles"));
  }, [session?.role]);

  const openCreateModal = () => {
    setEditingUser(null);
    reset({ name: "", mobile: "", email: "", department: "", designation: "", place_of_posting: "", date_of_joining: "", role: "user", attendance_mode: "office", password: "" });
    setModalOpen(true);
  };

  const openEditModal = (user: UserRow) => {
    setEditingUser(user);

    // Keep showing legacy `user.department` as a display value only —
    // any edits to department should be performed via the Departments
    // UI that manages `UserDepartment` assignments. If the department
    // string isn't in the dynamic list, show it as a non-selectable
    // fallback option to avoid blank dropdowns.
    const deptExists = departments.some((d) => d.name.toLowerCase() === (user.department || "").toLowerCase());
    if (user.department && !deptExists) {
      setDepartments((prev) => [...prev, { id: -1, name: user.department }]);
    }

    reset({
      name: user.name,
      mobile: user.mobile,
      email: user.email ?? "",
      department: user.department,
      designation: user.designation,
      place_of_posting: user.place_of_posting ?? "",
      date_of_joining: user.date_of_joining ?? "",
      role: user.role,
      role_id: user.role_id,
      attendance_mode: user.attendance_mode || "office",
      password: "",
    });
    setModalOpen(true);
    if (session?.role === "superadmin") {
      Promise.all([
        api.get<typeof overridePermissions>("/permissions/"),
        api.get<typeof overrides>(`/permissions/users/${user.id}/overrides`),
      ]).then(([permissionsResponse, overridesResponse]) => {
        setOverridePermissions(permissionsResponse.data);
        setOverrides(overridesResponse.data);
      }).catch(() => toast.error("Failed to load permission overrides"));
    }
  };

  const setOverride = async (permissionId: number, effect: string) => {
    if (!editingUser) return;
    try {
      if (effect === "inherit") await api.delete(`/permissions/users/${editingUser.id}/overrides/${permissionId}`);
      else await api.put(`/permissions/users/${editingUser.id}/overrides`, { permission_id: permissionId, effect });
      const { data } = await api.get<typeof overrides>(`/permissions/users/${editingUser.id}/overrides`);
      setOverrides(data);
    } catch (error) { toast.error(getErrorMessage(error)); }
  };

  const onSubmit = async (values: UserFormValues) => {
    setSubmitting(true);
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, {
          name: values.name,
          email: values.email || undefined,
          department: values.department,
          designation: values.designation,
          place_of_posting: values.place_of_posting || undefined,
          date_of_joining: values.date_of_joining || undefined,
          role: values.role,
          role_id: roles.find((role) => role.key === values.role)?.id,
          attendance_mode: values.attendance_mode,
        });
        toast.success("User updated");
      } else {
        await api.post("/users/", {
          name: values.name,
          mobile: values.mobile,
          email: values.email || undefined,
          department: values.department,
          designation: values.designation,
          place_of_posting: values.place_of_posting || undefined,
          date_of_joining: values.date_of_joining || undefined,
          role: values.role,
          role_id: roles.find((role) => role.key === values.role)?.id,
          attendance_mode: values.attendance_mode,
          password: values.password,
        });
        toast.success("User created");
      }
      setModalOpen(false);
      fetchUsers();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetDevice = async (user: UserRow) => {
    if (!confirm(`Reset registered device for ${user.name}?`)) return;
    try {
      await api.post(`/users/${user.id}/reset-device`);
      toast.success("Device reset. They can register a new one on next login.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleToggleStatus = async (user: UserRow) => {
    const newStatus = user.status === "active" ? "inactive" : "active";
    if (!confirm(`Mark ${user.name} as ${newStatus}?`)) return;
    try {
      await api.put(`/users/${user.id}`, { status: newStatus });
      toast.success(`${user.name} is now ${newStatus}`);
      fetchUsers();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  
  return (
    <AppShell requiredPermission="employees.all_view">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Users</h1>
            <p className="text-sm text-ink-500">Manage employees, admins, and their access</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:flex-none">
              <Search placeholder="Search by name, email, mobile" onSearch={setSearch} />
            </div>
            <button
              onClick={openCreateModal}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              <Plus size={16} />
              Add User
            </button>
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : (
          <>
            <UserTable
              users={users}
              onEdit={openEditModal}
              onResetDevice={handleResetDevice}
              onToggleStatus={handleToggleStatus}
            />
          </>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingUser ? "Edit User" : "Add User"}
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={submitting}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
            </button>
          </>
        }
      >
        <form className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Full Name</label>
            <input {...register("name", { required: true })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Mobile</label>
              <input
                {...register("mobile", { required: !editingUser })}
                disabled={!!editingUser}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm disabled:bg-ink-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Email</label>
              <input {...register("email")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Place of Posting</label><input {...register("place_of_posting")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" /></div>
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Date of Joining</label><input type="date" {...register("date_of_joining")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Department</label>
              <div className="flex gap-2">
                <select
                  {...register("department", { required: true })}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <option value="">Select Department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.name}>{dept.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Designation</label>
              <input {...register("designation", { required: true })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Role</label>
            {session?.role === "superadmin" ? (
              <select {...register("role")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                {roles.map((role) => <option key={role.id} value={role.key}>{role.name}</option>)}
              </select>
            ) : (
              <input
                {...register("role")}
                readOnly
                className="w-full rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Attendance Mode</label>
            <select {...register("attendance_mode")} defaultValue="office" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="office">Office</option>
              <option value="onsite">Onsite</option>
            </select>
          </div>
          {!editingUser && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Temporary Password</label>
              <input
                type="password"
                {...register("password", { required: !editingUser, minLength: 6 })}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
              />
              {errors.password && <p className="mt-1 text-xs text-red-600">Minimum 6 characters</p>}
            </div>
          )}
          {editingUser && session?.role === "superadmin" && (
            <div className="border-t border-ink-100 pt-3">
              <p className="mb-2 text-sm font-medium text-ink-700">Per-user permission overrides</p>
              <div className="max-h-40 space-y-2 overflow-auto">
                {overridePermissions.map((permission) => {
                  const override = overrides.find((item) => item.permission_id === permission.id);
                  return <div key={permission.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>{permission.name}</span>
                    <select value={override?.effect || "inherit"} onChange={(event) => void setOverride(permission.id, event.target.value)} className="rounded border border-ink-200 px-2 py-1">
                      <option value="inherit">Inherit</option><option value="allow">Allow</option><option value="deny">Deny</option>
                    </select>
                  </div>;
                })}
              </div>
            </div>
          )}
        </form>
      </Modal>
    </AppShell>
  );
}
