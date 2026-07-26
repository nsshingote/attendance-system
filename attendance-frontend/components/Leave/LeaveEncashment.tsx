"use client";

/**
 * components/Leave/LeaveEncashment.tsx
 * Requests encashment of carried leave — this no longer deducts
 * immediately. It creates a Pending request that an Admin/SuperAdmin must
 * approve (see app/leave/page.tsx's "Encashment Requests" tab for admins,
 * and EncashmentDecision below for the approval action).
 */

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";

interface LeaveEncashmentProps {
  carriedLeave: number;
  onSuccess: () => void;
}

interface MyEncashmentRequest {
  id: number;
  days: number;
  status: string;
}

export default function LeaveEncashment({ carriedLeave, onSuccess }: LeaveEncashmentProps) {
  const [days, setDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<MyEncashmentRequest | null>(null);

  useEffect(() => {
    api
      .get<MyEncashmentRequest[]>("/leave/encashment-requests/me")
      .then(({ data }) => setPendingRequest(data.find((r) => r.status === "Pending") ?? null))
      .catch(() => {});
  }, []);

  const handleRequestEncashment = async () => {
    if (days <= 0 || days > carriedLeave) {
      toast.error("Enter a valid number of days within your carried leave balance");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/leave/encash", { days });
      toast.success("Encashment request submitted — awaiting admin approval");
      setPendingRequest({ id: data.id, days: data.days, status: data.status });
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
      <h3 className="mb-1 text-sm font-semibold text-ink-900">Leave Encashment</h3>
      <p className="mb-4 text-xs text-ink-500">
        Request to encash unused carried leave. You have {carriedLeave} day(s) carried forward. Requires
        Admin/SuperAdmin approval.
      </p>

      {pendingRequest ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          You have a pending request to encash {pendingRequest.days} day(s) — awaiting admin approval.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={carriedLeave}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-24 rounded-lg border border-ink-200 px-3 py-2 text-sm"
          />
          <button
            onClick={handleRequestEncashment}
            disabled={submitting || carriedLeave === 0}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Request Encashment"}
          </button>
        </div>
      )}
    </div>
  );
}