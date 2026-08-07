"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface EmployeeOption { id: number; name: string; }

interface EmployeeMultiSelectProps {
  employees: EmployeeOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  allLabel?: string;
  className?: string;
}

export default function EmployeeMultiSelect({ employees, value, onChange, allLabel = "All Employees", className = "" }: EmployeeMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => employees.filter((employee) => value.includes(employee.id)), [employees, value]);
  const filtered = useMemo(() => employees.filter((employee) => employee.name.toLowerCase().includes(search.trim().toLowerCase())), [employees, search]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const summary = selected.length === 0 ? allLabel : selected.length > 2 ? `${selected.length} selected` : selected.map((employee) => employee.name).join(", ");

  return <div ref={root} className={`relative min-w-52 ${className}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-h-10 w-full items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50">
      <span className="min-w-0 flex-1 truncate">{summary}</span><ChevronDown size={16} className="shrink-0" />
    </button>
    {open && <div className="absolute right-0 z-50 mt-1 w-full min-w-64 rounded-lg border border-ink-200 bg-white p-2 shadow-lg">
      <div className="relative"><Search size={15} className="absolute left-2 top-2.5 text-ink-400" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" className="w-full rounded border border-ink-200 py-2 pl-8 pr-2 text-sm" /></div>
      <div className="mt-2 flex gap-2"><button type="button" onClick={() => onChange(employees.map((employee) => employee.id))} className="text-xs font-medium text-brand-600 hover:text-brand-700">Select All</button><button type="button" onClick={() => onChange([])} className="text-xs font-medium text-ink-500 hover:text-ink-700">Clear All</button></div>
      {selected.length > 0 && selected.length <= 2 && <div className="mt-2 flex flex-wrap gap-1">{selected.map((employee) => <span key={employee.id} className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700">{employee.name}<button type="button" onClick={() => toggle(employee.id)} aria-label={`Remove ${employee.name}`}><X size={12} /></button></span>)}</div>}
      <div className="mt-2 max-h-56 overflow-y-auto">{filtered.map((employee) => <button type="button" key={employee.id} onClick={() => toggle(employee.id)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-ink-50"><span className={`flex h-4 w-4 items-center justify-center rounded border ${value.includes(employee.id) ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300"}`}>{value.includes(employee.id) && <Check size={12} />}</span>{employee.name}</button>)}{filtered.length === 0 && <p className="px-2 py-3 text-sm text-ink-500">No employees found.</p>}</div>
    </div>}
  </div>;
}
