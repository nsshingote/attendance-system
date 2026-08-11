"use client";

/**
 * components/Corrections/CorrectionForm.tsx
 * Correction-request form — employee picks one of their own attendance
 * records, chooses whether to correct Check-In, Check-Out, or both, and
 * gives a separate remark for whichever field(s) they're correcting.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";

interface AttendanceOption {
  id: number;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
}

interface CorrectionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  attendanceId?: number;
  attendanceDate?: string;
}

type CorrectionType = "checkin" | "checkout" | "both";
type Meridiem = "AM" | "PM";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0-59

function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Converts 12-hour hour/minute/AM-PM into a "HH:mm" 24-hour string. */
function to24Hour(hour12: number, minute: number, meridiem: Meridiem): string {
  let hour24 = hour12 % 12;
  if (meridiem === "PM") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

interface TimePickerProps {
  hour: number;
  minute: number;
  meridiem: Meridiem;
  onChange: (hour: number, minute: number, meridiem: Meridiem) => void;
}

function TimePicker({ hour, minute, meridiem, onChange }: TimePickerProps) {
  return (
    <div className="flex gap-2">
      <select
        value={hour}
        onChange={(e) => onChange(Number(e.target.value), minute, meridiem)}
        className="rounded-lg border border-ink-200 px-2 py-2 text-sm"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => onChange(hour, Number(e.target.value), meridiem)}
        className="rounded-lg border border-ink-200 px-2 py-2 text-sm"
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <div className="flex overflow-hidden rounded-lg border border-ink-200">
        {(["AM", "PM"] as Meridiem[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(hour, minute, m)}
            className={`px-3 py-2 text-sm font-medium ${
              meridiem === m ? "bg-brand-500 text-white" : "bg-white text-ink-600 hover:bg-ink-50"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CorrectionForm({ 
  onSuccess, 
  onCancel,
  attendanceId: fixedAttendanceId,
  attendanceDate: fixedAttendanceDate,
}: CorrectionFormProps) {
  const [options, setOptions] = useState<AttendanceOption[]>([]);
  const [attendanceId, setAttendanceId] = useState<number | "">(fixedAttendanceId ?? "");
  const [correctionType, setCorrectionType] = useState<CorrectionType>("checkout");

  const [checkInHour, setCheckInHour] = useState(9);
  const [checkInMinute, setCheckInMinute] = useState(0);
  const [checkInMeridiem, setCheckInMeridiem] = useState<Meridiem>("AM");
  const [checkinReason, setCheckinReason] = useState("");

  const [checkOutHour, setCheckOutHour] = useState(6);
  const [checkOutMinute, setCheckOutMinute] = useState(30);
  const [checkOutMeridiem, setCheckOutMeridiem] = useState<Meridiem>("PM");
  const [checkoutReason, setCheckoutReason] = useState("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (fixedAttendanceId && fixedAttendanceDate) {
      setOptions([
        {
          id: fixedAttendanceId,
          attendance_date: fixedAttendanceDate,
          check_in: null,
          check_out: null,
        },
      ]);
      return;
    }

    const now = new Date();

    api
      .get<AttendanceOption[]>("/attendance/me", {
        params: {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      })
      .then(({ data }) => setOptions(data.filter((r) => r.check_in)))
      .catch(() => {});
  }, [fixedAttendanceId, fixedAttendanceDate]);

  const selectedOption = options.find((o) => o.id === attendanceId);
  const wantsCheckIn = correctionType === "checkin" || correctionType === "both";
  const wantsCheckOut = correctionType === "checkout" || correctionType === "both";

  const handleSubmit = async () => {
    if (!attendanceId || !selectedOption) {
      toast.error("Please select a date");
      return;
    }
    
    // Validate based on correction type
    if (wantsCheckIn && !checkinReason.trim()) {
      toast.error("Please provide a reason for the check-in correction");
      return;
    }
    if (wantsCheckOut && !checkoutReason.trim()) {
      toast.error("Please provide a reason for the check-out correction");
      return;
    }

    setSubmitting(true);
    try {
      // Build payload
      const payload: any = {
        attendance_id: attendanceId,
        reason: "",
        new_check_out: null,
      };

      // Build the reason string
      const reasonParts: string[] = [];
      
      if (wantsCheckIn) {
        const timeStr = to24Hour(checkInHour, checkInMinute, checkInMeridiem);
        // Send only the time string (HH:mm) - backend will combine with date
        payload.new_check_in = timeStr;
        reasonParts.push(`Check-in correction to ${timeStr}: ${checkinReason.trim()}`);
      }

      if (wantsCheckOut) {
        const timeStr = to24Hour(checkOutHour, checkOutMinute, checkOutMeridiem);
        // Send only the time string (HH:mm) - backend will combine with date
        payload.new_check_out = timeStr;
        reasonParts.push(`Check-out correction to ${timeStr}: ${checkoutReason.trim()}`);
      }

      payload.reason = reasonParts.join("; ");

      console.log("📤 Sending correction payload:", payload);

      await api.post("/corrections/", payload);
      toast.success("Correction request submitted");
      onSuccess();
    } catch (error) {
      console.error("❌ Correction error:", error);
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!fixedAttendanceId && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            Attendance Record
          </label>
          <select
            value={attendanceId}
            onChange={(e) => setAttendanceId(Number(e.target.value))}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">Select a date</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {formatDateLabel(o.attendance_date)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">What do you want to correct?</label>
        <div className="flex gap-2">
          {(
            [
              { value: "checkin", label: "Check-In" },
              { value: "checkout", label: "Check-Out" },
              { value: "both", label: "Both" },
            ] as { value: CorrectionType; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCorrectionType(opt.value)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                correctionType === opt.value
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-ink-200 text-ink-600 hover:bg-ink-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {wantsCheckIn && (
        <div className="space-y-3 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Check-In Correction</p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">New Check-In Time</label>
            <TimePicker
              hour={checkInHour}
              minute={checkInMinute}
              meridiem={checkInMeridiem}
              onChange={(h, m, mer) => {
                setCheckInHour(h);
                setCheckInMinute(m);
                setCheckInMeridiem(mer);
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Reason for Correction</label>
            <textarea
              value={checkinReason}
              onChange={(e) => setCheckinReason(e.target.value)}
              rows={2}
              placeholder="E.g. Traffic delay, forgot to check in on arrival"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {wantsCheckOut && (
        <div className="space-y-3 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Check-Out Correction</p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">New Check-Out Time</label>
            <TimePicker
              hour={checkOutHour}
              minute={checkOutMinute}
              meridiem={checkOutMeridiem}
              onChange={(h, m, mer) => {
                setCheckOutHour(h);
                setCheckOutMinute(m);
                setCheckOutMeridiem(mer);
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Reason for Correction</label>
            <textarea
              value={checkoutReason}
              onChange={(e) => setCheckoutReason(e.target.value)}
              rows={2}
              placeholder="E.g. Forgot to check out, left early for an appointment"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button 
          onClick={onCancel} 
          className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit Request"}
        </button>
      </div>
    </div>
  );
}