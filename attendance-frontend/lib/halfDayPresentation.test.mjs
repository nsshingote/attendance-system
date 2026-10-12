import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HALF_DAY_SLOTS, halfDaySlotLabel } from "./halfDayPresentation.ts";

test("half-day slot choices keep legacy values and use the requested labels", () => {
  assert.deepEqual(HALF_DAY_SLOTS, [
    { value: "morning", label: "Morning Slot" },
    { value: "afternoon", label: "Afternoon Slot" },
  ]);
  assert.equal(halfDaySlotLabel("morning"), "Morning Slot");
  assert.equal(halfDaySlotLabel("afternoon"), "Afternoon Slot");
});

test("unknown historical slot values remain visible rather than disappearing", () => {
  assert.equal(halfDaySlotLabel("legacy-slot"), "legacy-slot");
});

test("half-day form keeps the reason optional and omits a blank value", async () => {
  const source = await readFile(new URL("../components/Attendance/HalfDayForm.tsx", import.meta.url), "utf8");
  const reasonField = source.match(/Reason \(optional\)[\s\S]*?<\/div>/);

  assert.ok(reasonField);
  assert.doesNotMatch(reasonField[0], /\brequired\b/);
  assert.match(source, /reason:\s*reason\s*\|\|\s*undefined/);
});
