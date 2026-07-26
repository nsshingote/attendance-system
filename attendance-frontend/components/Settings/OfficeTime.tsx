/**
 * components/Settings/OfficeTime.tsx
 * Read-only office-hours summary strip shown above the settings form.
 */

interface OfficeTimeProps {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  weeklyOffDay: string;
}

export default function OfficeTime({ startTime, endTime, graceMinutes, weeklyOffDay }: OfficeTimeProps) {
  const items = [
    { label: "Office Starts", value: startTime.slice(0, 5) },
    { label: "Office Ends", value: endTime.slice(0, 5) },
    { label: "Grace Period", value: `${graceMinutes} min` },
    { label: "Weekly Off", value: weeklyOffDay },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-ink-200 bg-white p-4 text-center shadow-card">
          <p className="text-lg font-semibold text-ink-900">{item.value}</p>
          <p className="mt-1 text-xs text-ink-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}