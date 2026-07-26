"use client";

/**
 * components/Attendance/CheckOutButton.tsx
 * Calls POST /attendance/check-out. If checking out before 6:30 PM, the
 * backend rejects with a "REASON_REQUIRED" error — this component catches
 * that specific case and prompts for a reason via window.prompt, then
 * retries with it included.
 * 
 * If report is not submitted, redirects to /daily-report page.
 */

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

  const submitCheckOut = async (reason?: string) => {
    setLoading(true);
    try {
      const { data } = await api.post("/attendance/check-out", reason ? { reason } : {});
      toast.success(`Checked out — status: ${data.status}`);
      onSuccess?.();
    } catch (error) {
      const message = getErrorMessage(error);
      
      // Check if report is required
      if (message.startsWith("REPORT_REQUIRED")) {
        toast.error("Please submit your daily report before checking out");
        router.push("/daily-report");
        return;
      }
      
      // Check if reason is required (early checkout before 6:30 PM)
      if (message.startsWith("REASON_REQUIRED")) {
        const userReason = window.prompt("You're checking out before 6:30 PM. Please provide a reason:");
        if (userReason && userReason.trim()) {
          await submitCheckOut(userReason.trim());
          return;
        } else {
          toast.error("A reason is required to check out before 6:30 PM");
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
      onClick={() => submitCheckOut()}
      disabled={disabled || loading}
      className="flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
    >
      <LogOut size={16} />
      {loading ? "Checking out..." : disabled ? "Checked Out" : "Check Out"}
    </button>
  );
}