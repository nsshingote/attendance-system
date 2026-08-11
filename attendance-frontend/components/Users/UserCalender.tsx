

"use client";

/**
 * components/Users/UserCalendar.tsx
 * Monthly attendance calendar for a specific user.
 * Shows colored tiles for each day based on attendance status.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";
import CalendarLegend from "@/components/Calendar/Calendarlegend";

interface CalendarDay {
  date: string;
  day_type: string;
  status?: string;
  label?: string;
  check_in?: string;
  check_out?: string;
  leave_category?: string | null;
  is_manual_override?: boolean;
  working_day_label?: "Working Day" | "Extra Working Day" | null;
}

interface UserCalendarProps {
  userId: number;
  employeeIds?: number[];
  departmentId?: number;
  year: number;
  month: number;
  selectedDate?: string;
  canOverride?: boolean;
  onOverrideDate?: (day: CalendarDay) => void;
  onSelectDay?: (day: CalendarDay) => void;
  refreshKey?: number;
}

const STATUS_COLORS: Record<string, string> = {
  Present: "bg-emerald-700 text-white",
  Late: "bg-lime-400 text-ink-900",
  "Half Day": "bg-yellow-400 text-ink-900",
  Absent: "bg-red-500 text-white",
  Holiday: "bg-pink-400 text-white",
  "On Leave": "bg-red-500 text-white",
  WFH: "bg-violet-500 text-white",
  "Weekly Off": "bg-slate-400 text-ink-900",
  "Working Day": "bg-orange-500 text-white",
  "Extra Working Day": "bg-blue-500 text-white",
};

export default function UserCalendar({ userId, employeeIds, departmentId, year, month, selectedDate, canOverride = false, onOverrideDate, onSelectDay, refreshKey = 0 }: UserCalendarProps) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const { data } = await api.get<CalendarDay[]>("/attendance/calendar", {
          params: {
            year,
            month,
            user_id: userId,
            employee_ids: employeeIds?.length ? employeeIds : undefined,
            department_id: departmentId,
          },
          paramsSerializer: { indexes: null },
        });
        setDays(data);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    fetchCalendar();
  }, [userId, employeeIds, departmentId, year, month, refreshKey]);

  useEffect(() => {
    if (!selectedDate || days.length === 0) return;
    const selected = days.find((day) => day.date === selectedDate);
    if (selected) {
      onSelectDay?.(selected);
    }
  }, [selectedDate, days, onSelectDay]);

  if (loading) {
    return <Loading />;
  }

  // Group days by week
  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];

  // Get first day of month
  const firstDay = new Date(year, month - 1, 1).getDay();

  // Create a map of date -> day data
  const dayMap: Record<string, CalendarDay> = {};
  days.forEach((day) => {
    dayMap[day.date] = day;
  });

  // Build calendar grid
  for (let i = 0; i < firstDay; i++) {
    week.push({ date: "", day_type: "empty" } as CalendarDay);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayData = dayMap[dateStr] || {
      date: dateStr,
      day_type: "working_day",
      status: "Absent"
    };
    week.push(dayData);

    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  // Fill remaining days in last week
  while (week.length < 7 && week.length > 0) {
    week.push({ date: "", day_type: "empty" } as CalendarDay);
  }
  if (week.length > 0) {
    weeks.push(week);
  }

  const getDayClassName = (day: CalendarDay) => {
    if (!day.date) return "bg-transparent";

    if (day.is_manual_override && day.status) {
      return STATUS_COLORS[day.status] || "bg-ink-200 text-ink-500";
    }
    if (day.status === "WFH") {
      return STATUS_COLORS.WFH;
    }
    if (day.working_day_label) {
      return STATUS_COLORS[day.working_day_label];
    }
    // Holiday (from holiday table)
    if (day.day_type === "holiday") {
      return "bg-pink-400 text-white";
    }
    // Weekly Off (from company settings)
    if (day.day_type === "weekly_off") {
      return "bg-slate-400 text-ink-900";
    }
    // Check status (from attendance)
    if (day.status) {
      const color = STATUS_COLORS[day.status];
      if (color) {
        return color;
      }
      // Unknown status - default
      return "bg-ink-200 text-ink-500";
    }
    // No attendance = Absent (red)
    return "bg-red-400 text-white";
  };

  const getDayText = (day: CalendarDay) => {
    if (!day.date) return "";
    return parseInt(day.date.split("-")[2]);
  };

  return (
    <div className="space-y-2 max-w-28rem mx-auto">
      <div className="text-sm font-medium text-ink-700 text-center">
        {format(new Date(year, month - 1, 1), "MMMM yyyy")}
      </div>

      <div className="grid grid-cols-7 gap-1 justify-items-center">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center text-[11px] font-medium text-ink-500 py-0.5">
            {day}
          </div>
        ))}

        {weeks.map((week, weekIndex) =>
          week.map((day, dayIndex) => {
            const dayNum = getDayText(day);
            const className = getDayClassName(day);
            const isSelected = selectedDate === day.date;

            return (
              <button
                type="button"
                key={`${weekIndex}-${dayIndex}`}
                disabled={!day.date || !canOverride}
                onClick={() => {
                  if (!day.date || !canOverride) return;
                  onSelectDay?.(day);
                  onOverrideDate?.(day);
                }}
                className={`flex h-9 w-9 items-center justify-center text-xs rounded-md ${className} ${isSelected ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
                aria-label={day.working_day_label ?? day.status ?? day.date}
                title={day.leave_category ? `${day.status} — ${day.leave_category}` : day.status}
              >
                {dayNum || ""}
              </button>
            );
          })
        )}
      </div>

      <CalendarLegend />
    </div>
  );
}
