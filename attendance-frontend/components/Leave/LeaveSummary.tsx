/**
 * components/Leave/LeaveSummary.tsx
 * Leave balance summary card.
 */

interface LeaveSummaryProps {
  paidLeaveAvailableThisMonth: number;
  carriedLeave: number;
  leaveEncashed: number;
  totalLeaveBalance: number;
}

export default function LeaveSummary({
  paidLeaveAvailableThisMonth,
  carriedLeave,
  leaveEncashed,
  totalLeaveBalance,
}: LeaveSummaryProps) {
  const items = [
    {
      label: "Total Leave Balance",
      value: totalLeaveBalance,
      highlight: true,
    },
    {
      label: "Paid (This Month)",
      value: paidLeaveAvailableThisMonth,
    },
    {
      label: "Carried Forward",
      value: carriedLeave,
    },
    {
      label: "Encashed",
      value: leaveEncashed,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-xl border p-4 text-center shadow-card ${
            item.highlight
              ? "border-brand-300 bg-brand-50"
              : "border-ink-200 bg-white"
          }`}
        >
          <p
            className={`text-2xl font-semibold ${
              item.highlight ? "text-brand-700" : "text-ink-900"
            }`}
          >
            {item.value}
          </p>
          <p className="mt-1 text-xs text-ink-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}