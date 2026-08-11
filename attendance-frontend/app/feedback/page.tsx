"use client";

import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { BellRing, ChevronLeft, ChevronRight, CircleUserRound, MessageSquareMore, Plus, SlidersHorizontal, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import Modal from "@/components/Common/Modal";
import EmployeeMultiSelect, { EmployeeOption } from "@/components/Common/EmployeeMultiSelect";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin, isSuperAdmin } from "@/lib/auth";

type Feedback = { id: number; employee_name: string | null; description: string; feedback_type: "positive" | "negative"; is_anonymous: boolean; created_at: string };
type FeedbackResponse = { items: Feedback[]; total: number; stats: { total: number; positive: number; negative: number; anonymous: number } };
type FeedbackType = "positive" | "negative";

const PAGE_SIZE = 5;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
}

export default function FeedbackPage() {
  const session = getSession();
  const admin = isAdmin(session?.role);
  const superAdmin = isSuperAdmin(session?.role);
  const [type, setType] = useState<FeedbackType | null>(null);
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [positive, setPositive] = useState<Feedback[]>([]);
  const [negative, setNegative] = useState<Feedback[]>([]);
  const [positiveTotal, setPositiveTotal] = useState(0);
  const [negativeTotal, setNegativeTotal] = useState(0);
  const [positivePage, setPositivePage] = useState(1);
  const [negativePage, setNegativePage] = useState(1);
  const [stats, setStats] = useState({ total: 0, positive: 0, negative: 0, anonymous: 0 });
  const [visibility, setVisibility] = useState("");
  const [month, setMonth] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const query = (feedbackType: FeedbackType, page: number) => ({ feedback_type: feedbackType, visibility: visibility || undefined, year: month ? Number(month.slice(0, 4)) : undefined, month: month ? Number(month.slice(5, 7)) : undefined, start_date: startDate || undefined, end_date: endDate ? `${endDate}T23:59:59` : undefined, employee_ids: selectedEmployeeIds.length ? selectedEmployeeIds : undefined, sort, page, page_size: PAGE_SIZE });
  const load = async () => {
    if (!admin) return;
    try {
      const [positiveResponse, negativeResponse] = await Promise.all([
        api.get<FeedbackResponse>("/feedback/", { params: query("positive", positivePage), paramsSerializer: { indexes: null } }),
        api.get<FeedbackResponse>("/feedback/", { params: query("negative", negativePage), paramsSerializer: { indexes: null } }),
      ]);
      setPositive(positiveResponse.data.items); setPositiveTotal(positiveResponse.data.total);
      setNegative(negativeResponse.data.items); setNegativeTotal(negativeResponse.data.total);
      setStats(positiveResponse.data.stats);
    } catch (error) { toast.error(getErrorMessage(error)); }
  };
  useEffect(() => { load(); }, [admin, visibility, month, startDate, endDate, selectedEmployeeIds, sort, positivePage, negativePage]);
  useEffect(() => { if (admin) api.get<EmployeeOption[]>("/users/").then(({ data }) => setEmployees(data)).catch(() => {}); }, [admin]);

  const resetPages = () => { setPositivePage(1); setNegativePage(1); };
  const submitTouchHandled = useRef(false);
  const submit = async () => {
    if (!type || !description.trim()) { toast.error("Description is required"); return; }
    if (!window.confirm("Are you sure you want to submit?")) return;
    try { await api.post("/feedback/", { feedback_type: type, description, is_anonymous: anonymous }); toast.success("Feedback submitted"); setDescription(""); setAnonymous(false); setType(null); }
    catch (error) { toast.error(getErrorMessage(error)); }
  };
  const handleSubmitButton = async (event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => {
    if (event.type === "touchend") {
      event.preventDefault();
      submitTouchHandled.current = true;
    } else if (event.type === "click" && submitTouchHandled.current) {
      submitTouchHandled.current = false;
      return;
    }
    await submit();
  };
  const remove = async (id: number) => {
    if (!window.confirm("Delete this feedback permanently?")) return;
    try { await api.delete(`/feedback/${id}`); toast.success("Feedback deleted"); load(); } catch (error) { toast.error(getErrorMessage(error)); }
  };

  const cards = [
    ["Total Feedback", stats.total, MessageSquareMore, "bg-brand-50 text-brand-600"],
    ["Positive Feedback", stats.positive, ThumbsUp, "bg-green-50 text-green-600"],
    ["Negative Feedback", stats.negative, ThumbsDown, "bg-red-50 text-red-600"],
    ["Known Feedback", stats.total - stats.anonymous, CircleUserRound, "bg-violet-50 text-violet-600"],
    ["Anonymous Feedback", stats.anonymous, BellRing, "bg-amber-50 text-amber-600"],
  ] as const;

  const table = (feedbackType: FeedbackType, rows: Feedback[], total: number, page: number, setPage: (value: number) => void) => {
    const positiveType = feedbackType === "positive";
    return (
      <section className={`overflow-hidden rounded-xl border ${positiveType ? "border-green-200" : "border-red-200"} bg-white shadow-card`}>
        <header className={`flex items-center justify-between border-b px-3 py-3 sm:px-4 ${positiveType ? "border-green-200 bg-green-50/70 text-green-700" : "border-red-200 bg-red-50/70 text-red-700"}`}>
          <div className="flex items-center gap-2 font-semibold">
            {positiveType ? <ThumbsUp size={19} /> : <ThumbsDown size={19} />}
            {positiveType ? "Positive Feedback" : "Negative Feedback"}
          </div>
          <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${positiveType ? "bg-green-100" : "bg-red-100"}`}>{total}</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full w-full table-fixed text-left text-xs sm:text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[62%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500 sm:text-xs">
              <tr>
                <th className="px-3 py-3 font-medium sm:px-4 sm:py-3">By</th>
                <th className="px-3 py-3 font-medium sm:px-4 sm:py-3">Feedback</th>
                <th className="px-3 py-3 font-medium sm:px-4 sm:py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((item) => (
                <tr key={item.id} className="align-top hover:bg-ink-50/60">
                  <td className="px-3 py-3 font-medium text-ink-900 sm:px-4 sm:py-3">
                    {item.is_anonymous ? "Anonymous" : item.employee_name}
                  </td>
                  <td className="max-w-[16rem] min-w-0 wrap-break-word whitespace-normal px-3 py-3 text-ink-700 sm:px-4 sm:py-3">{item.description}</td>
                  <td className="px-3 py-3 text-[11px] leading-5 text-ink-600 sm:px-4 sm:py-3 sm:text-xs">
                    {dateTime(item.created_at)}
                    {superAdmin && (
                      <button onClick={() => remove(item.id)} className="mt-1 flex items-center gap-1 text-red-600">
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-ink-500">
                    No feedback found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-ink-500 sm:px-4">
          <span>
            Showing {(total ? (page - 1) * PAGE_SIZE + 1 : 0)} to {Math.min(page * PAGE_SIZE, total)} of {total} entries
          </span>
          <div className="flex gap-1">
            <button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded border border-ink-200 p-1.5 disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <span className="rounded bg-brand-500 px-3 py-1.5 text-white">{page}</span>
            <button aria-label="Next page" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)} className="rounded border border-ink-200 p-1.5 disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </section>
    );
  };

  return <AppShell allowedRoles={admin ? ["admin", "superadmin"] : ["user"]}><div className="space-y-5"><div><h1 className="text-2xl font-semibold text-ink-900">Feedback</h1><p className="mt-1 text-sm text-ink-500">{admin ? "Review employee feedback" : "Share feedback with your organization"}</p></div>
    {admin ? <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{cards.map(([label, value, Icon, color]) => <div key={label} className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white p-2 shadow-card sm:gap-4 sm:p-4"><span className={`rounded-full p-2 sm:p-3 ${color}`}><Icon size={16} className="sm:hidden" /><Icon size={23} className="hidden sm:block" /></span><div><p className="text-[11px] text-ink-600 sm:text-sm">{label}</p><p className="mt-0.5 text-base font-semibold text-ink-900 sm:mt-1 sm:text-2xl">{value}</p></div></div>)}</div>
      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card"><div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4"><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm">Select Employees<span className="mt-2 block"><EmployeeMultiSelect employees={employees} value={selectedEmployeeIds} onChange={(ids) => { setSelectedEmployeeIds(ids); resetPages(); }} /></span></label><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm"><span className="mb-2 flex items-center gap-2"><SlidersHorizontal size={16} />Sort By</span><select value={sort} onChange={(e) => { setSort(e.target.value as "newest" | "oldest"); resetPages(); }} className="w-full rounded-lg border border-ink-200 px-2 py-2 text-[11px] font-normal sm:px-3 sm:text-sm"><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select></label><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm">Feedback Type<select value={visibility} onChange={(e) => { setVisibility(e.target.value); resetPages(); }} className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-2 text-[11px] font-normal sm:px-3 sm:text-sm"><option value="">All Feedback</option><option value="anonymous">Anonymous</option><option value="known">Known</option></select></label></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4"><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm">From<input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); resetPages(); }} className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-2 text-[11px] font-normal sm:px-3 sm:text-sm" /></label><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm">To<input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); resetPages(); }} className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-2 text-[11px] font-normal sm:px-3 sm:text-sm" /></label><label className="min-w-0 text-[11px] font-medium text-ink-700 sm:text-sm">Month<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); resetPages(); }} className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-2 text-[11px] font-normal sm:px-3 sm:text-sm" /></label></div></div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">{table("positive", positive, positiveTotal, positivePage, setPositivePage)}{table("negative", negative, negativeTotal, negativePage, setNegativePage)}</div><p className="flex items-center justify-center gap-2 text-sm text-ink-500"><BellRing size={16} />Anonymous feedback does not reveal the identity of the sender.</p></> : <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setType("positive")} className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer" style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}><Plus size={18} />Positive Feedback</button><button type="button" onClick={() => setType("negative")} className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 cursor-pointer" style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}><Plus size={18} />Negative Feedback</button></div>}
    </div><Modal isOpen={!!type} onClose={() => setType(null)} title={`${type === "positive" ? "Positive" : "Negative"} Feedback`}><div className="space-y-4"><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your feedback" rows={5} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" /><div><p className="mb-2 text-sm font-medium">Send as</p><label className="mr-4 text-sm"><input type="radio" checked={anonymous} onChange={() => setAnonymous(true)} /> Anonymous</label><label className="text-sm"><input type="radio" checked={!anonymous} onChange={() => setAnonymous(false)} /> Known</label></div><button type="button" onTouchEnd={handleSubmitButton} onClick={handleSubmitButton} className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white touch-action-manipulation ${type === "positive" ? "bg-green-600" : "bg-red-600"}`}>Submit Feedback</button></div></Modal></AppShell>;
}