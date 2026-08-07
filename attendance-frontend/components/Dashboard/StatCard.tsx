/**
 * components/Dashboard/StatCard.tsx
 * Single stat tile used across the Admin dashboard.
 */

import { LucideIcon } from "lucide-react";
import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "brand" | "green" | "amber" | "red" | "violet" | "lime";
}

const TONE_CLASSES: Record<string, string> = {
  brand: "bg-brand-50 text-brand-600",
  green: "bg-green-50 text-green-600",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  violet: "bg-violet-50 text-violet-600",
  lime: "bg-lime-50 text-lime-600",
};

export default function StatCard({ label, value, icon: Icon, tone = "brand" }: StatCardProps) {
  return (
    <div className="flex h-full min-h-[136px] flex-col justify-between rounded-[1rem] border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
        </div>
        <div className={clsx("flex h-11 w-11 items-center justify-center rounded-2xl", TONE_CLASSES[tone])}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}
