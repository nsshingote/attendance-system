import assert from "node:assert/strict";
import test from "node:test";
import { canShowSalaryBreakdown, salarySlipAmounts, storedSalaryNetPay } from "./salarySlipPresentation.ts";

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

test("salary slip presentation and PDF amounts use the saved attendance overrides once", () => {
  const amounts = salarySlipAmounts({
    total_earnings: 12500,
    lop_deduction: 200,
    half_day_deduction: 250,
    salary_breakdown_total: 12050,
    total_deductions: 625,
    net_pay: 11875,
    total_amount: 11875,
    deductions: [{ amount: 100 }, { amount: 50 }, { amount: 25 }],
  });

  assert.deepEqual(amounts, {
    lopDeduction: 200,
    halfDayDeduction: 250,
    salaryBreakdownTotal: 12050,
    totalDeductions: 625,
    netPay: 11875,
  });
});
