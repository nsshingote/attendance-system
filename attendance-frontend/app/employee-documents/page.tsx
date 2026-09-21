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
type Slip = { id: number; employee_id: number; employee_name: string; month: number; year: number; total_amount: number; status: string; particulars: string; created_at?: string; sent_at?: string | null };
type Row = { name: string; amount: string; removable?: boolean };
const baseRows: Row[] = ["Salary", "Incentive", "Overtime", "Extra Working Day", "Other"].map(name => ({ name, amount: "" }));
const blankRows = () => baseRows.map(row => ({ ...row }));
const rowsFromSlip = (slip?: Slip) => {
  if (!slip) return blankRows();
  try {
    return (JSON.parse(slip.particulars) as Array<{ name: string; amount: number }>).map(row => ({ name: row.name, amount: String(row.amount), removable: true }));
  } catch {
    return blankRows();
  }
};
const latestSlipFor = (slips: Slip[], employeeId: string) => slips
  .filter(slip => slip.employee_id === Number(employeeId))
  .sort((first, second) => new Date(second.created_at || second.sent_at || 0).getTime() - new Date(first.created_at || first.sent_at || 0).getTime())[0];
const formatMoney = (value: number | string) => {
  const normalized = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(normalized)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(normalized);
};

export default function EmployeeDocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const [tab, setTab] = useState("Salary Slips");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>(blankRows);
  const [saving, setSaving] = useState(false);
  const [editingSlipId, setEditingSlipId] = useState<number | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [teamEmployeeIds, setTeamEmployeeIds] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const canLetters = hasPermission(permissions, "employee_documents.letters.view");
  const canSalarySlips = hasPermission(permissions, "employee_documents.salary_slips.view");
  const canTemplates = hasPermission(permissions, "employee_documents.letter_templates.view");
  const isSalarySlipsRoute = pathname === "/employee-documents/salary-slips";
  const visibleTabs = [canLetters && "Letters", canSalarySlips && "Salary Slips", canTemplates && "Letter Templates"].filter(Boolean) as string[];
  const load = async () => {
    if (!canSalarySlips) return;
    try {
      const [users, history] = await Promise.all([api.get("/users/employee-selector"), api.get("/employee-documents/salary-slips")]);
      setEmployees(users.data); setSlips(history.data);
    } catch (error) { toast.error(getErrorMessage(error)); }
  };
  useEffect(() => {
    if (!canSalarySlips) return;
    api.get<Employee[]>("/users/employee-selector")
      .then(({ data }) => setEmployees(data))
      .catch(error => toast.error(getErrorMessage(error)));
    api.get<Slip[]>("/employee-documents/salary-slips")
      .then(({ data }) => setSlips(data))
      .catch(error => toast.error(getErrorMessage(error)));
  }, [canSalarySlips]);
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [rows]);
  const filteredSlips = useMemo(() => {
    return slips.filter((slip) => {
      const matchesEmployee = selectedEmployeeIds.length === 0 && teamEmployeeIds.length === 0 || selectedEmployeeIds.includes(slip.employee_id) || teamEmployeeIds.includes(slip.employee_id);
      const matchesMonth = slip.year === selectedYear && slip.month === selectedMonth;
      return matchesEmployee && matchesMonth;
    });
  }, [slips, selectedEmployeeIds, teamEmployeeIds, selectedYear, selectedMonth]);
  const updateRow = (index: number, key: keyof Row, value: string) => setRows(rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const save = async (send: boolean) => {
    if (!employeeId) return toast.error("Select an employee");
    setSaving(true);
    try {
      const [year, month] = period.split("-").map(Number);
      await api[editingSlipId ? "put" : "post"](editingSlipId ? `/employee-documents/salary-slips/${editingSlipId}` : "/employee-documents/salary-slips", { employee_id: Number(employeeId), month, year, send,
        particulars: rows.filter(row => row.name.trim()).map(row => ({ name: row.name, amount: Number(row.amount) || 0 })) });
      toast.success(send ? "Salary slip saved and sent" : "Salary slip saved"); setRows(blankRows()); setEmployeeId(""); setEditingSlipId(null); await load();
    } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); }
  };
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
      <LetterTemplatesViewer />
    ) : (<>
      <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6"><h2 className="text-lg font-semibold">Generate Salary Slip</h2><p className="mb-5 text-sm text-ink-500">Create and send salary slips to employees</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Select Employee<select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setEditingSlipId(null); setRows(rowsFromSlip(latestSlipFor(slips, e.target.value))); }} className="mt-1 block w-full rounded-lg border-ink-200"><option value="">Select employee</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label className="text-sm font-medium">Month &amp; Year<input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="mt-1 block w-full rounded-lg border-ink-200" /></label></div>
        <div className="mt-6 overflow-x-auto rounded-lg border border-ink-200"><table className="min-w-[34rem] w-full text-sm"><thead className="bg-ink-50 text-left text-ink-600"><tr><th className="px-4 py-3">Particulars</th><th className="w-44 px-4 py-3">Amount (₹)</th><th className="w-12" /></tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-ink-100"><td className="p-2"><input aria-label="Particular" value={row.name} onChange={e => updateRow(index, "name", e.target.value)} className="w-full rounded-md border-ink-200" /></td><td className="p-2"><input aria-label="Amount" inputMode="decimal" type="number" min="0" value={row.amount} onChange={e => updateRow(index, "amount", e.target.value)} className="number-input-no-spinner w-full rounded-md border-ink-200" /></td><td>{(row.removable || index >= 5) && <button onClick={() => setRows(rows.filter((_, i) => i !== index))} className="p-2 text-red-500"><Trash2 size={16} /></button>}</td></tr>)}</tbody><tfoot className="border-t bg-ink-50"><tr><td className="px-4 py-4 font-semibold">Total Amount</td><td className="px-4 py-4 font-semibold text-emerald-700">{formatMoney(total)}</td><td /></tr></tfoot></table></div>
        <button onClick={() => setRows([...rows, { name: "", amount: "", removable: true }])} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand-700"><Plus size={16} /> Add Another Row</button>
        <div className="mt-6 flex flex-wrap justify-end gap-3">{editingSlipId && <button onClick={() => { setEditingSlipId(null); setEmployeeId(""); setRows(blankRows()); }} className="rounded-lg border border-ink-300 px-5 py-2.5 text-sm font-medium">Cancel Edit</button>}<button disabled={saving} onClick={() => save(false)} className="rounded-lg border border-ink-300 px-5 py-2.5 text-sm font-medium">{editingSlipId ? "Update" : "Save"}</button><button disabled={saving} onClick={() => save(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Send size={16} /> {editingSlipId ? "Update & Send" : "Save & Send"}</button></div>
      </section>
      <section className="rounded-xl border border-ink-200 bg-white shadow-card"><div className="border-b border-ink-200 px-5 py-4"><h2 className="font-semibold">Salary Slip History</h2></div><div className="border-b border-ink-200 px-5 py-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="w-full xl:max-w-md">      <EmployeeMultiSelect employees={employees.map((employee) => ({ id: employee.id, name: employee.name }))} value={selectedEmployeeIds} onChange={setSelectedEmployeeIds} allLabel="All Employees" className="w-full" /><TeamMultiSelect value={selectedTeamIds} onChange={(ids, members) => { setSelectedTeamIds(ids); setTeamEmployeeIds(members); }} className="w-full" /></div><div className="w-full xl:max-w-xs"><MonthSelector year={selectedYear} month={selectedMonth} onChange={(year, month) => { setSelectedYear(year); setSelectedMonth(month); }} /></div></div></div><div className="overflow-x-auto"><table className="min-w-[42rem] w-full text-sm"><thead className="bg-ink-50 text-left text-ink-600"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Month</th><th className="px-5 py-3">Salary</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody>{filteredSlips.length ? filteredSlips.map(slip => <tr key={slip.id} className="border-t border-ink-100"><td className="px-5 py-3 font-medium">{slip.employee_name}</td><td className="px-5 py-3">{new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</td><td className="px-5 py-3">{formatMoney(slip.total_amount)}</td><td className="px-5 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{slip.status}</span></td><td className="px-5 py-3"><div className="flex gap-2"><button onClick={() => { setEditingSlipId(slip.id); setEmployeeId(String(slip.employee_id)); setPeriod(`${slip.year}-${String(slip.month).padStart(2, "0")}`); setRows(JSON.parse(slip.particulars).map((row: { name: string; amount: number }) => ({ name: row.name, amount: String(row.amount), removable: true }))); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex items-center gap-1 text-brand-700"><Pencil size={14} /> Edit</button><button onClick={async () => { if (!window.confirm("Delete this salary slip?")) return; try { await api.delete(`/employee-documents/salary-slips/${slip.id}`); await load(); toast.success("Salary slip deleted"); } catch (error) { toast.error(getErrorMessage(error)); } }} className="inline-flex items-center gap-1 text-red-600"><Trash2 size={14} /> Delete</button></div></td></tr>) : <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">No salary slips match the current employee and month filters.</td></tr>}</tbody></table></div></section>
    </>)}</>}
  </div></AppShell>;
}
