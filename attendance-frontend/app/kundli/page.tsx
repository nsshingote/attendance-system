"use client";

import { useEffect, useState } from "react";
import { Pencil, Save, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";

type Employee = { id: number; name: string; role: string; designation: string };
type Note = { id: number; positive_note?: string; negative_note?: string; created_at: string };

export default function KundliPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/users/")
      .then(({ data }) => {
        const list = data.filter((item: Employee) => item.role === "user");
        setEmployees(list);
        if (list[0]) setEmployeeId(String(list[0].id));
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    api.get(`/employee-documents/kundli/${employeeId}`)
      .then(({ data }) => setNotes(data))
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [employeeId]);

  const employee = employees.find((item) => String(item.id) === employeeId);

  const save = async () => {
    if (!positive.trim() && !negative.trim()) return toast.error("Write a positive or negative note");
    setSaving(true);
    try {
      const payload = { employee_id: Number(employeeId), positive_note: positive, negative_note: negative };
      const { data } = editingId ? await api.put(`/employee-documents/kundli/${editingId}`, payload) : await api.post("/employee-documents/kundli", payload);
      setNotes(editingId ? notes.map((note) => (note.id === editingId ? data : note)) : [data, ...notes]);
      setPositive("");
      setNegative("");
      setEditingId(null);
      toast.success("Kundli note saved");
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Kundli</h1>
          <p className="text-sm text-ink-500">Private positive and negative notes about employees</p>
        </div>

        <label className="block max-w-sm text-sm font-medium">
          Select Employee
          <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setPositive(""); setNegative(""); }} className="mt-1 block w-full rounded-lg border-ink-200">
            <option value="">Select employee</option>
            {employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        {employee && (
          <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
            <div className="mb-5">
              <h2 className="font-semibold">{employee.name}</h2>
              <p className="text-sm text-ink-500">{employee.designation}</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
              <div className="overflow-hidden rounded-lg border border-ink-200">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-ink-600">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Positive Note</th>
                      <th className="px-4 py-3">Negative Note</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.length ? notes.map((note) => (
                      <tr key={note.id} className="border-t border-ink-100 align-top">
                        <td className="whitespace-nowrap px-4 py-3">{new Date(note.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                        <td className="max-w-xs break-words px-4 py-3 text-ink-700">{note.positive_note || "—"}</td>
                        <td className="max-w-xs break-words px-4 py-3 text-ink-700">{note.negative_note || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => { setEditingId(note.id); setPositive(note.positive_note || ""); setNegative(note.negative_note || ""); }} className="inline-flex items-center gap-1 text-brand-700"><Pencil size={14} /> Edit</button>
                            <button onClick={async () => { if (!window.confirm("Delete this Kundli note?")) return; try { await api.delete(`/employee-documents/kundli/${note.id}`); setNotes(notes.filter((item) => item.id !== note.id)); toast.success("Kundli note deleted"); } catch (e) { toast.error(getErrorMessage(e)); } }} className="inline-flex items-center gap-1 text-red-600"><Trash2 size={14} /> Delete</button>
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-500">No notes saved for this employee.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-ink-200 p-4">
                <h3 className="font-semibold">Write Note</h3>
                <label className="mt-4 block text-sm font-medium text-emerald-700">
                  Positive Note
                  <textarea value={positive} onChange={(e) => setPositive(e.target.value)} maxLength={500} placeholder="Write message here..." className="mt-1 block min-h-28 w-full rounded-lg border-ink-200 text-ink-900" />
                </label>
                <label className="mt-4 block text-sm font-medium text-red-700">
                  Negative Note
                  <textarea value={negative} onChange={(e) => setNegative(e.target.value)} maxLength={500} placeholder="Write message here..." className="mt-1 block min-h-28 w-full rounded-lg border-ink-200 text-ink-900" />
                </label>
                <button onClick={save} disabled={saving} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Save size={16} /> Save Note</button>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
