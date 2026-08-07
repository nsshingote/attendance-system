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
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-680px text-left text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Mobile</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium text-right whitespace-nowrap min-w-130px">
                Actions
              </th>
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

                <td className="max-w-40 truncate px-3 py-3 text-ink-700" title={u.department}>{u.department}</td>

                <td className="px-4 py-3 capitalize text-ink-700">
                  {u.role}
                </td>

                <td className="px-4 py-3">
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

                <td className="px-3 py-3 whitespace-nowrap">
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

      <div className="space-y-2 p-2 md:hidden">
        {users.map((u) => (
          <div key={u.id} className="rounded-lg border border-ink-200 bg-white p-2.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink-900">{u.name}</p>
                <p className="text-xs text-ink-500">{u.designation}</p>
              </div>
              <Badge status={u.status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-700">
              <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Mobile</p><p className="mt-1">{u.mobile}</p></div>
              <div className="rounded-md bg-ink-50 px-2 py-2"><p className="text-[10px] uppercase tracking-wide text-ink-500">Role</p><p className="mt-1 capitalize">{u.role}</p></div>
            </div>
            <div className="mt-2 rounded-md bg-ink-50 px-2 py-2 text-[11px] text-ink-600">{u.department}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/users/${u.id}`} className="flex-1 rounded-md bg-brand-50 px-2.5 py-2 text-center text-xs font-semibold text-brand-700">View</Link>
              <button onClick={() => onEdit(u)} className="flex-1 rounded-md bg-ink-100 px-2.5 py-2 text-center text-xs font-semibold text-ink-700">Edit</button>
              <button onClick={() => onResetDevice(u)} className="flex-1 rounded-md bg-ink-100 px-2.5 py-2 text-center text-xs font-semibold text-ink-700">Reset</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
