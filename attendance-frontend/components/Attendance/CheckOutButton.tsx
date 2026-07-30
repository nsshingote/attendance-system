"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { LogOut } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";

interface CheckOutButtonProps {
  disabled?: boolean;
  onSuccess?: () => void;
}

export default function CheckOutButton({ disabled, onSuccess }: CheckOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reason, setReason] = useState("");

  const submitCheckOut = async (reasonText?: string) => {
    if (loading) return;
    
    setLoading(true);
    try {
      const payload = reasonText ? { reason: reasonText } : {};
      const { data } = await api.post("/attendance/check-out", payload);
      toast.success(`Checked out — status: ${data.status}`);
      if (onSuccess) onSuccess();
      router.refresh();
    } catch (error: any) {
      const message = getErrorMessage(error);
      
      if (message.includes("REASON_REQUIRED")) {
        setShowReasonModal(true);
        setLoading(false);
        return;
      }
      
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleReasonSubmit = () => {
    if (reason.trim()) {
      setShowReasonModal(false);
      submitCheckOut(reason.trim());
      setReason("");
    } else {
      toast.error("Please enter a reason");
    }
  };

  return (
    <>
      <button
        onClick={() => submitCheckOut()}
        disabled={disabled || loading}
        className="flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
      >
        <LogOut size={16} />
        {loading ? "Checking out..." : disabled ? "Checked Out" : "Check Out"}
      </button>

      {/* Mobile-friendly Reason Modal */}
      {showReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900 mb-2">Early Checkout Reason</h3>
            <p className="text-sm text-ink-600 mb-4">
              You're checking out before 6:30 PM. Please provide a reason.
            </p>
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
                Submit & Checkout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}