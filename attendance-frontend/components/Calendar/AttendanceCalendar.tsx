"use client";

/**
 * components/Calendar/AttendanceCalendar.tsx
 * Monthly calendar view of a user's attendance, backed by react-calendar.
 * Expects data already merged from GET /attendance/calendar (day_type +
 * status per date — see utils/calendar.py on the backend).
 */

import ReactCalendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { format } from "date-fns";
import clsx from "clsx";

export interface CalendarDay {
  date: string; // ISO yyyy-MM-dd
  day_type: "holiday" | "weekly_off" | "working_day";
  status: string;
  label?: string | null;
}

interface AttendanceCalendarProps {
  year: number;
  month: number; // 1-12
  days: CalendarDay[];
}

const STATUS_DOT: Record<string, string> = {
  Present: "bg-status-present",
  Late: "bg-status-late",
  "Half Day": "bg-status-half-day",
  Absent: "bg-status-absent",
  Holiday: "bg-status-holiday",
  "On Leave": "bg-status-on-leave",
  WFH: "bg-status-wfh",
  "Extra Working Day": "bg-status-extra-working-day",
  weekly_off: "bg-status-weekly-off",
};

export default function AttendanceCalendar({ year, month, days }: AttendanceCalendarProps) {
  const dayMap = new Map(days.map((d) => [d.date, d]));

  return (
    <div className="attendance-calendar rounded-xl border border-ink-200 bg-white p-4 shadow-card">
      <ReactCalendar
        activeStartDate={new Date(year, month - 1, 1)}
        view="month"
        showNavigation={false}
        tileClassName={() => "!bg-transparent !border-0"}
        tileContent={({ date, view }) => {
          if (view !== "month") return null;
          const iso = format(date, "yyyy-MM-dd");
          const day = dayMap.get(iso);
          if (!day) return null;

          const dotClass = day.day_type === "weekly_off" ? STATUS_DOT.weekly_off : STATUS_DOT[day.status];

          return (
            <div className="mt-1 flex justify-center">
              <span
                title={day.label ?? day.status}
                className={clsx("h-1.5 w-1.5 rounded-full", dotClass || "bg-transparent")}
              />
            </div>
          );
        }}
      />
    </div>
  );
}