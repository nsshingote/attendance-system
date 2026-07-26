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

  const submitCheckIn = async (reason?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post("/attendance/check-in", reason ? { reason } : {});
      toast.success(`Checked in — marked as ${data.status}`);
      onSuccess?.();
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.startsWith("REASON_REQUIRED")) {
        const userReason = window.prompt("You're checking in after 10:30 AM. Please provide a reason:");
        if (userReason && userReason.trim()) {
          await submitCheckIn(userReason.trim());
          return;
        } else {
          toast.error("A reason is required to check in after 10:30 AM");
        }
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={() => submitCheckIn()}
      disabled={disabled || loading}
      className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
    >
      <LogIn size={16} />
      {loading ? "Checking in..." : disabled ? "Checked In" : "Check In"}
    </button>
  );
}