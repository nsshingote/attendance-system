"use client";

/**
 * components/Leave/EmailSelector.tsx
 * Multi-select checklist of notification-email recipients, shown in
 * LeaveForm — mirrors GET /notification-emails.
 */

import { useEffect, useState } from "react";
import api from "@/lib/api";

interface EmailOption {
  id: number;
  name: string | null;
  email: string | null;
}

interface EmailSelectorProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

export default function EmailSelector({ selectedIds, onChange }: EmailSelectorProps) {
  const [options, setOptions] = useState<EmailOption[]>([]);

  useEffect(() => {
    api
      .get<EmailOption[]>("/notification-emails/")
      .then(({ data }) => setOptions(data))
      .catch(() => {});
  }, []);

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]);
  };

  if (options.length === 0) {
    return <p className="text-xs text-ink-400">No notification recipients configured.</p>;
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-ink-200 p-3">
      {options.map((opt) => (
        <label key={opt.id} className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={selectedIds.includes(opt.id)}
            onChange={() => toggle(opt.id)}
            className="rounded border-ink-300 text-brand-500 focus:ring-brand-400"
          />
          {opt.name ? `${opt.name} (${opt.email})` : opt.email}
        </label>
      ))}
    </div>
  );
}