import assert from "node:assert/strict";
import test from "node:test";
import { canShowSalaryBreakdown, storedSalaryNetPay } from "./salarySlipPresentation.ts";

test("legacy slip with mismatched particulars preserves stored net and hides breakdown", () => {
  const slip = {
    historical_breakdown_incomplete: true,
    salary_breakdown_total: null,
    net_pay: 987.65,
    total_amount: 987.65,
  };

  assert.equal(canShowSalaryBreakdown(slip), false);
  assert.equal(storedSalaryNetPay(slip), 987.65);
});

test("slip without validated breakdown metadata fails closed", () => {
  assert.equal(canShowSalaryBreakdown({ total_amount: 1000, salary_breakdown_total: 1000 }), false);
});

test("validated structured slip can show its reconciled breakdown", () => {
  assert.equal(canShowSalaryBreakdown({
    historical_breakdown_incomplete: false,
    salary_breakdown_total: 900,
    total_amount: 900,
  }), true);
});
