"use client";

/**
 * components/Attendance/HalfDayForm.tsx
 * Mark a half day — two fixed slots:
 *   Morning:   10:00 AM - 2:30 PM
 *   Afternoon: 2:30 PM - 6:30 PM
 *
 * Used two ways:
 * - Employee requesting their own half day -> POST /attendance/half-day
 *   (creates a PENDING request — does not mark attendance until an
 *   Admin/SuperAdmin approves it)
 * - Admin/SuperAdmin filling one in on behalf of an employee who forgot
 *   -> POST /attendance/half-day/{user_id} (pass `targetUserId` prop —
 *   applied immediately, no approval needed since an admin is doing it)
 */

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";

interface HalfDayFormProps {
  isAdmin: boolean;
  targetUserId?: number; // if provided, this is an admin filling it in for someone else
  onSuccess: () => void;
  onCancel: () => void;
}

interface UserOption {
  id: number;
  name: string;
}

const SLOTS = [
  { value: "morning", label: "Morning — 10:00 AM to 2:30 PM" },
  { value: "afternoon", label: "Afternoon — 2:30 PM to 6:30 PM" },
];

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function HalfDayForm({ isAdmin, targetUserId: propTargetUserId, onSuccess, onCancel }: HalfDayFormProps) {
  const session = getSession();
  const isAdminUser = isAdmin;
  
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(propTargetUserId || session?.userId);
  const [attendanceDate, setAttendanceDate] = useState(formatLocalDate(new Date()));
  const [slot, setSlot] = useState("morning");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Fetch users for admin dropdown
  useEffect(() => {
    if (isAdminUser) {
      api
        .get<UserOption[]>("/users/")
        .then(({ data }) => {
          setUsers(data);
          // If no targetUserId provided, default to first user
          if (!propTargetUserId && data.length > 0) {
            setSelectedUserId(data[0].id);
          }
        })
        .catch(() => toast.error("Failed to load users"));
    }
  }, [isAdminUser, propTargetUserId]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    if (!attendanceDate) {
      toast.error("Please select a date");
      return;
    }
    
    // If admin, make sure a user is selected
    if (isAdminUser && !selectedUserId) {
      toast.error("Please select an employee");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Determine the target user ID
      const targetId = isAdminUser ? selectedUserId : session?.userId;
      
      // If admin, use the admin endpoint with user_id in URL
      // If employee, use the regular endpoint
      const url = isAdminUser ? `/attendance/half-day/${targetId}` : "/attendance/half-day";
      const payload = {
        attendance_date: attendanceDate,
        slot,
        reason: reason || undefined,
      };
      
      await api.post(url, payload);
      
      toast.success(
        isAdminUser 
          ? `Half day marked for ${users.find(u => u.id === targetId)?.name || 'employee'}` 
          : "Half day request submitted — awaiting admin approval"
      );
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* User dropdown - only shown for admin/superadmin */}
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
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
        <input
          type="date"
          value={attendanceDate}
          onChange={(e) => setAttendanceDate(e.target.value)}
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Slot</label>
        <div className="space-y-2">
          {SLOTS.map((s) => (
            <label
              key={s.value}
              className="flex items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 text-sm has-:checked:border-brand-400 has-:checked:bg-brand-50"
            >
              <input
                type="radio"
                name="half-day-slot"
                value={s.value}
                checked={slot === s.value}
                onChange={() => setSlot(s.value)}
                className="text-brand-500 focus:ring-brand-400"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          placeholder="Optional reason for half day"
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
              ? "Mark Half Day" 
              : "Submit Request"
          }
        </button>
      </div>
    </div>
  );
}
