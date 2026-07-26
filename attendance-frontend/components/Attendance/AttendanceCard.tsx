/**
 * components/Attendance/AttendanceCard.tsx
 * Single-day attendance summary card (mobile-friendly alternative to a table row).
 */

import { format, parseISO } from "date-fns";
import Badge from "@/components/Common/Badge";

interface AttendanceCardProps {
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status: string;
}

export default function AttendanceCard({ date, checkIn, checkOut, status }: AttendanceCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-ink-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-ink-900">{format(parseISO(date), "EEE, dd MMM yyyy")}</p>
        <p className="mt-1 text-xs text-ink-500">
          {checkIn ? format(parseISO(checkIn), "hh:mm a") : "--:--"} –{" "}
          {checkOut ? format(parseISO(checkOut), "hh:mm a") : "--:--"}
        </p>
      </div>
      <Badge status={status} />
    </div>
  );
}