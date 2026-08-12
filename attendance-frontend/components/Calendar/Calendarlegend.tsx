/**
 * components/Calendar/CalendarLegend.tsx
 * Color-key legend shown beneath AttendanceCalendar.
 */

const LEGEND_ITEMS = [
  { label: "Present", dot: "bg-emerald-700" },
  { label: "Late", dot: "bg-lime-400" },
  { label: "Absent", dot: "bg-red-500" },
  { label: "On Leave", dot: "bg-red-500" },
  { label: "Half Day", dot: "bg-yellow-400" },
  { label: "WFH", dot: "bg-violet-500" },
  { label: "Weekly Off", dot: "bg-slate-400" },
  { label: "Extra Working Day", dot: "bg-blue-500" },
  { label: "Holiday", dot: "bg-pink-400" },
];

export default function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-600">
      {LEGEND_ITEMS.map(({ label, dot }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          {label}
        </div>
      ))}
    </div>
  );
}
