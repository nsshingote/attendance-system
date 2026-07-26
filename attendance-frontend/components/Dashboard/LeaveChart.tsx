"use client";

/**
 * components/Dashboard/LeaveChart.tsx
 * Pie chart of leave requests by status (Recharts).
 */

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface LeaveChartProps {
  data: { name: string; value: number }[];
}

const COLORS: Record<string, string> = {
  Pending: "#D97706",
  Approved: "#16A34A",
  Rejected: "#DC2626",
};

export default function LeaveChart({ data }: LeaveChartProps) {
  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
      <h3 className="mb-4 text-sm font-semibold text-ink-900">Leave Requests</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name] || "#94A3B8"} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span className="text-xs text-ink-600">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-260px items-center justify-center text-sm text-ink-400">No leave data yet</div>
      )}
    </div>
  );
}