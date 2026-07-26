"use client";

/**
 * components/Users/AttendanceChart.tsx
 * Simple bar chart showing user's attendance breakdown for a month.
 * Uses divs instead of Recharts for reliability.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";

interface AttendanceChartProps {
  userId: number;
  year: number;
  month: number;
}

interface ChartData {
  name: string;
  value: number;
  color: string;
}

const COLORS: Record<string, string> = {
  Present: "#22c55e",
  "Half Day": "#8b5cf6",
  Leave: "#f59e0b",
  Holidays: "#3b82f6",
  "Total Hours": "#06b6d4",
};

export default function AttendanceChart({ userId, year, month }: AttendanceChartProps) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const { data: summary } = await api.get(`/attendance/summary/${userId}`, {
          params: { year, month },
        });

        console.log("📊 User chart data:", summary);

        const chartData: ChartData[] = [
          { name: "Present", value: summary.Present || 0, color: COLORS.Present },
          { name: "Half Day", value: summary["Half Day"] || 0, color: COLORS["Half Day"] },
          { name: "Leave", value: summary.Leave || 0, color: COLORS.Leave },
          { name: "Holidays", value: summary.Holiday || 0, color: COLORS.Holidays },
          { name: "Total Hours", value: summary["Total Hours"] || 0, color: COLORS["Total Hours"] },
        ];

        setData(chartData);
      } catch (error) {
        toast.error(getErrorMessage(error));
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchSummary();
    }
  }, [userId, year, month]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loading />
      </div>
    );
  }

  const hasData = data && data.some((item) => item.value > 0);

  if (!hasData) {
    return (
      <div className="flex h-200px items-center justify-center text-sm text-ink-500">
        No attendance data for this month
      </div>
    );
  }

  // Find max value for scaling
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className="w-full">
      <div className="space-y-3">
        {data.map((item) => {
          const percentage = (item.value / maxValue) * 100;
          return (
            <div key={item.name} className="flex items-center gap-3">
              <span className="w-20 text-xs font-medium text-ink-600">
                {item.name}
              </span>
              <div className="flex-1 h-7 bg-ink-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.max(percentage, 2)}%`,
                    backgroundColor: item.color,
                    minWidth: item.value > 0 ? "20px" : "0",
                  }}
                >
                  {item.value > 0 && (
                    <span className="text-[10px] font-medium text-white">
                      {item.value}
                    </span>
                  )}
                </div>
              </div>
              <span className="w-8 text-xs font-semibold text-ink-900 text-right">
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}