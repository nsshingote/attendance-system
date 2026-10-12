import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAttendanceActionRunner,
  isRecoverableAttendanceError,
} from "./attendanceAction.ts";

const checkedIn = { check_in: "2026-10-10T09:00:00+05:30", check_out: null };
const checkedOut = { ...checkedIn, check_out: "2026-10-10T18:00:00+05:30" };
const notCheckedIn = { check_in: null, check_out: null };

const callbacks = () => {
  let started = 0;
  let finished = 0;
  return {
    onStart: () => { started += 1; },
    onFinish: () => { finished += 1; },
    counts: () => ({ started, finished }),
  };
};

test("successful check-in and check-out require refreshed server state", async () => {
  for (const [action, status] of [["check_in", checkedIn], ["check_out", checkedOut]]) {
    const runner = createAttendanceActionRunner();
    let submits = 0;
    let refreshes = 0;
    const lifecycle = callbacks();
    const result = await runner(
      action,
      async () => { submits += 1; },
      async () => { refreshes += 1; return status; },
      lifecycle.onStart,
      lifecycle.onFinish,
    );

    assert.equal(result.confirmed, true);
    assert.equal(result.requestFailed, false);
    assert.equal(submits, 1);
    assert.equal(refreshes, 1);
    assert.deepEqual(lifecycle.counts(), { started: 1, finished: 1 });
  }
});

test("successful action response updates status without waiting for dashboard refresh", async () => {
  const runner = createAttendanceActionRunner();
  let resolveRefresh;
  let updatedStatus;
  let refreshFinished = false;
  const refreshGate = new Promise((resolve) => { resolveRefresh = resolve; });
  const result = await runner(
    "check_in",
    async () => checkedIn,
    async () => { await refreshGate; refreshFinished = true; return checkedIn; },
    () => {},
    () => {},
    (status) => { updatedStatus = status; },
  );

  assert.equal(result.confirmed, true);
  assert.equal(result.refreshPending, true);
  assert.deepEqual(updatedStatus, checkedIn);
  assert.equal(refreshFinished, false);
  resolveRefresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshFinished, true);
});

test("dashboard refresh failure after confirmed action is surfaced separately", async () => {
  const runner = createAttendanceActionRunner();
  const refreshError = new Error("Dashboard unavailable");
  let reportedRefreshError;
  const result = await runner(
    "check_out",
    async () => checkedOut,
    async () => { throw refreshError; },
    () => {},
    () => {},
    () => {},
    (error) => { reportedRefreshError = error; },
  );

  assert.equal(result.confirmed, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reportedRefreshError, refreshError);
});

test("ambiguous request failure refreshes and confirms the committed check-in", async () => {
  const runner = createAttendanceActionRunner();
  const result = await runner(
    "check_in",
    async () => { throw new Error("Network Error"); },
    async () => checkedIn,
    () => {},
    () => {},
  );

  assert.equal(result.requestFailed, true);
  assert.equal(result.refreshFailed, false);
  assert.equal(result.confirmed, true);
  assert.equal(isRecoverableAttendanceError("check_in", "Network Error", result.requestError, true), true);
});

test("already-processed responses recover only from confirmed server state", async () => {
  const runner = createAttendanceActionRunner();
  const duplicateError = Object.assign(new Error("You have already checked out today"), {
    response: { status: 400 },
  });
  const result = await runner(
    "check_out",
    async () => { throw duplicateError; },
    async () => checkedOut,
    () => {},
    () => {},
  );

  assert.equal(result.confirmed, true);
  assert.equal(isRecoverableAttendanceError("check_out", "You have already checked out today", result.requestError, true), true);
  assert.equal(isRecoverableAttendanceError("check_in", "You have already checked out today", result.requestError, true), false);
});

test("request and status refresh failures are reported separately", async () => {
  const runner = createAttendanceActionRunner();
  const requestError = new Error("Request timed out");
  const refreshError = new Error("Dashboard unavailable");
  const result = await runner(
    "check_out",
    async () => { throw requestError; },
    async () => { throw refreshError; },
    () => {},
    () => {},
  );

  assert.equal(result.requestError, requestError);
  assert.equal(result.refreshError, refreshError);
  assert.equal(result.refreshFailed, true);
  assert.equal(result.confirmed, false);
});

test("a second submission while the first is in flight is skipped", async () => {
  const runner = createAttendanceActionRunner();
  let resolveSubmit;
  let submits = 0;
  let refreshes = 0;
  const submitGate = new Promise((resolve) => { resolveSubmit = resolve; });
  const lifecycle = callbacks();
  const first = runner(
    "check_in",
    async () => { submits += 1; await submitGate; },
    async () => { refreshes += 1; return checkedIn; },
    lifecycle.onStart,
    lifecycle.onFinish,
  );

  const second = await runner(
    "check_in",
    async () => { submits += 1; },
    async () => { refreshes += 1; return checkedIn; },
    lifecycle.onStart,
    lifecycle.onFinish,
  );
  resolveSubmit();
  const firstResult = await first;

  assert.equal(second.skipped, true);
  assert.equal(firstResult.confirmed, true);
  assert.equal(submits, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(lifecycle.counts(), { started: 1, finished: 1 });
});

test("an explicit rejection is not considered successful when refreshed state is absent", async () => {
  const runner = createAttendanceActionRunner();
  const validationError = Object.assign(new Error("REASON_REQUIRED"), {
    response: { status: 400 },
  });
  const result = await runner(
    "check_in",
    async () => { throw validationError; },
    async () => notCheckedIn,
    () => {},
    () => {},
  );

  assert.equal(result.requestFailed, true);
  assert.equal(result.confirmed, false);
  assert.equal(isRecoverableAttendanceError("check_in", "REASON_REQUIRED", result.requestError, true), false);
});

test("a successful POST without matching refreshed state is not confirmed", async () => {
  const runner = createAttendanceActionRunner();
  const result = await runner(
    "check_out",
    async () => {},
    async () => checkedIn,
    () => {},
    () => {},
  );

  assert.equal(result.requestFailed, false);
  assert.equal(result.confirmed, false);
});

test("a successful POST with a failed status refresh is not reported as confirmed", async () => {
  const runner = createAttendanceActionRunner();
  const refreshError = new Error("Dashboard unavailable");
  const result = await runner(
    "check_in",
    async () => {},
    async () => { throw refreshError; },
    () => {},
    () => {},
  );

  assert.equal(result.requestFailed, false);
  assert.equal(result.refreshFailed, true);
  assert.equal(result.refreshError, refreshError);
  assert.equal(result.confirmed, false);
});

test("both attendance controls offer a status-only retry when status cannot be refreshed", async () => {
  for (const file of ["../components/Attendance/CheckInButton.tsx", "../components/Attendance/CheckOutButton.tsx"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /setStatusUncertain\(true\)/);
    assert.match(source, /statusUncertain \? void retryStatusRefresh\(\) : void submitCheck/);
    assert.match(source, /await refreshStatus\(\);[\s\S]*setStatusUncertain\(false\)/);
    assert.match(source, /Attendance status could not be verified/);
    assert.match(source, /statusUncertain \? "Retry Status Check"/);
  }
});
