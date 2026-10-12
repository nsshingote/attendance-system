import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("profile active-day counts use the Present total without re-adding its included statuses", async () => {
  const source = await readFile(new URL("../app/users/[id]/page.tsx", import.meta.url), "utf8");

  const activeDays = source.match(/const activeDays = ([^;]+);/);
  const rangeActiveDays = source.match(/const rangeActiveDays = rangeSummary\s*\?\s*([^:;]+):\s*0;/);

  assert.ok(activeDays);
  assert.ok(rangeActiveDays);
  const summary = { Present: 5, "Half Day": 1, WFH: 1, "Extra Working Day": 1 };
  assert.equal(activeDays[1].trim(), "attendanceSummary.Present");
  assert.equal(rangeActiveDays[1].trim(), "rangeSummary.Present");
  assert.equal(summary.Present, 5);
});
