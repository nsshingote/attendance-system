"use client";

/**
 * components/Dashboard/AttendanceChart.tsx
 * Simple bar chart using divs instead of Recharts (no external dependency)
 */

interface AttendanceChartProps {
  data: { status: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  Present: "#047857",
  Late: "#A3E635",
  "Half Day": "#FACC15",
  Absent: "#DC2626",
  Holiday: "#EC4899",
  Leave: "#DC2626",
  WFH: "#8B5CF6",
  "Working Day": "#F97316",
  "Extra Working Day": "#3B82F6",
  "Weekly Off": "#94A3B8",
};

export default function AttendanceChart({ data }: AttendanceChartProps) {
  // Debug: log the data
  console.log("AttendanceChart data:", data);

  // Check if data exists and has values
  const hasData = data && Array.isArray(data) && data.some((item) => item.count > 0);

  if (!hasData) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card w-full">
        <h3 className="mb-4 text-sm font-semibold text-ink-900">Attendance Breakdown</h3>
        <div className="flex h-200px items-center justify-center text-sm text-ink-500">
          No attendance data available for today
        </div>
      </div>
    );
  }

  // Find max count for scaling
  const maxCount = Math.max(...data.map((item) => item.count), 1);

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card w-full">
      <h3 className="mb-4 text-sm font-semibold text-ink-900">Attendance Breakdown</h3>
      <div className="space-y-3">
        {data.map((item) => {
          const percentage = (item.count / maxCount) * 100;
          return (
            <div key={item.status} className="flex items-center gap-3">
              <span className="w-16 text-xs font-medium text-ink-600">
                {item.status}
              </span>
              <div className="flex-1 h-7 bg-ink-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 flex items-center"
                  style={{
                    width: `${Math.max(percentage, 2)}%`,
                    backgroundColor: STATUS_COLORS[item.status] || "#94A3B8",
                    minWidth: item.count > 0 ? "20px" : "0",
                  }}
                >
                  {item.count > 0 && (
                    <span className="ml-1 text-[10px] font-medium text-white">
                      {item.count}
                    </span>
                  )}
                </div>
              </div>
              <span className="w-8 text-xs font-semibold text-ink-900 text-right">
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}