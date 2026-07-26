"use client";

/**
 * app/device-requests/page.tsx
 * Admin/SuperAdmin: approve/reject pending employee device registrations.
 */

import { useEffect, useState, useCallback } from "react";
import { format, parseISO } from "date-fns";
import toast from "react-hot-toast";
import { Check, X } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";

interface DeviceRequest {
  id: number;
  user_id: number;
  device_name: string | null;
  browser_name: string | null;
  status: string;
  requested_at: string;
}

export default function DeviceRequestsPage() {
  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<DeviceRequest[]>("/device-requests/", { params: { status_filter: "Pending" } });
      setRequests(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleDecide = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.put(`/device-requests/${id}`, { status });
      toast.success(`Device request ${status.toLowerCase()}`);
      fetchRequests();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Device Requests</h1>
          <p className="text-sm text-ink-500">Approve new devices for employees who switched phones or browsers</p>
        </div>

        {loading ? (
          <Loading />
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No pending device requests.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-medium">User ID</th>
                  <th className="px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium">Browser</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3 text-ink-700">#{r.user_id}</td>
                    <td className="px-4 py-3 text-ink-700">{r.device_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-700">{r.browser_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-600">{format(parseISO(r.requested_at), "dd MMM, hh:mm a")}</td>
                    <td className="px-4 py-3">
                      <Badge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => handleDecide(r.id, "Approved")}
                          className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                          aria-label="Approve"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          onClick={() => handleDecide(r.id, "Rejected")}
                          className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                          aria-label="Reject"
                        >
                          <X size={15} />
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
    </AppShell>
  );
}