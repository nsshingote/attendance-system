export type SalarySlipPresentationData = {
  historical_breakdown_incomplete?: boolean;
  salary_breakdown_total?: number | null;
  net_pay?: number | null;
  total_amount: number;
};

export type SalarySlipAmountsData = SalarySlipPresentationData & {
  total_earnings?: number | null;
  lop_deduction?: number | null;
  half_day_deduction?: number | null;
  total_deductions?: number | null;
  deductions?: { amount: number }[];
};

export const canShowSalaryBreakdown = (slip: SalarySlipPresentationData): boolean =>
  slip.historical_breakdown_incomplete === false
  && typeof slip.salary_breakdown_total === "number"
  && Number.isFinite(slip.salary_breakdown_total);

export const storedSalaryNetPay = (slip: SalarySlipPresentationData): number => {
  const netPay = Number(slip.net_pay);
  return slip.net_pay != null && Number.isFinite(netPay) ? netPay : Number(slip.total_amount);
};

export const salarySlipAmounts = (slip: SalarySlipAmountsData) => {
  const totalEarnings = Number(slip.total_earnings ?? slip.total_amount);
  const lopDeduction = Number(slip.lop_deduction ?? 0);
  const halfDayDeduction = Number(slip.half_day_deduction ?? 0);
  const otherDeductionTotal = (slip.deductions ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return {
    lopDeduction,
    halfDayDeduction,
    salaryBreakdownTotal: Number(slip.salary_breakdown_total ?? (totalEarnings - lopDeduction - halfDayDeduction)),
    totalDeductions: Number(slip.total_deductions ?? (lopDeduction + halfDayDeduction + otherDeductionTotal)),
    netPay: storedSalaryNetPay(slip),
  };
};
