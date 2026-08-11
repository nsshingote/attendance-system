"use client";

/**
 * components/Leave/LeaveForm.tsx
 * Apply-for-leave form: ONE consolidated "Leave Category" dropdown —
 * Paid (only if this month's slot is unused), Carried (only if balance
 * > 0), Unpaid — plus dates and reason.
 *
 * Admin/SuperAdmin additionally get an "Apply For" employee picker at
 * the top — leaving it on "Myself" applies for their own account as
 * before; picking an employee applies leave on that employee's behalf
 * (balance checks run against THEIR balance, not the admin's).
 *
 * Balance rules enforced by the backend:
 * - Paid: max 1 day, only if this month's slot hasn't been used yet.
 * - Carried: spends from the accumulated carry-forward pool.
 * - Unpaid: always available, no balance impact.
 * "Privilege" is admin-only — set later via an admin override.
 *
 * "Submit Request" posts to POST /leave/. "Compose Email" is platform-aware
 * (mailto on mobile, Gmail web compose on desktop) and doesn't touch the
 * backend at all.
 */

import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Mail } from "lucide-react";
import { isMobile } from "react-device-detect";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin } from "@/lib/auth";

interface NotificationEmailOption {
  id: number;
  name: string | null;
  email: string | null;
}

interface RecipientLoadResult {
  recipients: NotificationEmailOption[];
  error: string | null;
}

interface UserOption {
  id: number;
  name: string;
}

interface LeaveBalance {
  paid_leave_available_this_month: number;
  carried_leave: number;
  leave_encashed: number;
  remaining_leave: number;
}

interface LeaveFormValues {
  from_date: string;
  to_date: string;
  reason: string;
}

interface LeaveFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function LeaveForm({ onSuccess, onCancel }: LeaveFormProps) {
  const session = getSession();
  const admin = isAdmin(session?.role);

  const [emailOptions, setEmailOptions] = useState<NotificationEmailOption[]>([]);
  const [recipientLoadError, setRecipientLoadError] = useState<string | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [targetUserId, setTargetUserId] = useState<number | undefined>(undefined); // undefined = applying for self

  const {
    register,
    handleSubmit,
    getValues,
  } = useForm<LeaveFormValues>();

  const loadRecipientEmails = useCallback(async (): Promise<RecipientLoadResult> => {
    try {
      const response = await api.get<NotificationEmailOption[]>("/notification-emails/");
      if (!Array.isArray(response.data)) {
        throw new Error("Invalid notification recipient response");
      }
      const recipients = response.data;
      console.info("[Leave Compose] notification recipient response", {
        status: response.status,
        count: recipients.length,
        recipients,
        url: response.config.url,
      });
      setEmailOptions(recipients);
      setRecipientLoadError(null);
      return { recipients, error: null };
    } catch (error) {
      const message = getErrorMessage(error);
      console.error("[Leave Compose] notification recipient request failed", {
        message,
        status: (error as any)?.response?.status,
        response: (error as any)?.response?.data,
      });
      setRecipientLoadError(message);
      return { recipients: [], error: message };
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    const userIdToCheck = targetUserId ?? session?.userId;
    if (!userIdToCheck) return;
    try {
      const { data } = await api.get<LeaveBalance>(`/leave/balance/${userIdToCheck}`);
      setBalance(data);
    } catch {
      // non-fatal — the form still works, just without live balance hints
    }
  }, [targetUserId, session?.userId]);

  useEffect(() => {
    loadRecipientEmails();

    if (admin) {
      api
        .get<UserOption[]>("/users/")
        .then(({ data }) => setUsers(data))
        .catch(() => {});
    }
  }, [admin, loadRecipientEmails]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const onSubmit = async (values: LeaveFormValues) => {
    setSubmitting(true);
    try {
      const payload: any = {
        from_date: values.from_date,
        to_date: values.to_date,
        reason: values.reason,
      };

      if (targetUserId) {
        payload.user_id = targetUserId;
      }

      await api.post("/leave/", payload);
      toast.success(
        targetUserId ? "Leave request submitted on the employee's behalf" : "Leave request submitted"
      );
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleComposeEmail = async () => {
    const values = getValues();

    if (!values.from_date || !values.to_date) {
      toast.error("Fill in dates first, then compose the email");
      return;
    }

    // iOS/WebKit can open the form before the initial effect has completed.
    // Refresh once at click time before treating the configured list as empty.
    let recipients = emailOptions;
    let loadError = recipientLoadError;

    if (recipients.length === 0) {
      const result = await loadRecipientEmails();
      recipients = result.recipients;
      loadError = result.error;
    }

    const toAddresses = recipients.map((opt) => opt.email).filter((email): email is string => !!email);

    if (toAddresses.length === 0) {
      if (loadError) {
        toast.error(`Unable to load notification recipients: ${loadError}`);
        return;
      }
      toast.error("No notification recipients configured. Add HR emails on the Notification Emails page first.");
      return;
    }

    const applicantName = targetUserId ? users.find((u) => u.id === targetUserId)?.name ?? "Employee" : session?.name ?? "Employee";
    const subject = `Leave Request - ${applicantName} (${values.from_date} to ${values.to_date})`;

    const body = [
      `Employee: ${applicantName}`,
      `From: ${values.from_date}`,
      `To: ${values.to_date}`,
      `Reason: ${values.reason || "-"}`,
      "",
      "Regards,",
      session?.name ?? "",
    ].join("\n");

    if (isMobile) {
      const mailtoUrl = `mailto:${toAddresses.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      console.info("[Leave Compose] opening mailto URL", { mailtoUrl, recipients: toAddresses });
      window.location.href = mailtoUrl;
    } else {
      const gmailComposeUrl =
        `https://mail.google.com/mail/?view=cm&fs=1` +
        `&to=${encodeURIComponent(toAddresses.join(","))}` +
        `&su=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;
      window.open(gmailComposeUrl, "_blank");
    }
  };

  return (
    <form className="space-y-4">
      {admin && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Apply For</label>
          <select
            value={targetUserId ?? ""}
            onChange={(e) => setTargetUserId(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">Myself</option>
            {users
              .filter((u) => u.id !== session?.userId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {balance && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
          <p>
            <span className="font-medium text-ink-900">Paid (this month):</span>{" "}
            {balance.paid_leave_available_this_month ? "Available" : "Already used"}
          </p>
          <p>
            <span className="font-medium text-ink-900">Carried leave:</span> {balance.carried_leave} day(s)
          </p>
        </div>
      )}


      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">From</label>
          <input type="date" {...register("from_date", { required: true })} className="block h-11 w-full min-w-0 rounded-lg border border-ink-200 px-3 py-2 text-sm leading-5" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">To</label>
          <input type="date" {...register("to_date", { required: true })} className="block h-11 w-full min-w-0 rounded-lg border border-ink-200 px-3 py-2 text-sm leading-5" />
        </div>
      </div>

      <p className="text-xs text-ink-500">Employees may apply for missed leave on past dates; those requests will be submitted as pending and require admin approval.</p>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Reason</label>
        <textarea {...register("reason")} rows={3} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={handleComposeEmail}
          className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          <Mail size={15} />
          Compose Email
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={submitting}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </form>
  );
}
