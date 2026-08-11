/**
 * components/Calendar/CalendarLegend.tsx
 * Color-key legend shown beneath AttendanceCalendar.
 */

const LEGEND_ITEMS = [
  { label: "Present", dot: "bg-green-500" },
  { label: "Late", dot: "bg-lime-400" },
  { label: "Half Day", dot: "bg-purple-500" },
  { label: "Absent", dot: "bg-red-400" },
  { label: "Holiday", dot: "bg-blue-400" },
  { label: "On Leave", dot: "bg-amber-400" },
  { label: "WFH", dot: "bg-cyan-500" },
  { label: "Working Day", dot: "bg-orange-500" },
  { label: "Extra Working Day", dot: "bg-fuchsia-500" },
  { label: "Weekly Off", dot: "bg-gray-300" },
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
