"use client";

/**
 * components/Calendar/MonthSelector.tsx
 * Month/year navigator used above calendar and table views.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface MonthSelectorProps {
  year: number;
  month: number; // 1-12
  onChange: (year: number, month: number) => void;
}

export default function MonthSelector({ year, month, onChange }: MonthSelectorProps) {
  const goPrev = () => {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  };

  const goNext = () => {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  };

  const label = format(new Date(year, month - 1, 1), "MMMM yyyy");

  return (
    <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5">
      <button onClick={goPrev} aria-label="Previous month" className="rounded p-1 text-ink-500 hover:bg-ink-100">
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-120px text-center text-sm font-medium text-ink-800">{label}</span>
      <button onClick={goNext} aria-label="Next month" className="rounded p-1 text-ink-500 hover:bg-ink-100">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}