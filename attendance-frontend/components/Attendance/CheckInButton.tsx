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
import { getCurrentLocation } from "@/lib/location";
import {
  createAttendanceActionRunner,
  isRecoverableAttendanceError,
  type AttendanceStatus,
} from "@/lib/attendanceAction";

interface CheckInButtonProps {
  disabled?: boolean;
  refreshStatus: () => Promise<AttendanceStatus>;
  onStatusUpdate: (status: AttendanceStatus) => void;
}

// TEMPORARY: remove this helper and the adjacent timing marks after the controlled test.
function logCheckInTiming(stage: string, durationMs: number) {
  console.info(`[check-in timing] ${stage}: ${durationMs.toFixed(1)}ms`);
}

export default function CheckInButton({ disabled, refreshStatus, onStatusUpdate }: CheckInButtonProps) {
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

  const submitCheckIn = async (reason?: string) => {
    const clickStartedAt = performance.now();
    let requestSent = false;
    let postResponseAt: number | undefined;
    const result = await actionRunner(
      "check_in",
      async () => {
        const userStartedAt = performance.now();
        const userRequest = api.get<{ attendance_mode?: string }>("/users/me")
          .then(
            (response) => {
              const completedAt = performance.now();
              logCheckInTiming("users_me_duration", completedAt - userStartedAt);
              logCheckInTiming("click_to_users_me_complete", completedAt - clickStartedAt);
              return response;
            },
            () => {
              const completedAt = performance.now();
              logCheckInTiming("users_me_duration", completedAt - userStartedAt);
              logCheckInTiming("click_to_users_me_complete", completedAt - clickStartedAt);
              return { data: { attendance_mode: "office" } };
            },
          );
        const validationSettingsStartedAt = performance.now();
        const validationSettingsRequest = api
          .get<{ location_enabled: boolean; validation_mode: string; attendance_radius_meters: number | null }>("/attendance/validation-settings")
          .then(
            (response) => {
              const completedAt = performance.now();
              logCheckInTiming("validation_settings_duration", completedAt - validationSettingsStartedAt);
              logCheckInTiming("click_to_validation_settings_complete", completedAt - clickStartedAt);
              return { response } as const;
            },
            (error: unknown) => {
              const completedAt = performance.now();
              logCheckInTiming("validation_settings_duration", completedAt - validationSettingsStartedAt);
              logCheckInTiming("click_to_validation_settings_complete", completedAt - clickStartedAt);
              return { error } as const;
            },
          );
        const { data: user } = await userRequest;
        const payload: { reason?: string; latitude?: number; longitude?: number; accuracy?: number } = reason ? { reason } : {};
        let validationRadiusMeters: number | null = null;
        const captureLocation = () => {
          const gpsStartedAt = performance.now();
          return getCurrentLocation("check in", user.attendance_mode === "onsite" ? null : validationRadiusMeters).then(
            (position) => {
              const completedAt = performance.now();
              logCheckInTiming("gps_duration", completedAt - gpsStartedAt);
              logCheckInTiming("click_to_gps_complete", completedAt - clickStartedAt);
              return { position } as const;
            },
            (error: unknown) => {
              const completedAt = performance.now();
              logCheckInTiming("gps_duration", completedAt - gpsStartedAt);
              logCheckInTiming("click_to_gps_complete", completedAt - clickStartedAt);
              return { error } as const;
            },
          );
        };
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
        const postStartedAt = performance.now();
        try {
          const { data } = await api.post<AttendanceStatus>("/attendance/check-in", payload);
          postResponseAt = performance.now();
          logCheckInTiming("check_in_post_duration", postResponseAt - postStartedAt);
          logCheckInTiming("click_to_check_in_post_response", postResponseAt - clickStartedAt);
          return data;
        } catch (error) {
          const failedAt = performance.now();
          logCheckInTiming("check_in_post_duration", failedAt - postStartedAt);
          logCheckInTiming("click_to_check_in_post_failure", failedAt - clickStartedAt);
          throw error;
        }
      },
      refreshStatus,
      () => setLoading(true),
      () => setLoading(false),
      onStatusUpdate,
      (error) => toast.error(`Check-in was confirmed, but dashboard refresh failed: ${getErrorMessage(error)}`),
    );
    if (result.skipped) return;

    if (result.refreshFailed) {
      setStatusUncertain(true);
      const requestMessage = result.requestFailed ? getErrorMessage(result.requestError) : "";
      const mayHaveSucceeded = result.requestFailed && isRecoverableAttendanceError(
        "check_in",
        requestMessage,
        result.requestError,
        requestSent,
      );
      const message = result.requestFailed
        ? `${requestMessage} Attendance status could not be refreshed${mayHaveSucceeded ? "; the request may have succeeded" : ""}. Please refresh before retrying.`
        : "The check-in request succeeded, but attendance status could not be refreshed. Please refresh before retrying.";
      toast.error(message);
      if (result.requestFailed && requestMessage.startsWith("REASON_REQUIRED") && !result.confirmed) {
        setShowReasonModal(true);
      }
      return;
    }
    setStatusUncertain(false);

    if (result.requestFailed) {
      const message = getErrorMessage(result.requestError);
      if (result.confirmed && isRecoverableAttendanceError("check_in", message, result.requestError, requestSent)) {
        toast.success(message.toLowerCase().includes("already checked in")
          ? "Already checked in — current attendance confirmed."
          : "Check-in confirmed by the server.");
      } else if (message.startsWith("REASON_REQUIRED") && !result.confirmed) {
        setShowReasonModal(true);
      } else {
        toast.error(message);
      }
      return;
    }

    if (result.confirmed) {
      if (postResponseAt !== undefined) {
        logCheckInTiming("check_in_post_response_to_success_toast_call", performance.now() - postResponseAt);
      }
      toast.success("Check-in confirmed by the server.");
    } else {
      toast.error("Check-in was submitted, but the server did not confirm it. Refresh attendance before retrying.");
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
        onClick={() => statusUncertain ? void retryStatusRefresh() : void submitCheckIn()}
        disabled={loading || refreshingStatus || (disabled && !statusUncertain)}
        className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
      >
        <LogIn size={16} />
        {loading ? "Checking in..." : refreshingStatus ? "Refreshing status..." : statusUncertain ? "Retry Status Check" : disabled ? "Checked In" : "Check In"}
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
