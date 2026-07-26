/**
 * components/Common/Badge.tsx
 * Small status pill. Maps a status string to the corresponding
 * `.status-*` class defined in app/globals.css.
 */

import clsx from "clsx";

type BadgeStatus =
  | "Present"
  | "Late"
  | "Half Day"
  | "Absent"
  | "Holiday"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "active"
  | "inactive";

const STATUS_CLASS_MAP: Record<string, string> = {
  Present: "status-present",
  Late: "status-late",
  "Half Day": "status-half-day",
  Absent: "status-absent",
  Holiday: "status-holiday",
  Pending: "status-pending",
  Approved: "status-approved",
  Rejected: "status-rejected",
  active: "status-approved",
  inactive: "status-absent",
};

interface BadgeProps {
  status: BadgeStatus | string;
  className?: string;
}

export default function Badge({ status, className }: BadgeProps) {
  const statusClass = STATUS_CLASS_MAP[status] ?? "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        statusClass,
        className
      )}
    >
      {status}
    </span>
  );
}