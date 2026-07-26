"use client";

/**
 * app/corrections/page.tsx
 * Employee: view own correction requests + submit new ones.
 * Admin/SuperAdmin: view and decide on all pending requests.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<any>[] = [api.get<CorrectionRow[]>("/corrections/me")];
      if (admin) requests.push(api.get<CorrectionRow[]>("/corrections/"));

      const results = await Promise.all(requests);
      setMine(results[0].data);
      if (admin) setAll(results[1].data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Attendance Corrections</h1>
            <p className="text-sm text-ink-500">Request or review corrections to attendance records</p>
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={16} />
            Request Correction
          </button>
        </div>

        {admin && (
          <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
            <button
              onClick={() => setTab("all")}
              className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "all" ? "bg-brand-500 text-white" : "text-ink-600"}`}
            >
              All Requests
            </button>
            <button
              onClick={() => setTab("mine")}
              className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "mine" ? "bg-brand-500 text-white" : "text-ink-600"}`}
            >
              My Requests
            </button>
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