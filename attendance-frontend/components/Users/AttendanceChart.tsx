// "use client";

// /**
//  * components/Users/AttendanceChart.tsx
//  * Simple bar chart showing user's attendance breakdown for a month.
//  * Uses divs instead of Recharts for reliability.
//  */

// import { useEffect, useState } from "react";
// import toast from "react-hot-toast";
// import api, { getErrorMessage } from "@/lib/api";
// import Loading from "@/components/Common/Loading";

// interface AttendanceChartProps {
//   userId: number;
//   year: number;
//   month: number;
// }

// interface ChartData {
//   name: string;
//   value: number;
//   color: string;
// }

// const COLORS: Record<string, string> = {
//   Present: "#22c55e",
//   WFH: "#06b6d4",
//   "Half Day": "#8b5cf6",
//   Leave: "#f59e0b",
//   Holidays: "#3b82f6",
//   "Total Hours": "#0ea5e9",
// };

// export default function AttendanceChart({ userId, year, month }: AttendanceChartProps) {
//   const [data, setData] = useState<ChartData[]>([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const fetchSummary = async () => {
//       try {
//         const { data: summary } = await api.get(`/attendance/summary/${userId}`, {
//           params: { year, month },
//         });

//         console.log("📊 User chart data:", summary);

//         const chartData: ChartData[] = [
//           { name: "Present", value: summary.Present || 0, color: COLORS.Present },
//           { name: "WFH", value: summary.WFH || 0, color: COLORS.WFH },
//           { name: "Half Day", value: summary["Half Day"] || 0, color: COLORS["Half Day"] },
//           { name: "Leave", value: summary.Leave || 0, color: COLORS.Leave },
//           { name: "Holidays", value: summary.Holiday || 0, color: COLORS.Holidays },
//           { name: "Total Hours", value: summary["Total Hours"] || 0, color: COLORS["Total Hours"] },
//         ];

//         setData(chartData);
//       } catch (error) {
//         toast.error(getErrorMessage(error));
//         setData([]);
//       } finally {
//         setLoading(false);
//       }
//     };

//     if (userId) {
//       fetchSummary();
//     }
//   }, [userId, year, month]);

//   if (loading) {
//     return (
//       <div className="flex justify-center py-8">
//         <Loading />
//       </div>
//     );
//   }

//   const hasData = data && data.some((item) => item.value > 0);

//   if (!hasData) {
//     return (
//       <div className="flex h-200px items-center justify-center text-sm text-ink-500">
//         No attendance data for this month
//       </div>
//     );
//   }

//   // Find max value for scaling
//   const maxValue = Math.max(...data.map((item) => item.value), 1);

//   return (
//     <div className="w-full">
//       <div className="space-y-3">
//         {data.map((item) => {
//           const percentage = (item.value / maxValue) * 100;
//           return (
//             <div key={item.name} className="flex items-center gap-3">
//               <span className="w-20 text-xs font-medium text-ink-600">
//                 {item.name}
//               </span>
//               <div className="flex-1 h-7 bg-ink-100 rounded-full overflow-hidden">
//                 <div
//                   className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
//                   style={{
//                     width: `${Math.max(percentage, 2)}%`,
//                     backgroundColor: item.color,
//                     minWidth: item.value > 0 ? "20px" : "0",
//                   }}
//                 >
//                   {item.value > 0 && (
//                     <span className="text-[10px] font-medium text-white">
//                       {item.value}
//                     </span>
//                   )}
//                 </div>
//               </div>
//               <span className="w-8 text-xs font-semibold text-ink-900 text-right">
//                 {item.value}
//               </span>
//             </div>
//           );
//         })}
//       </div>
//     </div>
//   );
// }

"use client";

/**
 * components/Users/AttendanceChart.tsx
 * Bar chart showing user's attendance breakdown for a month.
 * Uses Recharts.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  LabelList,
  Tooltip,
} from "recharts";
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
  Present: "#047857",
  WFH: "#8B5CF6",
  "Half Day": "#FACC15",
  Leave: "#DC2626",
  Holidays: "#EC4899",
  "Total Hours": "#0EA5E9",
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
          { name: "WFH", value: summary.WFH || 0, color: COLORS.WFH },
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

  return (
    <div className="w-full" style={{ height: data.length * 42 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
          barCategoryGap={10}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={80}
            tick={{ fontSize: 12, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
           cursor={{ fill: "rgba(0,0,0,0.04)" }}
           formatter={(value) => `${value}`}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {data.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              style={{ fontSize: 12, fontWeight: 600, fill: "#0f172a" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}