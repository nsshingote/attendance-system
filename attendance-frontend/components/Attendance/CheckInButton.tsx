"use client";

/**
 * components/Attendance/CheckInButton.tsx
 * Calls POST /attendance/check-in. If checking in after 10:30 AM, the
 * backend rejects with a "REASON_REQUIRED" error — this component catches
 * that specific case and prompts for a reason via window.prompt, then
 * retries with it included.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { LogIn } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";

interface CheckInButtonProps {
  disabled?: boolean;
  onSuccess?: () => void;
}

export default function CheckInButton({ disabled, onSuccess }: CheckInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reason, setReason] = useState("");

  const submitCheckIn = async (reason?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post("/attendance/check-in", reason ? { reason } : {});
      toast.success(`Checked in — marked as ${data.status}`);
      onSuccess?.();
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.startsWith("REASON_REQUIRED")) {
        setShowReasonModal(true);
        setLoading(false);
        return;
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReasonSubmit = () => {
    if (reason.trim()) {
      setShowReasonModal(false);
      submitCheckIn(reason.trim());
      setReason("");
    } else {
      toast.error("Please enter a reason");
    }
  };

  return (
    <>
      <button
        onClick={() => submitCheckIn()}
        disabled={disabled || loading}
        className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
      >
        <LogIn size={16} />
        {loading ? "Checking in..." : disabled ? "Checked In" : "Check In"}
      </button>

      {showReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900 mb-2">Late Check-in Reason</h3>
            <p className="text-sm text-ink-600 mb-4">You're checking in after the configured grace time. Please provide a reason.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter your reason..."
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              rows={3}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowReasonModal(false);
                  setReason("");
                  setLoading(false);
                }}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReasonSubmit}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                Submit & Check In
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}