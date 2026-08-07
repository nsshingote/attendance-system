"use client";

import { useState } from "react";

export default function ExpandableText({ text, limit = 48, emptyText = "—" }: { text?: string | null; limit?: number; emptyText?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <>{emptyText}</>;
  const shortened = text.length > limit;
  return <span className="wrap-break-words">{expanded || !shortened ? text : `${text.slice(0, limit).trimEnd()}…`}{shortened && <button type="button" onClick={() => setExpanded((value) => !value)} className="ml-1 whitespace-nowrap text-xs font-medium text-brand-600 hover:text-brand-700">{expanded ? "Show less" : "Show more"}</button>}</span>;
}
