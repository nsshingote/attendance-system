

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
import Pagination from "@/components/Common/Pagination";
import UserTable, { UserRow } from "@/components/Users/UserTable";

interface UserFormValues {
  name: string;
  mobile: string;
  email: string;
  department: string;
  designation: string;
  role: string;
  password: string;
}

const PAGE_SIZE = 10;

export default function UsersPage() {
  const session = getSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

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
    api
      .get<{ id: number; name: string }[]>("/reports/departments")
      .then(({ data }) => setDepartments(data))
      .catch(() => toast.error("Failed to load departments"));
  }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    reset({ name: "", mobile: "", email: "", department: "", designation: "", role: "user", password: "" });
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
      role: user.role,
      password: "",
    });
    setModalOpen(true);
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
          role: values.role,
        });
        toast.success("User updated");
      } else {
        await api.post("/users/", {
          name: values.name,
          mobile: values.mobile,
          email: values.email || undefined,
          department: values.department,
          designation: values.designation,
          role: values.role,
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
  
  const paginatedUsers = users.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.ceil(users.length / PAGE_SIZE);

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Users</h1>
            <p className="text-sm text-ink-500">Manage employees, admins, and their access</p>
          </div>
          <div className="flex items-center gap-2">
            <Search placeholder="Search by name, email, mobile" onSearch={(v) => { setSearch(v); setPage(0); }} />
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
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
              users={paginatedUsers}
              onEdit={openEditModal}
              onResetDevice={handleResetDevice}
              onToggleStatus={handleToggleStatus}
            />
            <div className="flex justify-end">
              <Pagination pageCount={pageCount} currentPage={page} onPageChange={setPage} />
            </div>
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
            <select {...register("role")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="user">Employee</option>
              {session?.role === "superadmin" && <option value="admin">Admin</option>}
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
        </form>
      </Modal>
    </AppShell>
  );
}
