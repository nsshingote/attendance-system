"use client";

/**
 * app/emails/page.tsx
 * Admin/SuperAdmin: manage the notification-email recipient list used
 * when employees apply for leave.
 */

import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Plus, Trash2, Mail } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";

interface NotificationEmail {
  id: number;
  name: string | null;
  email: string | null;
  is_active: boolean;
}

interface EmailFormValues {
  name: string;
  email: string;
}

export default function NotificationEmailsPage() {
  const [emails, setEmails] = useState<NotificationEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset } = useForm<EmailFormValues>();

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<NotificationEmail[]>("/notification-emails/");
      setEmails(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const onSubmit = async (values: EmailFormValues) => {
    setSubmitting(true);
    try {
      await api.post("/notification-emails/", { ...values, is_active: true });
      toast.success("Recipient added");
      setModalOpen(false);
      reset();
      fetchEmails();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entry: NotificationEmail) => {
    if (!confirm(`Remove ${entry.email} from notifications?`)) return;
    try {
      await api.delete(`/notification-emails/${entry.id}`);
      toast.success("Recipient removed");
      fetchEmails();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Notification Emails</h1>
            <p className="text-sm text-ink-500">Recipients notified when leave requests are submitted</p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={16} />
            Add Recipient
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : emails.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No notification recipients added yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {emails.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-xl border border-ink-200 bg-white p-4 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                    <Mail size={15} />
                  </div>
                  <div>
                    <p className="font-medium text-ink-900">{e.name ?? "Unnamed"}</p>
                    <p className="text-xs text-ink-500">{e.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(e)}
                  className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove recipient"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Notification Recipient"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={submitting}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add Recipient"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Name</label>
            <input {...register("name", { required: true })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" placeholder="HR" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Email</label>
            <input type="email" {...register("email", { required: true })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" placeholder="hr@company.com" />
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}