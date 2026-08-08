"use client";

/**
 * app/notification-emails/page.tsx
 * Admin/SuperAdmin: Manage notification email recipients.
 * Simple Add/Remove functionality - only Email field.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";

interface NotificationEmail {
  id: number;
  email: string | null;
}

export default function NotificationEmailsPage() {
  const [emails, setEmails] = useState<NotificationEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<NotificationEmail[]>("/notification-emails/");
      setEmails(data || []);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const handleAdd = async () => {
    if (!newEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    // Basic email validation
    if (!newEmail.includes("@") || !newEmail.includes(".")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/notification-emails/", {
        name: "HR",
        email: newEmail.trim(),
      });
      toast.success("Email added successfully");
      setNewEmail("");
      setShowForm(false);
      fetchEmails();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this email?")) return;
    try {
      await api.delete(`/notification-emails/${id}`);
      toast.success("Email deleted successfully");
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
            <p className="text-sm text-ink-500">Manage email recipients for leave & correction notifications</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={16} />
            Add Email
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : emails.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No notification emails configured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {emails.map((e) => (
                  <tr key={e.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3 text-ink-600">{e.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleDelete(e.id)}
                          className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                          aria-label="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-ink-900">Add Notification Email</h2>
            <p className="text-sm text-ink-500 mt-1">These emails will receive leave & correction notifications.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">Email Address</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  placeholder="e.g. hr@company.com"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={submitting}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  {submitting ? "Adding..." : "Add Email"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}