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
      <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
        <p className="text-sm text-ink-500">No users found.</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-ink-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-720px text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500 sm:text-xs">
              <th className="px-3 py-3 font-medium sm:px-4">Name</th>
              <th className="px-3 py-3 font-medium sm:px-4">Mobile</th>
              <th className="px-3 py-3 font-medium sm:px-4">Department</th>
              <th className="px-3 py-3 font-medium sm:px-4">Role</th>
              <th className="px-3 py-3 font-medium sm:px-4">Status</th>
              <th className="min-w-130px px-3 py-3 text-right font-medium whitespace-nowrap sm:px-3">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-ink-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-ink-50/60">
                <td className="px-3 py-3 sm:px-4">
                  <p className="font-medium text-ink-900">{u.name}</p>
                  <p className="text-[11px] text-ink-500 sm:text-xs">{u.designation}</p>
                </td>

                <td className="px-3 py-3 text-ink-700 sm:px-4">{u.mobile}</td>

                <td className="max-w-40 truncate px-3 py-3 text-ink-700 sm:px-4" title={u.department}>{u.department}</td>

                <td className="px-3 py-3 capitalize text-ink-700 sm:px-4">
                  {u.role}
                </td>

                <td className="px-3 py-3 sm:px-4">
                  <button
                    onClick={() => onToggleStatus(u)}
                    className="cursor-pointer rounded-full transition-opacity hover:opacity-70"
                    title={
                      u.status === "active"
                        ? "Click to deactivate"
                        : "Click to activate"
                    }
                  >
                    <Badge status={u.status} />
                  </button>
                </td>

                <td className="px-3 py-3 whitespace-nowrap sm:px-3">
                  <div className="flex min-w-130px items-center justify-end gap-1">
                    <Link
                      href={`/users/${u.id}`}
                      className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="View user"
                      title="View"
                    >
                      <Eye size={15} />
                    </Link>

                    <button
                      onClick={() => onEdit(u)}
                      className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Edit user"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>

                    <button
                      onClick={() => onResetDevice(u)}
                      className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                      aria-label="Reset device"
                      title="Reset Device"
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
    </div>
  );
}
