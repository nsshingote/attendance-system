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
}

interface UserCalendarProps {
  userId: number;
  year: number;
  month: number;
  selectedDate?: string;
}

const STATUS_COLORS: Record<string, string> = {
  Present: "bg-green-500 text-white",
  Late: "bg-lime-400 text-white",
  "Half Day": "bg-purple-500 text-white",
  Absent: "bg-red-400 text-white",
  Holiday: "bg-blue-400 text-white",
  "On Leave": "bg-amber-400 text-white",
  WFH: "bg-cyan-500 text-white",
  "Weekly Off": "bg-gray-300 text-ink-500",
};

export default function UserCalendar({ userId, year, month, selectedDate }: UserCalendarProps) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const { data } = await api.get<CalendarDay[]>("/attendance/calendar", {
          params: { year, month, user_id: userId },
        });
        setDays(data);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    fetchCalendar();
  }, [userId, year, month]);

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
    
    // Holiday (from holiday table)
    if (day.day_type === "holiday") {
      return "bg-blue-400 text-white";
    }
    // Weekly Off (from company settings)
    if (day.day_type === "weekly_off") {
      return "bg-gray-300 text-ink-500";
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
    <div className="space-y-4">
      <div className="text-sm font-medium text-ink-700 text-center">
        {format(new Date(year, month - 1, 1), "MMMM yyyy")}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center text-xs font-medium text-ink-500 py-1">
            {day}
          </div>
        ))}

        {weeks.map((week, weekIndex) =>
          week.map((day, dayIndex) => {
            const dayNum = getDayText(day);
            const className = getDayClassName(day);
            const isSelected = selectedDate === day.date;

            return (
              <div
                key={`${weekIndex}-${dayIndex}`}
                className={`aspect-square flex items-center justify-center text-sm rounded-lg ${className} ${isSelected ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
              >
                {dayNum || ""}
              </div>
            );
          })
        )}
      </div>

      <CalendarLegend />
    </div>
  );
}