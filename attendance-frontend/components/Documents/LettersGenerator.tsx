"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FilePlus2, Send } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import DynamicLetterPreview from "./DynamicLetterPreview";
import { downloadDynamicLetterPdf } from "@/lib/dynamicLetterPdf";

type Employee = { id: number; name: string; designation: string; department: string; email?: string; mobile: string; place_of_posting?: string | null; date_of_joining?: string | null; address_line_1?: string | null; address_line_2?: string | null; city?: string | null; state?: string | null; pincode?: string | null; country?: string | null; emergency_contact_name?: string | null; emergency_contact_relationship?: string | null; emergency_contact_phone?: string | null; role: string };
type Template = { id: number; name: string; document_type: string; content: string };
type Company = { company_name: string; company_address: string; logo_url?: string };
const dateValue = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB") : "";
const replacePlaceholders = (content: string, values: Record<string, string>) => content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => values[key] ?? match);

export default function LettersGenerator() {
  const [employees, setEmployees] = useState<Employee[]>([]); const [templates, setTemplates] = useState<Template[]>([]); const [company, setCompany] = useState<Company | null>(null);
  const [employeeId, setEmployeeId] = useState(""); const [templateId, setTemplateId] = useState(""); const [saving, setSaving] = useState(false);
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
  const resolved = useMemo(() => { if (!employee || !template) return ""; const values: Record<string, string> = { employee_id: String(employee.id), employee_name: employee.name || "", designation: employee.designation || "", department: employee.department || "", email: employee.email || "", mobile: employee.mobile || "", phone: employee.mobile || "", place_of_posting: employee.place_of_posting || "", date_of_joining: dateValue(employee.date_of_joining), employee_address_line_1: employee.address_line_1 || "", employee_address_line_2: employee.address_line_2 || "", employee_city: employee.city || "", employee_state: employee.state || "", employee_pincode: employee.pincode || "", employee_country: employee.country || "", emergency_contact_name: employee.emergency_contact_name || "", emergency_contact_relationship: employee.emergency_contact_relationship || "", emergency_contact_phone: employee.emergency_contact_phone || "", company_name: company?.company_name || "", company_address: company?.company_address || "", letter_date: new Date().toLocaleDateString("en-GB") }; return replacePlaceholders(template.content, values); }, [employee, template, company]);
  const save = async (send: boolean) => { if (!employee || !template) return toast.error("Select a template and employee"); setSaving(true); try { await api.post("/employee-documents/letters/generate", { template_id: template.id, employee_id: employee.id, send }); toast.success(send ? "Letter sent to employee documents" : "Letter draft generated"); } catch (error) { toast.error(getErrorMessage(error)); } finally { setSaving(false); } };
  return <div className="space-y-6"><section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Generate Letter</h2><p className="text-sm text-ink-500">Select a database template and employee, then preview, download, or send.</p></div><FilePlus2 className="text-brand-600"/></div><label className="mt-5 block max-w-md text-sm font-medium">Select Template<select value={templateId} onChange={e => { setTemplateId(e.target.value); setEmployeeId(""); }} className="mt-1 block w-full rounded-lg border-ink-200"><option value="">Select template</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>{template && <><section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><label className="block max-w-md text-sm font-medium">Select Employee<select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="mt-1 block w-full rounded-lg border-ink-200"><option value="">Select employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>{employee && <div className="rounded-xl border border-ink-200 bg-ink-100 p-3 sm:p-6"><div className="mb-3 flex flex-wrap justify-between gap-2"><p className="text-xs font-medium text-ink-500">PREVIEW</p><div className="flex gap-2"><button onClick={() => downloadDynamicLetterPdf(template.name, resolved, employee.name)} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"><Download size={14}/> Download PDF</button><button onClick={() => save(false)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm"><Eye size={14}/> Generate Draft</button><button onClick={() => save(true)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white"><Send size={14}/> Send</button></div></div><div className="overflow-auto"><DynamicLetterPreview title={template.name} content={resolved} /></div></div>}</>}</div>;
}
