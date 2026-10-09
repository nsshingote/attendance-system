export type SalarySlipPresentationData = {
  historical_breakdown_incomplete?: boolean;
  salary_breakdown_total?: number | null;
  net_pay?: number | null;
  total_amount: number;
};

export const canShowSalaryBreakdown = (slip: SalarySlipPresentationData): boolean =>
  slip.historical_breakdown_incomplete === false
  && typeof slip.salary_breakdown_total === "number"
  && Number.isFinite(slip.salary_breakdown_total);

export const storedSalaryNetPay = (slip: SalarySlipPresentationData): number => {
  const netPay = Number(slip.net_pay);
  return slip.net_pay != null && Number.isFinite(netPay) ? netPay : Number(slip.total_amount);
};
