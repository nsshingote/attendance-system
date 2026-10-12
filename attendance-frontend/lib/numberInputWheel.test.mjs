import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wheel guard blurs only focused application number inputs and keeps page scrolling", async () => {
  const source = await readFile(new URL("../components/Common/NumberInputWheelGuard.tsx", import.meta.url), "utf8");

  assert.match(source, /target\.type === "number"/);
  assert.match(source, /target\.classList\.contains\("number-input-no-spinner"\)/);
  assert.match(source, /target\.blur\(\)/);
  assert.match(source, /passive: true/);
  assert.doesNotMatch(source, /preventDefault/);
});

test("salary-slip request attendance fields retain the spinner-free input class", async () => {
  const source = await readFile(new URL("../app/employee-documents/page.tsx", import.meta.url), "utf8");
  const requestFields = source.match(/Leave Without Pay \(days\)[\s\S]*?Half-Day \(days\)[\s\S]*?<\/label>/);

  assert.ok(requestFields);
  assert.equal((requestFields[0].match(/number-input-no-spinner/g) || []).length, 2);
});
