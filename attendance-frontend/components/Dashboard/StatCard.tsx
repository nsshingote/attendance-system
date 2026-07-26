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
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        <div className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", TONE_CLASSES[tone])}>
          <Icon size={16} />
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold text-ink-900">{value}</p>
    </div>
  );
}