"use client";

/**
 * components/Dashboard/MonthlySummary.tsx
 * Summary stats for the attendance page (Present, Half Day, Absent, Holiday, Leave)
 */

interface MonthlySummaryProps {
  summary: {
    Present: number;
    "Half Day": number;
    Absent: number;
    Holiday: number;
    Leave: number;
  };
}

const STATS = [
  { key: "Present", label: "Present", color: "bg-emerald-700" },
  { key: "Half Day", label: "Half Day", color: "bg-yellow-400" },
  { key: "Absent", label: "Absent", color: "bg-red-500" },
  { key: "Holiday", label: "Holiday", color: "bg-pink-400" },
  { key: "Leave", label: "Leave", color: "bg-red-500" },
];

export default function MonthlySummary({ summary }: MonthlySummaryProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
      {STATS.map(({ key, label, color }) => {
        const value = summary[key as keyof typeof summary] ?? 0;
        return (
          <div
            key={key}
            className="flex flex-col items-center rounded-lg border border-ink-200 bg-white p-2 shadow-sm sm:p-3"
          >
            <span className="text-xs font-medium text-ink-500 truncate w-full text-center">
              {label}
            </span>
            <span className="text-lg font-semibold text-ink-900 sm:text-xl">{value}</span>
            <span className="mt-0.5 h-1 w-8 rounded-full sm:w-10" style={{ backgroundColor: color }} />
          </div>
        );
      })}
    </div>
  );
}