"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FilePlus2, Send } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import DynamicLetterPreview from "./DynamicLetterPreview";
import { downloadDynamicLetterPdf } from "@/lib/dynamicLetterPdf";

type Employee = { id: number; name: string; designation: string; department: string; email?: string; mobile: string; place_of_posting?: string | null; date_of_joining?: string | null; address_line_1?: string | null; address_line_2?: string | null; city?: string | null; state?: string | null; pincode?: string | null; country?: string | null; emergency_contact_name?: string | null; emergency_contact_relationship?: string | null; emergency_contact_phone?: string | null; role: string };
type Template = { id: number; name: string; document_type: string; content: string };
type Company = { company_name: string; company_address: string; logo_url?: string };
const dateValue = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB") : "";
const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*)\s*}}/g;
const normalizePlaceholderKey = (key: string) => key.trim().replace(/\s+/g, "_").toLowerCase();
const replacePlaceholders = (content: string, values: Record<string, string>) => content.replace(PLACEHOLDER_PATTERN, (match, key) => values[normalizePlaceholderKey(key)] ?? match);
const placeholderKeys = (content: string) => Array.from(new Set(Array.from(content.matchAll(PLACEHOLDER_PATTERN), (match) => normalizePlaceholderKey(match[1]))));
const placeholderLabel = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function LettersGenerator() {
  const [employees, setEmployees] = useState<Employee[]>([]); const [templates, setTemplates] = useState<Template[]>([]); const [company, setCompany] = useState<Company | null>(null);
  const [employeeId, setEmployeeId] = useState(""); const [templateId, setTemplateId] = useState(""); const [saving, setSaving] = useState(false); const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.all([api.get<Employee[]>("/users/"), api.get<Template[]>("/employee-documents/letter-templates"), api.get<Company>("/settings/branding")])
      .then(([users, letters, settings]) => {
        setEmployees(users.data.filter(user => user.role === "user"));
        setTemplates(letters.data);
        setCompany(settings.data);
      })
      .catch(error => {
        toast.error(getErrorMessage(error));
        // Still set defaults so the component doesn't break
        setCompany({ company_name: "", company_address: "" });
      });
  }, []);
  const employee = employees.find(item => String(item.id) === employeeId); const template = templates.find(item => String(item.id) === templateId);
  const employeeValues = useMemo<Record<string, string>>(() => { if (!employee) return {} as Record<string, string>; const joiningDate = dateValue(employee.date_of_joining); return { employee_id: String(employee.id), employee_name: employee.name || "", designation: employee.designation || "", department: employee.department || "", email: employee.email || "", mobile: employee.mobile || "", phone: employee.mobile || "", place_of_posting: employee.place_of_posting || "", date_of_joining: joiningDate, joining_date: joiningDate, employee_address_line_1: employee.address_line_1 || "", employee_address_line_2: employee.address_line_2 || "", employee_city: employee.city || "", employee_state: employee.state || "", employee_pincode: employee.pincode || "", employee_country: employee.country || "", emergency_contact_name: employee.emergency_contact_name || "", emergency_contact_relationship: employee.emergency_contact_relationship || "", emergency_contact_phone: employee.emergency_contact_phone || "", company_name: company?.company_name || "", company_address: company?.company_address || "", letter_date: new Date().toLocaleDateString("en-GB"), salary: "", working_hours: "9:30 AM to 6:30 PM", working_days: "6 days of the week", authorized_signatory: "Authorized Signatory", office_location: employee.place_of_posting || "", date_of_leaving: "", start_date: joiningDate }; }, [employee, company]);
  const resolvedValues = { ...employeeValues, ...placeholderValues };
  const resolved = template ? replacePlaceholders(template.content, resolvedValues) : "";
  const save = async (send: boolean) => { if (!employee || !template) return toast.error("Select a template and employee"); setSaving(true); try { await api.post("/employee-documents/letters/generate", { template_id: template.id, employee_id: employee.id, send, placeholder_values: resolvedValues }); toast.success(send ? "Letter sent to employee documents" : "Letter draft generated"); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); } };
  return <div className="space-y-6"><section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Generate Letter</h2><p className="mt-1 text-sm text-ink-500">Select a database template and employee, then preview, download, or send.</p></div><FilePlus2 className="text-brand-600"/></div><label className="mt-5 block max-w-md text-sm font-medium">Select Template<select value={templateId} onChange={e => { setTemplateId(e.target.value); setEmployeeId(""); setPlaceholderValues({}); }} className="mt-1 block w-full rounded-lg border-ink-200"><option value="">Select template</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>{template && <><section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><label className="block max-w-md text-sm font-medium">Select Employee<select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setPlaceholderValues({}); }} className="mt-1 block w-full rounded-lg border-ink-200"><option value="">Select employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>{employee && <div className="grid gap-6 lg:grid-cols-[minmax(0,20fr)_minmax(0,80fr)] lg:items-start"><section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card"><h3 className="font-semibold">Letter Details</h3><p className="mt-1 text-sm text-ink-500">Review and edit values before sending.</p><div className="mt-4 space-y-3">{placeholderKeys(template.content).map(key => <label key={key} className="block text-sm font-medium text-ink-700">{placeholderLabel(key)}<input value={placeholderValues[key] ?? employeeValues[key] ?? ""} onChange={e => setPlaceholderValues(current => ({ ...current, [key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" /></label>)}</div></section><div className="min-w-0 rounded-xl border border-ink-200 bg-ink-100 p-3 sm:p-6"><div className="mb-3 flex flex-wrap justify-between gap-2"><p className="text-xs font-medium text-ink-500">PREVIEW</p><div className="flex flex-wrap gap-2"><button onClick={() => void downloadDynamicLetterPdf(template.name, resolved, employee.name, previewRef.current)} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"><Download size={14}/> Download PDF</button><button onClick={() => save(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><Eye size={14}/> Generate Draft</button><button onClick={() => save(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white"><Send size={14}/> Send</button></div></div><div className="overflow-auto"><DynamicLetterPreview ref={previewRef} title={template.name} content={resolved} templateContent={template.content} /></div></div></div>}</>}</div>;
}
