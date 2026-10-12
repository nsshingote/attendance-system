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
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import CorrectionForm from "@/components/Corrections/Correctionform";
import CorrectionTable, { CorrectionRow } from "@/components/Corrections/CorrectionTable";
import EmployeeMultiSelect, { EmployeeOption } from "@/components/Common/EmployeeMultiSelect";
import { hasPermission, usePermissions } from "@/lib/permissions";
import TeamMultiSelect from "@/components/Common/TeamMultiSelect";

export function CorrectionsContent() {
  const session = getSession();
  const { permissions } = usePermissions();
  const admin = hasPermission(permissions, "corrections.all_view");
  const teamView = session?.role === "team_leader" &&
    hasPermission(permissions, "corrections.team_view");
  const canDecide = hasPermission(permissions, "corrections.approve");
  const canViewOwn = hasPermission(permissions, "corrections.view_own");
  const canViewAll = admin || teamView;
  const canReviewOnly = canDecide && !canViewAll;

  const [mine, setMine] = useState<CorrectionRow[]>([]);
  const [all, setAll] = useState<CorrectionRow[]>([]);
  const [tab, setTab] = useState<"mine" | "all">(
    canViewAll || canDecide ? "all" : "mine"
  );
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [teamEmployeeIds, setTeamEmployeeIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (canViewAll) {
      api.get<EmployeeOption[]>("/users/").then(({ data }) => setEmployees(data)).catch(() => toast.error("Failed to load employees"));
    }
  }, [canViewAll]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<{ data: CorrectionRow[] }>[] = [
        canViewOwn
          ? api.get<CorrectionRow[]>("/corrections/me")
          : Promise.resolve({ data: [] }),
      ];
      const reviewRequest = canViewAll
        ? api.get<CorrectionRow[]>("/corrections/")
        : canReviewOnly
          ? api.get<CorrectionRow[]>("/corrections/reviewable")
          : null;
      if (reviewRequest) requests.push(reviewRequest);
      if (teamView) {
        requests.push(...selectedEmployeeIds.map((userId) => api.get<CorrectionRow[]>(`/corrections/user/${userId}`)));
      }

      const results = await Promise.all(requests);
      setMine(results[0].data);
      if (reviewRequest && canViewAll) setAll(results[1].data.filter((row: CorrectionRow) => (selectedEmployeeIds.length === 0 && teamEmployeeIds.length === 0) || selectedEmployeeIds.includes(row.requested_by) || teamEmployeeIds.includes(row.requested_by)));
      else if (reviewRequest) setAll(results[1].data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [canReviewOnly, canViewAll, canViewOwn, teamView, selectedEmployeeIds, teamEmployeeIds]);

  useEffect(() => {
    const load = async () => { await fetchData(); };
    void load();
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

  const handleCancel = async (id: number) => {
    if (id === 149) {
      const correction = all.find((row) => row.id === 149);
      if (!correction) {
        toast.error("Correction 149 is not available in the current review list.");
        return;
      }
      if (!correction.old_check_in || correction.old_check_out !== null) {
        toast.error("Correction 149 does not contain the expected request-time values for this recovery.");
        return;
      }
      const expectedStatus = window.prompt(
        "Verify the CURRENT stored attendance status for user 23 on 11 Oct 2026 (Present, Late, Half Day, Absent, Holiday, WFH, On Leave, or Extra Working Day).",
      );
      if (!expectedStatus) return;
      if (!window.confirm(
        "This one-record recovery clears both attendance timestamps and stores Absent for correction 149 / attendance 1424 / user 23. The existing resolver should then display Weekly Off because this date has no work assignment or holiday. The request-time old check-in does not prove the state before approval. Confirm this administrator-directed recovery.",
      )) return;
      try {
        await api.post("/corrections/149/cancel-legacy", {
          correction_id: 149,
          attendance_id: 1424,
          user_id: 23,
          attendance_date: "2026-10-11",
          expected_check_in: "2026-10-11T09:00:00",
          expected_check_out: "2026-10-11T18:30:00",
          expected_status: expectedStatus,
          restore_outcome: "weekly_off_no_attendance",
          confirmation: "I_CONFIRM_CLEAR_ATTENDANCE_FOR_WEEKLY_OFF_149",
          reason: "Administrator-confirmed no-attendance weekly-off recovery for correction 149",
        });
        toast.success("Correction 149 cancelled; attendance cleared and calendar status restored.");
        fetchData();
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
      return;
    }
    if (!window.confirm("Cancel this approved correction and restore the attendance values it changed?")) return;
    try {
      await api.post(`/corrections/${id}/cancel`, {});
      toast.success("Approved correction cancelled");
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
          {(admin || teamView) && (
            <>
              <EmployeeMultiSelect employees={employees} value={selectedEmployeeIds} onChange={setSelectedEmployeeIds} />
              {admin && <TeamMultiSelect value={selectedTeamIds} onChange={(ids, members) => { setSelectedTeamIds(ids); setTeamEmployeeIds(members); }} />}
            </>
          )}
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
          {canViewOwn && (
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              <Plus size={16} />
              Request Correction
            </button>
          )}
        </div>
      </div>

      {(canViewAll || canDecide || canViewOwn) && (
        <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
          {(canViewAll || canDecide) && (
            <button
              onClick={() => setTab("all")}
              className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "all" ? "bg-brand-500 text-white" : "text-ink-600"}`}
            >
              {canReviewOnly ? "Pending Requests" : "All Requests"}
            </button>
          )}
          {canViewOwn && (
            <button
              onClick={() => setTab("mine")}
              className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "mine" ? "bg-brand-500 text-white" : "text-ink-600"}`}
            >
              My Requests
            </button>
          )}
        </div>
      )}


      {loading ? (
        <Loading />
      ) : (
        <CorrectionTable
          corrections={tab === "all" ? all : mine}
          canDecide={canDecide && tab === "all"}
          excludeRequesterId={session?.role === "team_leader" ? session.userId : undefined}
          onDecide={handleDecide}
          onCancel={handleCancel}
        />
      )}

      {canViewOwn && (
        <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="Request Attendance Correction">
          <CorrectionForm
            onSuccess={() => {
              setFormOpen(false);
              fetchData();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </Modal>
      )}
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
