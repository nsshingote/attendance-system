"use client";

/**
 * components/Users/UserTable.tsx
 * Admin/SuperAdmin user list table with search + status/role badges.
 */

import Link from "next/link";
import { Eye, Pencil, SmartphoneNfc } from "lucide-react";
import Badge from "@/components/Common/Badge";

export interface UserRow {
  id: number;
  name: string;
  mobile: string;
  email: string | null;
  role: string;
  department: string;
  designation: string;
  status: string;
}

interface UserTableProps {
  users: UserRow[];
  onEdit: (user: UserRow) => void;
  onResetDevice: (user: UserRow) => void;
  onToggleStatus: (user: UserRow) => void;
}

export default function UserTable({
  users,
  onEdit,
  onResetDevice,
  onToggleStatus,
}: UserTableProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No users found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {users.map((u) => (
          <div key={u.id} className="rounded-2xl border border-ink-200 bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">{u.name}</p>
                <p className="mt-1 text-sm text-ink-500">{u.designation}</p>
                <p className="mt-2 text-sm text-ink-600">{u.department}</p>
              </div>
              <button
                onClick={() => onToggleStatus(u)}
                className="rounded-full bg-ink-50 px-3 py-1 text-sm font-semibold text-ink-700"
                title={u.status === "active" ? "Click to deactivate" : "Click to activate"}
              >
                {u.status}
              </button>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-ink-600">
              <div className="flex items-center justify-between">
                <span>Email</span>
                <span>{u.email || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Mobile</span>
                <span>{u.mobile}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Role</span>
                <span className="capitalize">{u.role}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => onEdit(u)}
                className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
              >
                Edit
              </button>
              <button
                onClick={() => onResetDevice(u)}
                className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
              >
                Reset
              </button>
              <button
                onClick={() => onToggleStatus(u)}
                className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
              >
                {u.status === "active" ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block w-full overflow-x-auto rounded-2xl border border-ink-200 bg-white shadow-card">
        <table className="w-full min-w-180 text-left text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Mobile</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium text-right min-w-130px">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-ink-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-ink-50/60">
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <p className="font-medium text-ink-900">{u.name}</p>
                    <p className="text-xs text-ink-500">{u.designation}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-700">{u.mobile}</td>
                <td className="px-4 py-3 text-ink-700 table-cell-clamp max-w-180px wrap-break" title={u.department}>{u.department}</td>
                <td className="px-4 py-3 capitalize text-ink-700">{u.role}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onToggleStatus(u)}
                    className="rounded-full bg-ink-50 px-3 py-1 text-sm font-semibold text-ink-700 hover:bg-ink-100"
                    title={u.status === "active" ? "Click to deactivate" : "Click to activate"}
                  >
                    {u.status}
                  </button>
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="inline-flex items-center justify-end gap-1">
                    <button
                      onClick={() => onEdit(u)}
                      className="rounded-md p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Edit user"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => onResetDevice(u)}
                      className="rounded-md p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Reset device"
                      title="Reset Device"
                    >
                      <SmartphoneNfc size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
