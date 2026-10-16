export type DynamicLetterSnapshot = {
  format?: string;
  resolved_content?: string;
  template_content?: string;
  template_layout?: unknown;
  layout_validated?: boolean;
};

export type GeneratedLetterKind = "dynamic" | "appointment" | "offer" | "other";

export function isDynamicLetterSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as DynamicLetterSnapshot;
  return snapshot.format === "dynamic_letter_v1" || typeof snapshot.resolved_content === "string";
}

export function getGeneratedLetterKind(documentType: string, value: unknown): GeneratedLetterKind {
  if (isDynamicLetterSnapshot(value)) return "dynamic";
  if (documentType === "appointment_letter") return "appointment";
  if (documentType === "offer_letter") return "offer";
  return "other";
}
