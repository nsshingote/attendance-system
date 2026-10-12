export const HALF_DAY_SLOTS = [
  { value: "morning", label: "Morning Slot" },
  { value: "afternoon", label: "Afternoon Slot" },
] as const;

export function halfDaySlotLabel(slot: string): string {
  return HALF_DAY_SLOTS.find((option) => option.value === slot)?.label ?? slot;
}
