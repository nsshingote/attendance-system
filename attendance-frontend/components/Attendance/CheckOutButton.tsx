"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { LogOut } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { getCurrentLocation } from "@/lib/location";
import {
  createAttendanceActionRunner,
  isRecoverableAttendanceError,
  type AttendanceStatus,
} from "@/lib/attendanceAction";

interface CheckOutButtonProps {
  disabled?: boolean;
  refreshStatus: () => Promise<AttendanceStatus>;
  onStatusUpdate: (status: AttendanceStatus) => void;
}

export default function CheckOutButton({ disabled, refreshStatus, onStatusUpdate }: CheckOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [statusUncertain, setStatusUncertain] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reason, setReason] = useState("");
  const [actionRunner] = useState(() => createAttendanceActionRunner());

  const retryStatusRefresh = async () => {
    setRefreshingStatus(true);
    try {
      await refreshStatus();
      setStatusUncertain(false);
      toast.success("Attendance status refreshed from the server.");
    } catch (error) {
      toast.error(`Attendance status could not be verified: ${getErrorMessage(error)}. Please try again.`);
    } finally {
      setRefreshingStatus(false);
    }
  };

  const submitCheckOut = async (reasonText?: string) => {
    let requestSent = false;
    const result = await actionRunner(
      "check_out",
      async () => {
        const userRequest = api.get<{ attendance_mode?: string }>("/users/me")
          .catch(() => ({ data: { attendance_mode: "office" } }));
        const validationSettingsRequest = api
          .get<{ location_enabled: boolean; validation_mode: string; attendance_radius_meters: number | null }>("/attendance/validation-settings")
          .then(
            (response) => ({ response } as const),
            (error: unknown) => ({ error } as const)
          );
        const { data: user } = await userRequest;
        const payload: { reason?: string; latitude?: number; longitude?: number; accuracy?: number } = reasonText ? { reason: reasonText } : {};
        let validationRadiusMeters: number | null = null;
        const captureLocation = () => getCurrentLocation("check out", user.attendance_mode === "onsite" ? null : validationRadiusMeters).then(
          (position) => ({ position } as const),
          (error: unknown) => ({ error } as const)
        );
        const locationRequest = user.attendance_mode === "onsite"
          ? captureLocation()
          : null;
        const validationSettingsResult = await validationSettingsRequest;
        if ("error" in validationSettingsResult) throw validationSettingsResult.error;
        const { data: validationSettings } = validationSettingsResult.response;
        validationRadiusMeters = validationSettings.attendance_radius_meters;
        const needsLocation = user.attendance_mode === "onsite" || (
          validationSettings.location_enabled &&
          ["location_only", "ip_or_location"].includes(validationSettings.validation_mode)
        );
        if (needsLocation) {
          try {
            const result = await (locationRequest ?? captureLocation());
            if ("error" in result) throw result.error;
            const position = result.position;
            payload.latitude = position.coords.latitude;
            payload.longitude = position.coords.longitude;
            payload.accuracy = position.coords.accuracy;
          } catch (error) {
            if (user.attendance_mode === "onsite" || validationSettings.validation_mode === "location_only") {
              throw error;
            }
          }
        }
        requestSent = true;
        const { data } = await api.post<AttendanceStatus>("/attendance/check-out", payload);
        return data;
      },
      refreshStatus,
      () => setLoading(true),
      () => setLoading(false),
      onStatusUpdate,
      (error) => toast.error(`Check-out was confirmed, but dashboard refresh failed: ${getErrorMessage(error)}`),
    );
    if (result.skipped) return;

    if (result.refreshFailed) {
      setStatusUncertain(true);
      const requestMessage = result.requestFailed ? getErrorMessage(result.requestError) : "";
      const mayHaveSucceeded = result.requestFailed && isRecoverableAttendanceError(
        "check_out",
        requestMessage,
        result.requestError,
        requestSent,
      );
      const message = result.requestFailed
        ? `${requestMessage} Attendance status could not be refreshed${mayHaveSucceeded ? "; the request may have succeeded" : ""}. Please refresh before retrying.`
        : "The check-out request succeeded, but attendance status could not be refreshed. Please refresh before retrying.";
      toast.error(message);
      if (result.requestFailed && requestMessage.includes("REASON_REQUIRED") && !result.confirmed) {
        setShowReasonModal(true);
      }
      return;
    }
    setStatusUncertain(false);

    if (result.requestFailed) {
      const message = getErrorMessage(result.requestError);
      if (result.confirmed && isRecoverableAttendanceError("check_out", message, result.requestError, requestSent)) {
        toast.success(message.toLowerCase().includes("already checked out")
          ? "Already checked out — current attendance confirmed."
          : "Check-out confirmed by the server.");
        router.refresh();
      } else if (message.includes("REASON_REQUIRED") && !result.confirmed) {
        setShowReasonModal(true);
      } else {
        toast.error(message);
      }
      return;
    }

    if (result.confirmed) {
      toast.success("Check-out confirmed by the server.");
      router.refresh();
    } else {
      toast.error("Check-out was submitted, but the server did not confirm it. Refresh attendance before retrying.");
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
        onClick={() => statusUncertain ? void retryStatusRefresh() : void submitCheckOut()}
        disabled={loading || refreshingStatus || (disabled && !statusUncertain)}
        className="flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
      >
        <LogOut size={16} />
        {loading ? "Checking out..." : refreshingStatus ? "Refreshing status..." : statusUncertain ? "Retry Status Check" : disabled ? "Checked Out" : "Check Out"}
      </button>

      {/* Mobile-friendly Reason Modal */}
      {showReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink-900 mb-2">Early Checkout Reason</h3>
            <p className="text-sm text-ink-600 mb-4">
              You're checking out before the configured office end time. Please provide a reason.
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
