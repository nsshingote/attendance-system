"use client";

/**
 * app/corrections/page.tsx
 * Employee: view own correction requests + submit new ones.
 * Admin/SuperAdmin: view and decide on all pending requests.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plus, RefreshCw } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { isAdmin, getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import CorrectionForm from "@/components/Corrections/Correctionform";
import CorrectionTable, { CorrectionRow } from "@/components/Corrections/CorrectionTable";
import EmployeeMultiSelect, { EmployeeOption } from "@/components/Common/EmployeeMultiSelect";
import { hasPermission, usePermissions } from "@/lib/permissions";

export function CorrectionsContent() {
  const session = getSession();
  const admin = isAdmin(session?.role);
  const { permissions } = usePermissions();
  const teamView = session?.role === "team_leader" && hasPermission(permissions, "corrections.team_view");
  const canDecide = session?.role === "team_leader"
    ? hasPermission(permissions, "corrections.approve")
    : admin;

  const [mine, setMine] = useState<CorrectionRow[]>([]);
  const [all, setAll] = useState<CorrectionRow[]>([]);
  const [tab, setTab] = useState<"mine" | "all">(admin || teamView ? "all" : "mine");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (admin || teamView) {
      api.get<EmployeeOption[]>("/users/").then(({ data }) => setEmployees(data)).catch(() => toast.error("Failed to load employees"));
    }
  }, [admin, teamView]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<any>[] = [api.get<CorrectionRow[]>("/corrections/me")];
      if (admin || teamView) requests.push(api.get<CorrectionRow[]>("/corrections/"));
      if (teamView) {
        requests.push(...selectedEmployeeIds.map((userId) => api.get<CorrectionRow[]>(`/corrections/user/${userId}`)));
      }

      const results = await Promise.all(requests);
      setMine(results[0].data);
      if (admin || teamView) setAll(results[1].data.filter((row: CorrectionRow) => selectedEmployeeIds.length === 0 || selectedEmployeeIds.includes(row.requested_by)));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [admin, teamView, selectedEmployeeIds]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refreshOnFocus = () => { fetchData(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
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
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Attendance Corrections</h1>
          <p className="text-sm text-ink-500">Request or review corrections to attendance records</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {(admin || teamView) && <EmployeeMultiSelect employees={employees} value={selectedEmployeeIds} onChange={setSelectedEmployeeIds} />}
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50"
            aria-label="Refresh correction requests"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={16} />
            Request Correction
          </button>
        </div>
      </div>

      {(admin || teamView) && (
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
          canDecide={canDecide && tab === "all"}
          onDecide={handleDecide}
        />
      )}

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="Request Attendance Correction">
        <CorrectionForm
          onSuccess={() => {
            setFormOpen(false);
            fetchData();
          }}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
    </div>
  );
}

export default function CorrectionsPage() {
  return (
    <AppShell>
      <CorrectionsContent />
    </AppShell>
  );
}
