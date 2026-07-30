export function parseISTDateTime(isoString: string | null | undefined): Date | null {
  if (!isoString) return null;
  const normalized = isoString.trim().replace(" ", "T");
  const hasTimezoneOffset = /([+-]\d{2}:\d{2}|Z)$/.test(normalized);

  // If timestamp already contains timezone info, parse directly.
  if (hasTimezoneOffset) {
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try two interpretations for legacy/ambiguous naive datetimes:
  // 1) Treat as IST (append +05:30)
  // 2) Treat as UTC (append Z) and then convert for display
  const asIst = new Date(`${normalized}+05:30`);
  const asUtc = new Date(`${normalized}Z`);

  const isValidIst = !isNaN(asIst.getTime());
  const isValidUtc = !isNaN(asUtc.getTime());

  // Heuristic: prefer the interpretation that yields a time within typical work hours in IST
  const plausibleStart = 6; // 6:00 IST
  const plausibleEnd = 22;  // 22:00 IST

  const istHourIfIst = isValidIst ? asIst.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }) : null;
  const istHourIfUtc = isValidUtc ? asUtc.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }) : null;

  const hourIst = istHourIfIst ? parseInt(String(istHourIfIst)) : null;
  const hourUtc = istHourIfUtc ? parseInt(String(istHourIfUtc)) : null;

  const istPlausible = hourIst !== null && hourIst >= plausibleStart && hourIst <= plausibleEnd;
  const utcPlausible = hourUtc !== null && hourUtc >= plausibleStart && hourUtc <= plausibleEnd;

  if (istPlausible && !utcPlausible) return asIst;
  if (utcPlausible && !istPlausible) return asUtc;

  // If both plausible, prefer IST (backend currently stores IST naive)
  if (isValidIst) return asIst;
  if (isValidUtc) return asUtc;

  // Fallback: try plain parse
  const fallback = new Date(normalized);
  return isNaN(fallback.getTime()) ? null : fallback;
}
