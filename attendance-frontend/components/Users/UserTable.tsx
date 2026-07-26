"use client";

/**
 * components/Users/UserTable.tsx
 * Admin/SuperAdmin user list table with search + status/role badges.
 * Status badge is clickable — toggles Active/Inactive directly.
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

export default function UserTable({ users, onEdit, onResetDevice, onToggleStatus }: UserTableProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No users found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Mobile</th>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-ink-50/60">
              <td className="px-4 py-3">
                <p className="font-medium text-ink-900">{u.name}</p>
                <p className="text-xs text-ink-500">{u.designation}</p>
              </td>
              <td className="px-4 py-3 text-ink-700">{u.mobile}</td>
              <td className="px-4 py-3 text-ink-700">{u.department}</td>
              <td className="px-4 py-3 capitalize text-ink-700">{u.role}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onToggleStatus(u)}
                  className="cursor-pointer rounded-full transition-opacity hover:opacity-70"
                  title={u.status === "active" ? "Click to deactivate" : "Click to activate"}
                >
                  <Badge status={u.status} />
                </button>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/users/${u.id}`}
                    className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                    aria-label="View user"
                  >
                    <Eye size={15} />
                  </Link>
                  <button
                    onClick={() => onEdit(u)}
                    className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                    aria-label="Edit user"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => onResetDevice(u)}
                    className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                    aria-label="Reset device"
                    title="Reset registered device"
                  >
                    <SmartphoneNfc size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}