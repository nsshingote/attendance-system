"use client";

import { useEffect, useRef } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

interface HolidayCalendarEntry {
  id: number;
  holiday_date: string;
  holiday_name: string;
}

interface HolidayCalendarProps {
  month: Date;
  holidays: HolidayCalendarEntry[];
  selectedRange: { start: string; end: string } | null;
  onMonthChange: (month: Date) => void;
  onDateSelect: (date: string) => void;
  onRangeSelect: (start: string, end: string) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HolidayCalendar({
  month,
  holidays,
  selectedRange,
  onMonthChange,
  onDateSelect,
  onRangeSelect,
}: HolidayCalendarProps) {
  const dragStart = useRef<string | null>(null);
  const didDrag = useRef(false);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });
  const holidaysByDate = new Map<string, HolidayCalendarEntry[]>();

  holidays.forEach((holiday) => {
    const entries = holidaysByDate.get(holiday.holiday_date) ?? [];
    entries.push(holiday);
    holidaysByDate.set(holiday.holiday_date, entries);
  });

  useEffect(() => {
    const finishDrag = () => {
      dragStart.current = null;
    };

    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  const selectToday = () => {
    const today = new Date();
    onMonthChange(startOfMonth(today));
    onDateSelect(format(today, "yyyy-MM-dd"));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
            <CalendarDays size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink-900">{format(month, "MMMM yyyy")}</h2>
            <p className="text-xs text-ink-500">Select a day or drag to select a date range</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="Previous month"
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-50"
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            onClick={selectToday}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Next month"
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-50"
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50/70">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-500 sm:py-3 sm:text-xs"
          >
            <span className="sm:hidden">{weekday.slice(0, 1)}</span>
            <span className="hidden sm:inline">{weekday}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const date = format(day, "yyyy-MM-dd");
          const dayHolidays = holidaysByDate.get(date) ?? [];
          const hasHoliday = dayHolidays.length > 0;
          const inSelectedRange = selectedRange !== null
            && date >= selectedRange.start
            && date <= selectedRange.end;
          const isSelected = selectedRange?.start === date || selectedRange?.end === date;

          return (
            <button
              key={date}
              type="button"
              onClick={() => {
                if (didDrag.current) {
                  didDrag.current = false;
                  return;
                }
                onDateSelect(date);
              }}
              onPointerDown={() => {
                dragStart.current = date;
                didDrag.current = false;
              }}
              onPointerEnter={() => {
                if (!dragStart.current || dragStart.current === date) return;
                didDrag.current = true;
                const start = dragStart.current;
                onRangeSelect(start < date ? start : date, start < date ? date : start);
              }}
              aria-pressed={inSelectedRange}
              aria-label={`${format(day, "EEEE, MMMM d, yyyy")}${dayHolidays.length ? `, ${dayHolidays.length} holiday${dayHolidays.length === 1 ? "" : "s"}` : ""}`}
              className={[
                "group relative flex min-h-20 min-w-0 flex-col items-stretch border-b border-r border-ink-100 p-1.5 text-left transition-colors sm:min-h-28 sm:p-2.5",
                isSameMonth(day, month) ? "bg-white" : "bg-ink-50/50",
                hasHoliday
                  ? "bg-pink-100 hover:bg-pink-100"
                  : inSelectedRange
                    ? "bg-brand-50"
                    : "hover:bg-ink-50",
                isSelected ? "z-10 ring-2 ring-inset ring-brand-500" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium sm:h-8 sm:w-8 sm:text-sm",
                  !isSameMonth(day, month) ? "text-ink-300" : "text-ink-700",
                  isToday(day) ? "bg-brand-500 font-semibold text-white" : "",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>
              {dayHolidays.length > 0 && (
                <div className="mt-1 flex min-w-0 flex-col gap-1">
                  {dayHolidays.slice(0, 2).map((holiday) => (
                    <span
                      key={holiday.id}
                      title={holiday.holiday_name}
                      className="truncate rounded-md bg-pink-200 px-1 py-0.5 text-[9px] font-medium leading-tight text-pink-900 sm:px-1.5 sm:text-xs"
                    >
                      {holiday.holiday_name}
                    </span>
                  ))}
                  {dayHolidays.length > 2 && (
                    <span className="px-1 text-[9px] font-medium text-ink-500 sm:text-[11px]">
                      +{dayHolidays.length - 2} more
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs text-ink-500 sm:px-6">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-pink-400" />
          Holiday
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          Today
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm border border-brand-500 bg-brand-50" />
          Selected date or range
        </span>
      </div>
    </section>
  );
}
