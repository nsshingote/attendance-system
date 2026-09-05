"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import DynamicLetterPreview from "./DynamicLetterPreview";
import PaginatedTemplateEditor, { PaginatedTemplateEditorHandle } from "./PaginatedTemplateEditor";

type Template = { id: number; name: string; document_type: string; content: string };
type Placeholder = { key: string; label: string };
type Company = { company_name: string; company_address: string; logo_url?: string };
const blank = { name: "", document_type: "", content: "" };

export default function LetterTemplatesViewer() {
  const [templates, setTemplates] = useState<Template[]>([]); const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState<Template | typeof blank | null>(null); const [preview, setPreview] = useState<Template | null>(null);
  const contentInput = useRef<PaginatedTemplateEditorHandle | null>(null);
  const load = async () => { const [items, fields, settings] = await Promise.all([api.get<Template[]>("/employee-documents/letter-templates"), api.get<Placeholder[]>("/employee-documents/letter-templates/placeholders"), api.get<Company>("/settings/branding")]); setTemplates(items.data); setPlaceholders(fields.data); setCompany(settings.data); };
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(error => toast.error(getErrorMessage(error))); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const save = async () => { if (!editing) return; try { if ("id" in editing) await api.put(`/employee-documents/letter-templates/${editing.id}`, editing); else await api.post("/employee-documents/letter-templates", editing); setEditing(null); await load(); toast.success("Letter template saved"); } catch (error) { toast.error(getErrorMessage(error)); } };
  const append = (key: string) => {
    if (!editing) return;
    contentInput.current?.insertPlaceholder(`{{${key}}}`);
  };
  return <div className="space-y-6">
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Letter Templates</h2><p className="text-sm text-ink-500">Create the editable middle section of a company-branded letter.</p></div><button onClick={() => setEditing(blank)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"><Plus size={16}/> Create New Template</button></div><div className="mt-5 divide-y rounded-lg border">{templates.length ? templates.map(template => <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{template.name}</p><p className="text-xs text-ink-500">Type: {template.document_type}</p></div><div className="flex gap-2"><button onClick={() => setPreview(template)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><Eye size={14}/> Preview</button><button onClick={() => setEditing(template)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><Pencil size={14}/> Edit</button><button onClick={async () => { if (!window.confirm(`Delete ${template.name}?`)) return; try { await api.delete(`/employee-documents/letter-templates/${template.id}`); await load(); toast.success("Template deleted"); } catch (error) { toast.error(getErrorMessage(error)); } }} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600"><Trash2 size={14}/> Delete</button></div></div>) : <p className="p-6 text-sm text-ink-500">No templates are available yet. Create a new template.</p>}</div></section>
    {editing && <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"><div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><h3 className="font-semibold">{"id" in editing ? "Edit Template" : "Create New Template"}</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Template Name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 block w-full rounded-lg border-ink-200" /></label><label className="text-sm font-medium">Document Type<input value={editing.document_type} onChange={e => setEditing({ ...editing, document_type: e.target.value })} placeholder="experience_letter" className="mt-1 block w-full rounded-lg border-ink-200" /></label></div><div className="mt-4 block text-sm font-medium"><span>Letter Content</span><PaginatedTemplateEditor ref={contentInput} title={editing.name} value={editing.content} onChange={content => setEditing({ ...editing, content })} /></div><div className="mt-4 flex gap-3"><button onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Save Template</button><button onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm font-medium">Cancel</button></div></div><aside className="rounded-xl border border-ink-200 bg-white p-5 shadow-card"><h3 className="font-semibold">Available Placeholders</h3><p className="mt-1 text-xs text-ink-500">Place the cursor in the text, then click a placeholder to insert it there.</p><div className="mt-4 flex flex-wrap gap-2">{placeholders.map(field => <button key={field.key} data-template-placeholder title={field.label} onClick={() => append(field.key)} className="rounded border border-brand-200 bg-brand-50 px-2 py-1 text-xs text-brand-800">{`{{${field.key}}}`}</button>)}</div></aside></section>}
    {preview && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><div className="mx-auto my-8 max-w-4xl rounded-xl bg-ink-100 p-4 shadow-xl"><div className="mb-3 flex justify-end"><button onClick={() => setPreview(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium">Close</button></div><DynamicLetterPreview title={preview.name} content={preview.content} templateContent={preview.content} companyName={company?.company_name} companyAddress={company?.company_address} logoUrl={company?.logo_url}/></div></div>}
  </div>;
}
