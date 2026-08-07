"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Modal from "@/components/Common/Modal";
import Badge from "@/components/Common/Badge";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin, isSuperAdmin } from "@/lib/auth";

type Feedback = { id: number; employee_name: string | null; description: string; feedback_type: "positive" | "negative"; is_anonymous: boolean; created_at: string };
type FeedbackResponse = { items: Feedback[]; total: number; stats: { total: number; positive: number; negative: number; anonymous: number } };

export default function FeedbackPage() {
  const admin = isAdmin(getSession()?.role);
  const superAdmin = isSuperAdmin(getSession()?.role);
  const [type, setType] = useState<"positive" | "negative" | null>(null);
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [items, setItems] = useState<Feedback[]>([]);
  const [tab, setTab] = useState<"positive" | "negative">("positive");
  const [visibility, setVisibility] = useState("");
  const [month, setMonth] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, positive: 0, negative: 0, anonymous: 0 });

  const load = async () => {
    if (!admin) return;
    try { const { data } = await api.get<FeedbackResponse>("/feedback/", { params: { feedback_type: tab, visibility: visibility || undefined, year: month ? Number(month.slice(0, 4)) : undefined, month: month ? Number(month.slice(5, 7)) : undefined, start_date: startDate || undefined, end_date: endDate ? `${endDate}T23:59:59` : undefined, search: search || undefined, sort, page, page_size: 20 } }); setItems(data.items); setTotal(data.total); setStats(data.stats); }
    catch (error) { toast.error(getErrorMessage(error)); }
  };
  useEffect(() => { load(); }, [admin, tab, visibility, month, startDate, endDate, search, sort, page]);

  const submit = async () => {
    if (!type || !description.trim()) { toast.error("Description is required"); return; }
    if (!window.confirm("Are you sure you want to submit?")) return;
    try { await api.post("/feedback/", { feedback_type: type, description, is_anonymous: anonymous }); toast.success("Feedback submitted"); setDescription(""); setAnonymous(false); setType(null); }
    catch (error) { toast.error(getErrorMessage(error)); }
  };
  const remove = async (id: number) => { if (!window.confirm("Delete this feedback permanently?")) return; try { await api.delete(`/feedback/${id}`); toast.success("Feedback deleted"); load(); } catch (error) { toast.error(getErrorMessage(error)); } };

  return <AppShell allowedRoles={admin ? ["admin", "superadmin"] : ["user"]}>
    <div className="space-y-6"><div><h1 className="text-xl font-semibold text-ink-900">Feedback</h1><p className="mt-1 text-sm text-ink-500">{admin ? "Review employee feedback" : "Share feedback with your organization"}</p></div>
    {admin ? <><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Total Feedback",stats.total],["Positive",stats.positive],["Negative",stats.negative],["Anonymous",stats.anonymous]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-ink-200 bg-white p-3"><p className="text-xs text-ink-500">{label}</p><p className="text-xl font-semibold text-ink-900">{value}</p></div>)}</div><div className="flex flex-wrap gap-2"><button onClick={() => {setTab("positive");setPage(1);}} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "positive" ? "bg-green-600 text-white" : "bg-white text-ink-600 border border-ink-200"}`}>Positive Feedback</button><button onClick={() => {setTab("negative");setPage(1);}} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === "negative" ? "bg-red-600 text-white" : "bg-white text-ink-600 border border-ink-200"}`}>Negative Feedback</button></div><div className="flex flex-wrap gap-2 rounded-xl border border-ink-200 bg-white p-3"><input value={search} onChange={(e) => {setSearch(e.target.value);setPage(1);}} placeholder="Search name or feedback" className="rounded-lg border border-ink-200 px-3 py-2 text-sm"/><select value={sort} onChange={(e) => setSort(e.target.value as "newest"|"oldest")} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><select value={visibility} onChange={(e) => {setVisibility(e.target.value);setPage(1);}} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"><option value="">All Feedback</option><option value="anonymous">Anonymous</option><option value="known">Known</option></select><input type="month" value={month} onChange={(e) => {setMonth(e.target.value);setPage(1);}} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"/><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"/><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"/></div><div className="space-y-3">{items.map((item) => <article key={item.id} className="rounded-xl border border-ink-200 bg-white p-4 shadow-card"><div className="flex items-center justify-between gap-3"><span className="font-medium text-ink-900">{item.is_anonymous ? "Anonymous" : item.employee_name}</span><span className="flex items-center gap-2"><Badge status={item.feedback_type === "positive" ? "Approved" : "Rejected"}/>{superAdmin && <button onClick={() => remove(item.id)} className="text-xs font-medium text-red-600">Delete</button>}</span></div><p className="mt-2 text-sm text-ink-700">{item.description}</p><p className="mt-2 text-xs text-ink-500">{new Date(item.created_at).toLocaleString()}</p></article>)}{items.length === 0 && <p className="text-sm text-ink-500">No feedback found.</p>}</div><div className="flex items-center justify-between text-sm text-ink-600"><span>{total} matching feedback</span><div className="flex gap-2"><button disabled={page === 1} onClick={() => setPage(page-1)} className="rounded border px-3 py-1 disabled:opacity-50">Previous</button><button disabled={page * 20 >= total} onClick={() => setPage(page+1)} className="rounded border px-3 py-1 disabled:opacity-50">Next</button></div></div></> : <div className="flex flex-wrap gap-3"><button onClick={() => setType("positive")} className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white hover:bg-green-700"><Plus size={18}/>Positive Feedback</button><button onClick={() => setType("negative")} className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700"><Plus size={18}/>Negative Feedback</button></div>}</div>
    <Modal isOpen={!!type} onClose={() => setType(null)} title={`${type === "positive" ? "Positive" : "Negative"} Feedback`}><div className="space-y-4"><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your feedback" rows={5} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"/><div><p className="mb-2 text-sm font-medium">Send as</p><label className="mr-4 text-sm"><input type="radio" checked={anonymous} onChange={() => setAnonymous(true)} /> Anonymous</label><label className="text-sm"><input type="radio" checked={!anonymous} onChange={() => setAnonymous(false)} /> Known</label></div><button onClick={submit} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${type === "positive" ? "bg-green-600" : "bg-red-600"}`}>Submit Feedback</button></div></Modal>
  </AppShell>;
}
