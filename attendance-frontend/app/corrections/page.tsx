"use client";

/**
 * app/corrections/page.tsx
 * Employee: view own correction requests + submit new ones.
 * Admin/SuperAdmin: view and decide on all pending requests.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { isAdmin, getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import CorrectionForm from "@/components/Corrections/Correctionform";
import CorrectionTable, { CorrectionRow } from "@/components/Corrections/CorrectionTable";

export default function CorrectionsPage() {
  const session = getSession();
  const admin = isAdmin(session?.role);

  const [mine, setMine] = useState<CorrectionRow[]>([]);
  const [all, setAll] = useState<CorrectionRow[]>([]);
  const [tab, setTab] = useState<"mine" | "all">(admin ? "all" : "mine");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedDate ? { date_value: selectedDate } : {};
      const requests: Promise<any>[] = [api.get<CorrectionRow[]>("/corrections/me", { params })];
      if (admin) requests.push(api.get<CorrectionRow[]>("/corrections/", { params }));

      const results = await Promise.all(requests);
      setMine(results[0].data);
      if (admin) setAll(results[1].data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [admin, selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const clearDateFilter = () => {
    setSelectedDate("");
    setShowDatePicker(false);
  };

  const handleDecide = async (id: number, status: "Approved" | "Rejected") => {
    try {
      // FIXED: Added /decide to the URL
      await api.put(`/corrections/${id}/decide`, { status });
      toast.success(`Correction ${status.toLowerCase()}`);
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="rounded-[1rem] border border-ink-200 bg-white p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-900">Attendance Corrections</h1>
              <p className="mt-1 text-sm text-ink-500">Request or review corrections to attendance records</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <button onClick={() => setShowDatePicker(!showDatePicker)} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${selectedDate ? "border-brand-500 bg-brand-50 text-brand-600" : "border-ink-200 bg-white text-ink-600"}`}>
                  <CalendarIcon size={16} />
                  {selectedDate ? new Date(selectedDate).toLocaleDateString() : "Filter date"}
                  {selectedDate && <span onClick={(e) => { e.stopPropagation(); clearDateFilter(); }} className="ml-1 cursor-pointer text-ink-400 hover:text-ink-600">×</span>}
                </button>
                {showDatePicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 min-w-[240px] rounded-2xl border border-ink-200 bg-white p-3 shadow-lg">
                      <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setShowDatePicker(false); }} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => { setSelectedDate(new Date().toISOString().split("T")[0]); setShowDatePicker(false); }} className="flex-1 rounded-2xl bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">Today</button>
                        <button onClick={clearDateFilter} className="flex-1 rounded-2xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50">Clear</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setFormOpen(true)}
                className="flex items-center gap-2 rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                <Plus size={16} />
                Request Correction
              </button>
            </div>
          </div>
        </div>

        {admin && (
          <div className="rounded-[1rem] border border-ink-200 bg-white p-2 shadow-card">
            <div className="flex w-full flex-wrap gap-2 p-1">
              <button
                onClick={() => setTab("all")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium ${tab === "all" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"}`}
              >
                All Requests
              </button>
              <button
                onClick={() => setTab("mine")}
                className={`rounded-2xl px-4 py-2 text-sm font-medium ${tab === "mine" ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-50"}`}
              >
                My Requests
              </button>
            </div>
          </div>
        )}

        {selectedDate && (
          <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">Filtering by date:</span>
              <span className="rounded-full bg-white px-3 py-1 text-brand-700 shadow-sm">{new Date(selectedDate).toLocaleDateString()}</span>
              <button onClick={clearDateFilter} className="text-brand-700 underline">Clear</button>
            </div>
          </div>
        )}

        {loading ? (
          <Loading />
        ) : (
          <CorrectionTable
            corrections={tab === "all" ? all : mine}
            canDecide={admin && tab === "all"}
            onDecide={handleDecide}
          />
        )}
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="Request Attendance Correction">
        <CorrectionForm
          onSuccess={() => {
            setFormOpen(false);
            fetchData();
          }}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
    </AppShell>
  );
}
