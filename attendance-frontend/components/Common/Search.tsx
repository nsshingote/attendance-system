"use client";

/**
 * components/Common/Search.tsx
 * Debounced search input, used above tables (users, attendance, leave, etc.)
 */

import { useEffect, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";

interface SearchProps {
  placeholder?: string;
  onSearch: (value: string) => void;
  debounceMs?: number;
}

export default function Search({ placeholder = "Search...", onSearch, debounceMs = 350 }: SearchProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => {
      onSearch(value.trim());
    }, debounceMs);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-ink-200 bg-white py-2 pl-9 pr-8 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-700"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}