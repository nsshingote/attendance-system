// "use client";

// /**
//  * components/Users/UserCalendar.tsx
//  * Monthly attendance calendar for a specific user.
//  * Shows colored tiles for each day based on attendance status.
//  */

// import { useEffect, useState } from "react";
// import { format } from "date-fns";
// import toast from "react-hot-toast";
// import api, { getErrorMessage } from "@/lib/api";
// import Loading from "@/components/Common/Loading";
// import CalendarLegend from "@/components/Calendar/Calendarlegend";

// interface CalendarDay {
//   date: string;
//   day_type: string;
//   status?: string;
//   label?: string;
//   check_in?: string;
//   check_out?: string;
// }

// interface UserCalendarProps {
//   userId: number;
//   employeeIds?: number[];
//   year: number;
//   month: number;
//   selectedDate?: string;
// }

// const STATUS_COLORS: Record<string, string> = {
//   Present: "bg-green-500 text-white",
//   Late: "bg-lime-400 text-white",
//   "Half Day": "bg-purple-500 text-white",
//   Absent: "bg-red-400 text-white",
//   Holiday: "bg-blue-400 text-white",
//   "On Leave": "bg-amber-400 text-white",
//   WFH: "bg-cyan-500 text-white",
//   "Weekly Off": "bg-gray-300 text-ink-500",
// };

// export default function UserCalendar({ userId, employeeIds, year, month, selectedDate }: UserCalendarProps) {
//   const [days, setDays] = useState<CalendarDay[]>([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const fetchCalendar = async () => {
//       try {
//         const { data } = await api.get<CalendarDay[]>("/attendance/calendar", {
//           params: { year, month, user_id: userId, employee_ids: employeeIds?.length ? employeeIds : undefined },
//           paramsSerializer: { indexes: null },
//         });
//         setDays(data);
//       } catch (error) {
//         toast.error(getErrorMessage(error));
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchCalendar();
//   }, [userId, employeeIds, year, month]);

//   if (loading) {
//     return <Loading />;
//   }

//   // Group days by week
//   const weeks: CalendarDay[][] = [];
//   let week: CalendarDay[] = [];

//   // Get first day of month
//   const firstDay = new Date(year, month - 1, 1).getDay();

//   // Create a map of date -> day data
//   const dayMap: Record<string, CalendarDay> = {};
//   days.forEach((day) => {
//     dayMap[day.date] = day;
//   });

//   // Build calendar grid
//   for (let i = 0; i < firstDay; i++) {
//     week.push({ date: "", day_type: "empty" } as CalendarDay);
//   }

//   const daysInMonth = new Date(year, month, 0).getDate();
//   for (let day = 1; day <= daysInMonth; day++) {
//     const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
//     const dayData = dayMap[dateStr] || {
//       date: dateStr,
//       day_type: "working_day",
//       status: "Absent"
//     };
//     week.push(dayData);
    
//     if (week.length === 7) {
//       weeks.push(week);
//       week = [];
//     }
//   }

//   // Fill remaining days in last week
//   while (week.length < 7 && week.length > 0) {
//     week.push({ date: "", day_type: "empty" } as CalendarDay);
//   }
//   if (week.length > 0) {
//     weeks.push(week);
//   }

//   const getDayClassName = (day: CalendarDay) => {
//     if (!day.date) return "bg-transparent";
    
//     // Holiday (from holiday table)
//     if (day.day_type === "holiday") {
//       return "bg-blue-400 text-white";
//     }
//     // Weekly Off (from company settings)
//     if (day.day_type === "weekly_off") {
//       return "bg-gray-300 text-ink-500";
//     }
//     // Check status (from attendance)
//     if (day.status) {
//       const color = STATUS_COLORS[day.status];
//       if (color) {
//         return color;
//       }
//       // Unknown status - default
//       return "bg-ink-200 text-ink-500";
//     }
//     // No attendance = Absent (red)
//     return "bg-red-400 text-white";
//   };

//   const getDayText = (day: CalendarDay) => {
//     if (!day.date) return "";
//     return parseInt(day.date.split("-")[2]);
//   };

//   return (
//     <div className="space-y-4">
//       <div className="text-sm font-medium text-ink-700 text-center">
//         {format(new Date(year, month - 1, 1), "MMMM yyyy")}
//       </div>

//       <div className="grid grid-cols-7 gap-1">
//         {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
//           <div key={day} className="text-center text-xs font-medium text-ink-500 py-1">
//             {day}
//           </div>
//         ))}

//         {weeks.map((week, weekIndex) =>
//           week.map((day, dayIndex) => {
//             const dayNum = getDayText(day);
//             const className = getDayClassName(day);
//             const isSelected = selectedDate === day.date;

//             return (
//               <div
//                 key={`${weekIndex}-${dayIndex}`}
//                 className={`aspect-square flex items-center justify-center text-sm rounded-lg ${className} ${isSelected ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
//               >
//                 {dayNum || ""}
//               </div>
//             );
//           })
//         )}
//       </div>

//       <CalendarLegend />
//     </div>
//   );
// }


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
}

interface UserCalendarProps {
  userId: number;
  employeeIds?: number[];
  year: number;
  month: number;
  selectedDate?: string;
  canOverride?: boolean;
  onOverrideDate?: (day: CalendarDay) => void;
  refreshKey?: number;
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

export default function UserCalendar({ userId, employeeIds, year, month, selectedDate, canOverride = false, onOverrideDate, refreshKey = 0 }: UserCalendarProps) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const { data } = await api.get<CalendarDay[]>("/attendance/calendar", {
          params: { year, month, user_id: userId, employee_ids: employeeIds?.length ? employeeIds : undefined },
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
  }, [userId, employeeIds, year, month, refreshKey]);

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
    <div className="space-y-3 max-w-md mx-auto">
      <div className="text-sm font-medium text-ink-700 text-center">
        {format(new Date(year, month - 1, 1), "MMMM yyyy")}
      </div>

      <div className="grid grid-cols-7 gap-1">
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
                onClick={() => day.date && canOverride && setSelectedDay(day)}
                className={`aspect-square w-full max-w-44px mx-auto flex items-center justify-center text-xs rounded-md ${className} ${isSelected ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
                title={day.leave_category ? `${day.status} — ${day.leave_category}` : day.status}
              >
                {dayNum || ""}
              </button>
            );
          })
        )}
      </div>

      {canOverride && selectedDay && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm">
          <span className="text-ink-600">
            {format(new Date(`${selectedDay.date}T00:00:00`), "d MMM")}: {selectedDay.status}
            {selectedDay.leave_category ? ` (${selectedDay.leave_category})` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelectedDay(null)} className="text-ink-500 hover:text-ink-700">Cancel</button>
            <button
              type="button"
              onClick={() => {
                onOverrideDate?.(selectedDay);
                setSelectedDay(null);
              }}
              className="rounded-md bg-brand-500 px-3 py-1.5 font-medium text-white hover:bg-brand-600"
            >
              Override
            </button>
          </div>
        </div>
      )}

      <CalendarLegend />
    </div>
  );
}
