"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";
import LettersGenerator from "@/components/Documents/LettersGenerator";
import LetterTemplatesViewer from "@/components/Documents/LetterTemplatesViewer";
import MonthSelector from "@/components/Calendar/MonthSelector";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";
import TeamMultiSelect from "@/components/Common/TeamMultiSelect";
import { hasPermission, usePermissions } from "@/lib/permissions";

type Employee = { id: number; name: string; role: string };
type SlipRow = { name: string; amount: number };
type EditableSlipRow = { name: string; amount: string; custom?: boolean };
type SalaryEmployeeDetails = { name: string; designation: string; department: string; phone_number: string; email: string; joining_date: string; pan_number: string; account_number: string; location: string; payment_mode: string; days_in_month: number; days_worked: number; days_paid: number };
type Slip = { id: number; employee_id: number; employee_name: string; month: number; year: number; total_amount: number; net_pay?: number; status: string; particulars: string; employee_details?: SalaryEmployeeDetails; earnings?: SlipRow[]; deductions?: SlipRow[]; lwp_days?: number; total_earnings?: number; lop_deduction?: number; total_deductions?: number; created_at?: string; sent_at?: string | null };
type EmployeeOption = Employee & { designation?: string; department?: string; email?: string | null; mobile?: string | null; place_of_posting?: string | null; date_of_joining?: string | null };
const earningLabels = ["Basic Salary", "House Rent Allowance", "Incentive Pay", "Travelling Allowance", "Overtime", "Extra Working Day"];
const deductionLabels = ["Provident Fund", "Professional Tax", "Health Insurance Contribution"];
const blankRows = (labels: string[]): EditableSlipRow[] => labels.map(name => ({ name, amount: "0" }));
const blankDetails = (period: string): SalaryEmployeeDetails => ({ name: "", designation: "", department: "", phone_number: "", email: "", joining_date: "", pan_number: "", account_number: "", location: "", payment_mode: "", days_in_month: new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate(), days_worked: 0, days_paid: 0 });
const rowsFromSlip = (slip: Slip | undefined, type: "earnings" | "deductions"): EditableSlipRow[] => {
  if (slip?.[type]) return slip[type]!.map(row => ({ ...row, amount: String(row.amount), custom: !(type === "earnings" ? earningLabels : deductionLabels).includes(row.name) }));
  if (type === "deductions") return blankRows(deductionLabels);
  const legacyMap: Record<string, string> = { Salary: "Basic Salary", Incentive: "Incentive Pay", "Extra Working Day": "Extra Working Day", Overtime: "Overtime" };
  let oldRows: SlipRow[] = [];
  try { oldRows = JSON.parse(slip?.particulars || "[]"); } catch { /* Keep the standard rows for malformed historical data. */ }
  const rows = blankRows(earningLabels);
  oldRows.forEach(row => {
    const name = legacyMap[row.name] || row.name;
    const existing = rows.find(item => item.name === name);
    if (existing) existing.amount = String(Number(existing.amount) + Number(row.amount || 0));
    else rows.push({ name, amount: String(row.amount || 0), custom: true });
  });
  return rows;
};
const latestSlipFor = (slips: Slip[], employeeId: string) => slips
  .filter(slip => slip.employee_id === Number(employeeId) && slip.status === "Sent" && Boolean(slip.sent_at))
  .sort((first, second) => Date.parse(second.sent_at!) - Date.parse(first.sent_at!))[0];
const formatMoney = (value: number | string) => {
  const normalized = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(normalized)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(normalized);
};
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function EmployeeDocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const [tab, setTab] = useState("Salary Slips");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [salaryHistoryLoading, setSalaryHistoryLoading] = useState(true);
  const [salaryHistoryLoaded, setSalaryHistoryLoaded] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [employeeDetails, setEmployeeDetails] = useState<SalaryEmployeeDetails>(() => blankDetails(new Date().toISOString().slice(0, 7)));
  const [earnings, setEarnings] = useState<EditableSlipRow[]>(() => blankRows(earningLabels));
  const [deductions, setDeductions] = useState<EditableSlipRow[]>(() => blankRows(deductionLabels));
  const [lwpDays, setLwpDays] = useState("0");
  const [saving, setSaving] = useState(false);
  const [editingSlipId, setEditingSlipId] = useState<number | null>(null);
  const [reviewSlipId, setReviewSlipId] = useState<number | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [teamEmployeeIds, setTeamEmployeeIds] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const canLetters = hasPermission(permissions, "employee_documents.letters.view");
  const canSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.view");
  const canTemplates = hasPermission(permissions, "employee_documents.letter_templates.view");
  const canCreateSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.create");
  const canEditSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.edit");
  const canDeleteSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.delete");
  const canSendSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.send");
  const canManageSalarySlipForm = canCreateSalarySlips || canEditSalarySlips;
  const canCreateTemplates = hasPermission(permissions, "employee_documents.letter_templates.create");
  const canEditTemplates = hasPermission(permissions, "employee_documents.letter_templates.edit");
  const canDeleteTemplates = hasPermission(permissions, "employee_documents.letter_templates.delete");
  const isSalarySlipsRoute = pathname === "/employee-documents/salary-slips";
  const visibleTabs = [canLetters && "Letters", canSalarySlips && "Salary Slips", canTemplates && "Letter Templates"].filter(Boolean) as string[];
  const load = async () => {
    if (!canSalarySlips) return;
    setSalaryHistoryLoading(true);
    try {
      const [users, history] = await Promise.all([api.get<EmployeeOption[]>("/users/employee-selector"), api.get("/employee-documents/salary-slips")]);
      setEmployees(users.data); setSlips(history.data);
      setSalaryHistoryLoaded(true);
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setSalaryHistoryLoading(false); }
  };
  useEffect(() => {
    if (!canSalarySlips) return;
    api.get<EmployeeOption[]>("/users/employee-selector")
      .then(({ data }) => setEmployees(data))
      .catch(error => toast.error(getErrorMessage(error)));
    setSalaryHistoryLoading(true);
    api.get<Slip[]>("/employee-documents/salary-slips")
      .then(({ data }) => { setSlips(data); setSalaryHistoryLoaded(true); })
      .catch(error => toast.error(getErrorMessage(error)))
      .finally(() => setSalaryHistoryLoading(false));
  }, [canSalarySlips]);
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  const totalEarnings = useMemo(() => roundMoney(earnings.reduce((sum, row) => sum + (row.name.trim() ? Math.max(0, Number(row.amount) || 0) : 0), 0)), [earnings]);
  const lopDeduction = useMemo(() => employeeDetails.days_in_month > 0 ? roundMoney(totalEarnings / employeeDetails.days_in_month * Math.max(0, Number(lwpDays) || 0)) : 0, [employeeDetails.days_in_month, lwpDays, totalEarnings]);
  const totalDeductions = useMemo(() => roundMoney(lopDeduction + deductions.reduce((sum, row) => sum + (row.name.trim() ? Math.max(0, Number(row.amount) || 0) : 0), 0)), [deductions, lopDeduction]);
  const netPay = roundMoney(totalEarnings - totalDeductions);
  const filteredSlips = useMemo(() => {
    return slips.filter((slip) => {
      const matchesEmployee = selectedEmployeeIds.length === 0 && teamEmployeeIds.length === 0 || selectedEmployeeIds.includes(slip.employee_id) || teamEmployeeIds.includes(slip.employee_id);
      const matchesMonth = slip.year === selectedYear && slip.month === selectedMonth;
      return matchesEmployee && matchesMonth;
    });
  }, [slips, selectedEmployeeIds, teamEmployeeIds, selectedYear, selectedMonth]);
  const changePeriod = (value: string) => { setPeriod(value); const days = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0).getDate(); setEmployeeDetails(current => ({ ...current, days_in_month: days })); };
  const resetForm = () => { setEmployeeId(""); setEditingSlipId(null); setReviewSlipId(null); setEmployeeDetails(blankDetails(period)); setEarnings(blankRows(earningLabels)); setDeductions(blankRows(deductionLabels)); setLwpDays("0"); };
  const applyEmployeeDefaults = (selectedId: string) => {
    if (!salaryHistoryLoaded) return;
    const employee = employees.find(item => String(item.id) === selectedId);
    const details = blankDetails(period);
    if (employee) Object.assign(details, { name: employee.name || "", designation: employee.designation || "", department: employee.department || "", phone_number: employee.mobile || "", email: employee.email || "", joining_date: employee.date_of_joining ? new Date(`${employee.date_of_joining}T00:00:00`).toLocaleDateString("en-GB") : "", location: employee.place_of_posting || "" });
    const latestSlip = latestSlipFor(slips, selectedId);
    setEmployeeDetails(details); setEarnings(rowsFromSlip(latestSlip, "earnings")); setDeductions(rowsFromSlip(latestSlip, "deductions")); setLwpDays("0");
  };
  const payloadRows = (rows: EditableSlipRow[]) => rows.filter(row => row.name.trim()).map(row => ({ name: row.name.trim(), amount: Number(row.amount) || 0 }));
  const save = async (send: boolean) => {
    if (editingSlipId ? !canEditSalarySlips : !canCreateSalarySlips) return;
    if (send && !canSendSalarySlips) return;
    if (!employeeId) return toast.error("Select an employee");
    setSaving(true);
    try {
      const [year, month] = period.split("-").map(Number);
      await api[editingSlipId ? "put" : "post"](editingSlipId ? `/employee-documents/salary-slips/${editingSlipId}` : "/employee-documents/salary-slips", { employee_id: Number(employeeId), month, year, send,
        employee_details: employeeDetails, earnings: payloadRows(earnings), deductions: payloadRows(deductions), lwp_days: Number(lwpDays) || 0 });
      toast.success(send ? "Salary slip saved and sent" : "Salary slip saved"); resetForm(); await load();
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
  const approveRequest = async () => {
    if (!reviewSlipId || !canEditSalarySlips || !canSendSalarySlips) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/employee-documents/salary-slips/${reviewSlipId}/approve`, { employee_details: employeeDetails, earnings: payloadRows(earnings), deductions: payloadRows(deductions), lwp_days: Number(lwpDays) || 0 });
      resetForm();
      await load();
      toast.success(data.email_sent ? "Salary slip approved and sent" : "Salary slip approved and available; email could not be sent");
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setSaving(false); }
  };
  const startReview = (slip: Slip) => {
    const nextPeriod = `${slip.year}-${String(slip.month).padStart(2, "0")}`;
    setReviewSlipId(slip.id); setEditingSlipId(null); setEmployeeId(String(slip.employee_id)); setPeriod(nextPeriod);
    setEmployeeDetails(slip.employee_details || blankDetails(nextPeriod)); setEarnings(rowsFromSlip(slip, "earnings")); setDeductions(rowsFromSlip(slip, "deductions")); setLwpDays(String(slip.lwp_days || 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const startEdit = (slip: Slip) => { startReview(slip); setReviewSlipId(null); setEditingSlipId(slip.id); };
  if (!permissionsLoading && isSalarySlipsRoute && !canSalarySlips) {
    return <AppShell requiredPermission="employee_documents.letters.view" alternativePermissions={["employee_documents.salary_slips.view", "employee_documents.letter_templates.view"]}><div className="mx-auto max-w-6xl space-y-6">
      <div><h1 className="text-xl font-semibold text-ink-900">Salary Slips</h1><p className="text-sm text-ink-500">Access is restricted. You do not have permission to view this section.</p></div>
      <section className="flex min-h-[420px] flex-col items-center justify-center px-4 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600"><LockKeyhole size={30} strokeWidth={2.25} /></div>
        <h2 className="text-lg font-semibold text-ink-900">Access Restricted</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-500">You do not have permission to view salary slips.</p>
        <p className="mt-1 max-w-sm text-sm text-ink-500">Please contact your administrator if you believe this is a mistake.</p>
        <button onClick={() => router.back()} className="mt-6 rounded-md border border-brand-500 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50">Go back</button>
      </section>
    </div></AppShell>;
  }

  return <AppShell requiredPermission="employee_documents.letters.view" alternativePermissions={["employee_documents.salary_slips.view", "employee_documents.letter_templates.view"]}><div className="mx-auto max-w-6xl space-y-6">
    <div><h1 className="text-xl font-semibold text-ink-900">Employee Documents</h1><p className="text-sm text-ink-500">Create and manage employee documents</p></div>
    {permissionsLoading ? <p className="text-sm text-ink-500">Loading permissions…</p> : visibleTabs.length === 0 ? <div className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-sm text-ink-500">You do not have access to any Employee Documents section.</div> : <>
    <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-1">{visibleTabs.map(item => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === item ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"}`}>{item}</button>)}</div>
    {activeTab === "Letters" ? (
      <LettersGenerator />
    ) : activeTab === "Letter Templates" ? (
      <LetterTemplatesViewer canCreate={canCreateTemplates} canEdit={canEditTemplates} canDelete={canDeleteTemplates} />
    ) : (<>
      {canManageSalarySlipForm && <>
      <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold">{reviewSlipId ? "Review Salary Slip Request" : editingSlipId ? "Edit Salary Slip" : "Generate Salary Slip"}</h2>
        <p className="mb-5 text-sm text-ink-500">{reviewSlipId ? "Review and correct employee details, earnings, LWP, and deductions before approval." : "Prepare the employee details and salary components for this month."}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Select Employee<select disabled={Boolean(reviewSlipId) || salaryHistoryLoading || !salaryHistoryLoaded} value={employeeId} onChange={event => { const id = event.target.value; setEmployeeId(id); setEditingSlipId(null); applyEmployeeDefaults(id); }} className="mt-1 block w-full rounded-lg border-ink-200 disabled:bg-ink-50"><option value="">{salaryHistoryLoading ? "Loading salary history..." : "Select employee"}</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
          <label className="text-sm font-medium">Month &amp; Year<input disabled={Boolean(reviewSlipId)} type="month" value={period} onChange={event => changePeriod(event.target.value)} className="mt-1 block w-full rounded-lg border-ink-200 disabled:bg-ink-50" /></label>
        </div>
        <h3 className="mt-6 font-semibold">Employee Details</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([["name", "Name"], ["designation", "Designation"], ["department", "Department"], ["phone_number", "Phone Number"], ["email", "Email"], ["joining_date", "Joining Date"], ["pan_number", "PAN No."], ["account_number", "Account No."], ["location", "Location"], ["payment_mode", "Payment Mode"]] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-ink-600">{label}<input value={employeeDetails[key]} onChange={event => setEmployeeDetails(current => ({ ...current, [key]: event.target.value }))} className="mt-1 block w-full rounded-md border-ink-200 text-sm" /></label>)}
          {([["days_in_month", "Days in Month"], ["days_worked", "Days Worked"], ["days_paid", "Days Paid"]] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-ink-600">{label}<input type="number" min="0" step="0.01" value={employeeDetails[key]} onChange={event => setEmployeeDetails(current => ({ ...current, [key]: Number(event.target.value) || 0 }))} className="mt-1 block w-full rounded-md border-ink-200 text-sm" /></label>)}
          <label className="text-xs font-medium text-ink-600">LWP Days<input type="number" min="0" step="0.01" value={lwpDays} onChange={event => setLwpDays(event.target.value)} className="mt-1 block w-full rounded-md border-ink-200 text-sm" /></label>
        </div>
        <h3 className="mt-7 font-semibold">Earnings</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-ink-200"><table className="min-w-[34rem] w-full text-sm"><thead className="bg-ink-50 text-left text-ink-600"><tr><th className="px-4 py-3">Earning</th><th className="w-44 px-4 py-3">Amount (?)</th><th className="w-12" /></tr></thead><tbody>{earnings.map((row, index) => <tr key={`earning-${index}`} className="border-t border-ink-100"><td className="p-2"><input aria-label="Earning name" value={row.name} readOnly={!row.custom} onChange={event => setEarnings(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, name: event.target.value } : item))} className="w-full rounded-md border-ink-200 read-only:bg-ink-50" /></td><td className="p-2"><input aria-label="Earning amount" type="number" min="0" step="0.01" value={row.amount} onChange={event => setEarnings(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item))} className="w-full rounded-md border-ink-200" /></td><td>{row.custom && <button type="button" aria-label="Remove earning row" onClick={() => setEarnings(current => current.filter((_, rowIndex) => rowIndex !== index))} className="p-2 text-red-500"><Trash2 size={16} /></button>}</td></tr>)}</tbody><tfoot className="border-t bg-ink-50"><tr><td className="px-4 py-3 font-semibold">TOTAL EARNINGS</td><td className="px-4 py-3 font-semibold text-emerald-700">{formatMoney(totalEarnings)}</td><td /></tr></tfoot></table></div>
        <button type="button" onClick={() => setEarnings(current => [...current, { name: "", amount: "0", custom: true }])} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-700"><Plus size={16} /> Add Earnings Row</button>
        <h3 className="mt-7 font-semibold">Deductions</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-ink-200"><table className="min-w-[34rem] w-full text-sm"><thead className="bg-ink-50 text-left text-ink-600"><tr><th className="px-4 py-3">Deduction</th><th className="w-44 px-4 py-3">Amount (?)</th><th className="w-12" /></tr></thead><tbody><tr className="border-t border-ink-100 bg-ink-50"><td className="p-3">LOP Deduction</td><td className="p-3 text-right">{formatMoney(lopDeduction)}</td><td /></tr>{deductions.map((row, index) => <tr key={`deduction-${index}`} className="border-t border-ink-100"><td className="p-2"><input aria-label="Deduction name" value={row.name} readOnly={!row.custom} onChange={event => setDeductions(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, name: event.target.value } : item))} className="w-full rounded-md border-ink-200 read-only:bg-ink-50" /></td><td className="p-2"><input aria-label="Deduction amount" type="number" min="0" step="0.01" value={row.amount} onChange={event => setDeductions(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item))} className="w-full rounded-md border-ink-200" /></td><td>{row.custom && <button type="button" aria-label="Remove deduction row" onClick={() => setDeductions(current => current.filter((_, rowIndex) => rowIndex !== index))} className="p-2 text-red-500"><Trash2 size={16} /></button>}</td></tr>)}</tbody><tfoot className="border-t bg-ink-50"><tr><td className="px-4 py-3 font-semibold">TOTAL DEDUCTIONS</td><td className="px-4 py-3 text-right font-semibold text-red-700">{formatMoney(totalDeductions)}</td><td /></tr></tfoot></table></div>
        <button type="button" onClick={() => setDeductions(current => [...current, { name: "", amount: "0", custom: true }])} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-700"><Plus size={16} /> Add Deduction Row</button>
        <div className="mt-5 flex flex-wrap justify-end gap-x-8 gap-y-2 border-t border-ink-200 pt-4 text-sm"><span>Total Earnings: <strong>{formatMoney(totalEarnings)}</strong></span><span>Total Deductions: <strong>{formatMoney(totalDeductions)}</strong></span><span className="text-base">Net Pay: <strong className="text-emerald-700">{formatMoney(Math.max(0, netPay))}</strong></span></div>
        {netPay < 0 && <p className="mt-2 text-right text-sm text-red-600">Deductions cannot exceed total earnings.</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">{(editingSlipId || reviewSlipId) && <button onClick={resetForm} className="rounded-lg border border-ink-300 px-5 py-2.5 text-sm font-medium">Cancel</button>}{reviewSlipId ? <button disabled={saving || !canSendSalarySlips || !canEditSalarySlips || netPay < 0} onClick={() => void approveRequest()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Send size={16} /> Approve &amp; Send</button> : <>{(editingSlipId ? canEditSalarySlips : canCreateSalarySlips) && <button disabled={saving || netPay < 0} onClick={() => save(false)} className="rounded-lg border border-ink-300 px-5 py-2.5 text-sm font-medium">{editingSlipId ? "Update" : "Save"}</button>}{canSendSalarySlips && (editingSlipId ? canEditSalarySlips : canCreateSalarySlips) && <button disabled={saving || netPay < 0} onClick={() => save(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Send size={16} /> {editingSlipId ? "Update & Send" : "Save & Send"}</button>}</>}</div>
      </section>
      </>}
      <section className="rounded-xl border border-ink-200 bg-white shadow-card"><div className="border-b border-ink-200 px-5 py-4"><h2 className="font-semibold">Salary Slip History</h2><p className="mt-1 text-sm text-ink-500">Pending requests are available to review below.</p></div><div className="border-b border-ink-200 px-5 py-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="w-full xl:max-w-md">      <EmployeeMultiSelect employees={employees.map((employee) => ({ id: employee.id, name: employee.name }))} value={selectedEmployeeIds} onChange={setSelectedEmployeeIds} allLabel="All Employees" className="w-full" /><TeamMultiSelect value={selectedTeamIds} onChange={(ids, members) => { setSelectedTeamIds(ids); setTeamEmployeeIds(members); }} className="w-full" /></div><div className="w-full xl:max-w-xs"><MonthSelector year={selectedYear} month={selectedMonth} onChange={(year, month) => { setSelectedYear(year); setSelectedMonth(month); }} /></div></div></div><div className="overflow-x-auto"><table className="min-w-[42rem] w-full text-sm"><thead className="bg-ink-50 text-left text-ink-600"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Month</th><th className="px-5 py-3">Salary</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody>{filteredSlips.length ? filteredSlips.map(slip => <tr key={slip.id} className={`border-t border-ink-100 ${slip.status === "Pending Review" ? "bg-amber-50/60" : ""}`}><td className="px-5 py-3 font-medium">{slip.employee_name}</td><td className="px-5 py-3">{new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</td><td className="px-5 py-3">{formatMoney(slip.total_amount)}</td><td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-xs ${slip.status === "Pending Review" ? "bg-amber-100 text-amber-800" : slip.status === "Sent" ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-600"}`}>{slip.status}</span></td><td className="px-5 py-3"><div className="flex gap-2">{slip.status === "Pending Review" && canEditSalarySlips && canSendSalarySlips ? <button onClick={() => startReview(slip)} className="inline-flex items-center gap-1 font-medium text-brand-700"><Pencil size={14} /> Review</button> : canEditSalarySlips && <button onClick={() => { startEdit(slip); }} className="inline-flex items-center gap-1 text-brand-700"><Pencil size={14} /> Edit</button>}{canDeleteSalarySlips && <button onClick={async () => { if (!window.confirm("Delete this salary slip?")) return; try { await api.delete(`/employee-documents/salary-slips/${slip.id}`); await load(); toast.success("Salary slip deleted"); } catch (error) { toast.error(getErrorMessage(error)); } }} className="inline-flex items-center gap-1 text-red-600"><Trash2 size={14} /> Delete</button>}</div></td></tr>) : <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">No salary slips match the current employee and month filters.</td></tr>}</tbody></table></div></section>
    </>)}</>}
  </div></AppShell>;
}
