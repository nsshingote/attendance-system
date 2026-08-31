

"use client";

/**
 * components/Users/UserCalendar.tsx
 * Monthly attendance calendar for a specific user.
 * Shows colored tiles for each day based on attendance status.
 */

import { useEffect, useState, useRef } from "react";
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
  showStatus?: boolean;
  onOverrideSaved?: () => void;
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
  "Extra Working Day": "bg-blue-500 text-white",
};

export default function UserCalendar({ userId, employeeIds, departmentId, year, month, selectedDate, canOverride = false, onOverrideDate, onSelectDay, refreshKey = 0, showStatus = false, onOverrideSaved }: UserCalendarProps) {
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  // internalDate holds selection when parent doesn't control `selectedDate`
  const [internalDate, setInternalDate] = useState<string>("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [statusLocal, setStatusLocal] = useState<string>("Present");
  const [enterTimesLocal, setEnterTimesLocal] = useState<boolean>(false);
  const [checkInTimeLocal, setCheckInTimeLocal] = useState<string>("");
  const [checkOutTimeLocal, setCheckOutTimeLocal] = useState<string>("");
  const overrideSelectRef = useRef<HTMLSelectElement | null>(null);
  const leaveCategoryRef = useRef<HTMLSelectElement | null>(null);

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

  // derive selected date locally — parent `selectedDate` takes precedence
  const selectedDateLocal = selectedDate ?? internalDate;

  // derive selected day from days + selectedDateLocal
  const selectedDayLocal: CalendarDay | null = days.find((d) => d.date === selectedDateLocal) || null;

  useEffect(() => {
    const toTimeInput = (isoString?: string | null) => {
      if (!isoString) return "";
      const date = new Date(isoString);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    };

    if (!selectedDayLocal) {
      setStatusLocal("Present");
      setEnterTimesLocal(false);
      setCheckInTimeLocal("");
      setCheckOutTimeLocal("");
      return;
    }

    const normalized = selectedDayLocal.status || "Present";
    setStatusLocal(normalized);
    setEnterTimesLocal(Boolean(selectedDayLocal.check_in || selectedDayLocal.check_out));
    setCheckInTimeLocal(toTimeInput(selectedDayLocal.check_in));
    setCheckOutTimeLocal(toTimeInput(selectedDayLocal.check_out));
  }, [selectedDayLocal]);

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

    const dateValue = new Date(`${day.date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (day.status === "Extra Working Day" || day.working_day_label === "Extra Working Day") {
      return STATUS_COLORS["Extra Working Day"];
    }

    // Future priority: Holiday -> Approved Leave -> Approved WFH -> No color
    if (dateValue > today) {
      if (day.day_type === "holiday") {
        return "bg-pink-400 text-white";
      }
      if (day.status === "On Leave") {
        return STATUS_COLORS["On Leave"];
      }
      if (day.status === "WFH") {
        return STATUS_COLORS.WFH;
      }
      return "bg-transparent text-ink-500";
    }

    if (day.status === "WFH") {
      return STATUS_COLORS.WFH;
    }
    if (day.is_manual_override && day.status) {
      return STATUS_COLORS[day.status] || "bg-ink-200 text-ink-500";
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
            const isSelected = (showStatus ? selectedDateLocal : selectedDate) === day.date;

            return (
              <button
                type="button"
                key={`${weekIndex}-${dayIndex}`}
                disabled={!day.date}
                onClick={() => {
                  if (!day.date) return;
                  onSelectDay?.(day);
                  if (canOverride) onOverrideDate?.(day);
                  // if embedded status is shown, update local selection
                  if (showStatus) {
                    setInternalDate(day.date);
                  }
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

      {showStatus && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4">
            <label className="block text-sm font-medium text-ink-700">
              Select date
              <input
                type="date"
                value={selectedDateLocal}
                onChange={(e) => setInternalDate(e.target.value)}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
              />
            </label>
            <p className="mt-3 text-sm text-ink-500">Selected date</p>
            <p className="mt-2 text-lg font-semibold text-ink-900">
              {selectedDateLocal ? new Date(selectedDateLocal).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No date selected"}
            </p>
          </div>

          {selectedDayLocal ? (
            <div className="rounded-2xl border border-ink-200 bg-white p-4">
              <div className="space-y-3 text-sm text-ink-600">
                <p>
                  <span className="font-medium text-ink-900">Status:</span> {selectedDayLocal.status || "Unknown"}
                </p>
                {selectedDayLocal.leave_category && (
                  <p>
                    <span className="font-medium text-ink-900">Leave category:</span> {selectedDayLocal.leave_category}
                  </p>
                )}
                {selectedDayLocal.working_day_label && (
                  <p>
                    <span className="font-medium text-ink-900">Day type:</span> {selectedDayLocal.working_day_label}
                  </p>
                )}
              </div>
              {canOverride && (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-medium text-ink-700">
                    Final status for selected date
                    <select
                      key={selectedDateLocal}
                      value={statusLocal}
                      onChange={(e) => {
                        setStatusLocal(e.target.value);
                        if (e.target.value === "On Leave") {
                          setEnterTimesLocal(false);
                          setCheckInTimeLocal("");
                          setCheckOutTimeLocal("");
                        }
                      }}
                      className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                    >
                      {["Present", "Late", "Absent", "WFH", "Half Day", "On Leave", "Extra Working Day"].map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>

                  {statusLocal === "On Leave" ? (
                    <label className="block text-sm font-medium text-ink-700">
                      Leave category
                      <select
                        key={`leave-${selectedDateLocal}`}
                        defaultValue={selectedDayLocal?.leave_category || "Paid"}
                        ref={leaveCategoryRef}
                        className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="Paid">Paid</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Carried">Carried</option>
                      </select>
                    </label>
                  ) : (
                    <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-4">
                      <p className="mb-2 text-sm font-medium text-ink-700">Do you want to fill Check-in and Check-out time?</p>
                      <div className="flex flex-wrap gap-2">
                        <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${enterTimesLocal ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                          <input
                            type="radio"
                            name="enterTimesLocal"
                            checked={enterTimesLocal}
                            onChange={() => setEnterTimesLocal(true)}
                            className="mr-2 h-4 w-4"
                          />
                          Yes
                        </label>
                        <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${!enterTimesLocal ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                          <input
                            type="radio"
                            name="enterTimesLocal"
                            checked={!enterTimesLocal}
                            onChange={() => {
                              setEnterTimesLocal(false);
                              setCheckInTimeLocal("");
                              setCheckOutTimeLocal("");
                            }}
                            className="mr-2 h-4 w-4"
                          />
                          No
                        </label>
                      </div>
                      {enterTimesLocal && (
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm text-ink-600">
                            Check In
                            <input
                              type="time"
                              value={checkInTimeLocal}
                              onChange={(e) => setCheckInTimeLocal(e.target.value)}
                              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-sm text-ink-600">
                            Check Out
                            <input
                              type="time"
                              value={checkOutTimeLocal}
                              onChange={(e) => setCheckOutTimeLocal(e.target.value)}
                              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!selectedDateLocal) return;
                        // Determine target user id: prefer explicit userId > 0, else if single employeeIds use that
                        let targetUserId = userId && userId > 0 ? userId : undefined;
                        if (!targetUserId && employeeIds && employeeIds.length === 1) targetUserId = employeeIds[0];
                        if (!targetUserId) {
                          toast.error("Choose a single employee to apply override.");
                          return;
                        }

                        setSavingOverride(true);
                          try {
                            const normalized = statusLocal || "Present";
                            const payload: { status: string; check_in: null | string; check_out: null | string; leave_category?: string } = { status: normalized, check_in: null, check_out: null };
                            if (normalized === "On Leave") {
                              payload.leave_category = leaveCategoryRef.current?.value || "Paid";
                            } else if (enterTimesLocal) {
                              payload.check_in = checkInTimeLocal ? `${selectedDateLocal}T${checkInTimeLocal}:00` : null;
                              payload.check_out = checkOutTimeLocal ? `${selectedDateLocal}T${checkOutTimeLocal}:00` : null;
                            }
                            await api.put(`/attendance/user/${targetUserId}/date/${selectedDateLocal}`, payload);
                          toast.success("Override saved");
                          // update local day data
                          setDays((prev) => prev.map(d => d.date === selectedDateLocal ? { ...d, status: normalized, leave_category: payload.leave_category ?? d.leave_category, check_in: payload.check_in ?? d.check_in, check_out: payload.check_out ?? d.check_out } : d));
                          onOverrideSaved?.();
                        } catch (error) {
                          toast.error(getErrorMessage(error));
                        } finally {
                          setSavingOverride(false);
                        }
                      }}
                      disabled={savingOverride}
                      className="mt-2 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-200"
                    >
                      {savingOverride ? "Saving..." : "Apply Override"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-500">
              Choose a day on the calendar or use the date selector to view override status here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
