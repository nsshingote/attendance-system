"use client";

/**
 * components/Attendance/WFHForm.tsx
 * Request Work From Home for one or more dates.
 *
 * Used two ways:
 * - Employee requesting their own WFH -> POST /attendance/wfh
 *   (creates a PENDING request — does not bypass the office-IP check
 *   until an Admin/SuperAdmin approves it)
 * - Admin/SuperAdmin filling one in on behalf of an employee
 *   -> POST /attendance/wfh/{user_id} (pass `targetUserId` prop —
 *   applied immediately/auto-approved, no separate approval needed
 *   since an admin is doing it)
 */

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin } from "@/lib/auth";

interface WFHFormProps {
  targetUserId?: number; // if provided, this is an admin filling it in for someone else
  onSuccess: () => void;
  onCancel: () => void;
}

interface UserOption {
  id: number;
  name: string;
}

export default function WFHForm({ targetUserId: propTargetUserId, onSuccess, onCancel }: WFHFormProps) {
  const session = getSession();
  const isAdminUser = isAdmin(session?.role);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(propTargetUserId || session?.userId);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isPastDate = (dateValue: string) => {
    return new Date(`${dateValue}T00:00:00`) < new Date(`${todayIso}T00:00:00`);
  };

  const getRequestedDates = () => {
    const dates: string[] = [];
    const current = new Date(`${fromDate}T00:00:00`);
    const end = new Date(`${toDate}T00:00:00`);
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  useEffect(() => {
    if (isAdminUser) {
      api
        .get<UserOption[]>("/users/")
        .then(({ data }) => {
          setUsers(data);
          if (!propTargetUserId && data.length > 0) {
            setSelectedUserId(data[0].id);
          }
        })
        .catch(() => toast.error("Failed to load users"));
    }
  }, [isAdminUser, propTargetUserId]);

  const handleSubmit = async () => {
    if (!fromDate || !toDate) {
      toast.error("Please select a From Date and To Date");
      return;
    }

    if (fromDate > toDate) {
      toast.error("From Date cannot be after To Date");
      return;
    }

    if (isPastDate(fromDate)) {
      toast.error("Please select today or a future date for WFH.");
      return;
    }

    if (isAdminUser && !selectedUserId) {
      toast.error("Please select an employee");
      return;
    }

    setSubmitting(true);
    try {
      const targetId = isAdminUser ? selectedUserId : session?.userId;
      const url = isAdminUser ? `/attendance/wfh/${targetId}` : "/attendance/wfh";
      const payload = {
        reason: reason || undefined,
      };

      await Promise.all(getRequestedDates().map((attendanceDate) => api.post(url, { ...payload, attendance_date: attendanceDate })));

      toast.success(
        isAdminUser
          ? `WFH marked for ${users.find(u => u.id === targetId)?.name || "employee"}`
          : "WFH requests submitted — awaiting admin approval"
      );
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {isAdminUser && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Apply For</label>
          <select
            value={selectedUserId || ""}
            onChange={(e) => setSelectedUserId(Number(e.target.value))}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">Select an employee...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink-700">
            From Date
            <input
              type="date"
              min={todayIso}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            To Date
            <input
              type="date"
              min={fromDate || todayIso}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          placeholder="Optional reason for working from home"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || (isAdminUser && !selectedUserId)}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting
            ? "Saving..."
            : isAdminUser
              ? "Mark WFH"
              : "Submit Request"
          }
        </button>
      </div>
    </div>
  );
}