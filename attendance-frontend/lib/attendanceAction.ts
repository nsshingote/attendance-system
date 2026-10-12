export type AttendanceAction = "check_in" | "check_out";

export interface AttendanceStatus {
  check_in: string | null;
  check_out: string | null;
  status?: string;
}

export interface AttendanceActionResult {
  skipped: boolean;
  requestFailed: boolean;
  requestError?: unknown;
  refreshFailed: boolean;
  refreshError?: unknown;
  status?: AttendanceStatus;
  refreshPending?: boolean;
  confirmed: boolean;
}

function asAttendanceStatus(value: unknown): AttendanceStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("check_in" in value) || !("check_out" in value)) return undefined;
  const { check_in, check_out } = value;
  if ((check_in !== null && typeof check_in !== "string")
    || (check_out !== null && typeof check_out !== "string")) return undefined;
  const status = "status" in value && typeof value.status === "string" ? value.status : undefined;
  return status ? { check_in, check_out, status } : { check_in, check_out };
}

export function isAttendanceActionConfirmed(
  action: AttendanceAction,
  status: AttendanceStatus,
): boolean {
  return action === "check_in" ? Boolean(status.check_in) : Boolean(status.check_out);
}

export function isRecoverableAttendanceError(
  action: AttendanceAction,
  message: string,
  error: unknown,
  requestSent: boolean,
): boolean {
  const normalizedMessage = message.toLowerCase();
  const duplicateMessage = action === "check_in"
    ? normalizedMessage.includes("already checked in today")
    : normalizedMessage.includes("already checked out today");
  if (duplicateMessage) return true;
  if (!requestSent) return false;
  if (typeof error !== "object" || error === null || !("response" in error)) return true;
  const response = error.response;
  if (!response || typeof response !== "object" || !("status" in response)) return true;
  return typeof response.status === "number" && response.status >= 500;
}

export function createAttendanceActionRunner() {
  let inFlight = false;

  return async function runAttendanceAction(
    action: AttendanceAction,
    submit: () => Promise<unknown>,
    refreshStatus: () => Promise<AttendanceStatus>,
    onStart: () => void,
    onFinish: () => void,
    onStatusUpdate?: (status: AttendanceStatus) => void,
    onRefreshError?: (error: unknown) => void,
  ): Promise<AttendanceActionResult> {
    if (inFlight) {
      return {
        skipped: true,
        requestFailed: false,
        refreshFailed: false,
        confirmed: false,
      };
    }

    inFlight = true;
    try {
      onStart();
      let requestFailed = false;
      let requestError: unknown;
      let response: unknown;
      try {
        response = await submit();
      } catch (error) {
        requestFailed = true;
        requestError = error;
      }

      const actionStatus = response === undefined ? undefined : asAttendanceStatus(response);
      if (!requestFailed && actionStatus && isAttendanceActionConfirmed(action, actionStatus)) {
        onStatusUpdate?.(actionStatus);
        void refreshStatus()
          .catch((error: unknown) => onRefreshError?.(error));
        return {
          skipped: false,
          requestFailed: false,
          refreshFailed: false,
          status: actionStatus,
          refreshPending: true,
          confirmed: true,
        };
      }

      let refreshFailed = false;
      let refreshError: unknown;
      let status: AttendanceStatus | undefined;
      try {
        status = await refreshStatus();
      } catch (error) {
        refreshFailed = true;
        refreshError = error;
      }

      return {
        skipped: false,
        requestFailed,
        requestError,
        refreshFailed,
        refreshError,
        status,
        confirmed: status ? isAttendanceActionConfirmed(action, status) : false,
      };
    } finally {
      inFlight = false;
      onFinish();
    }
  };
}
