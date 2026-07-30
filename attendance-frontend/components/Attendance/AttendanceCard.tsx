"use client";

/**
 * components/Attendance/AttendanceCard.tsx
 * Single-day attendance summary card (mobile-friendly alternative to a table row).
 */

import Badge from "@/components/Common/Badge";
import { parseISTDateTime } from "@/lib/date";

interface AttendanceCardProps {
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status: string;
}

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "--:--";
  const date = parseISTDateTime(isoString);
  if (!date) return "--:--";
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

export default function AttendanceCard({ date, checkIn, checkOut, status }: AttendanceCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-ink-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-ink-900">{formatDate(date)}</p>
        <p className="mt-1 text-xs text-ink-500">
          {formatTime(checkIn)} – {formatTime(checkOut)}
        </p>
      </div>
      <Badge status={status} />
    </div>
  );
}