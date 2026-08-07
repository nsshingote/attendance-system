"use client";

/**
 * app/office-ip/page.tsx
 * Admin/SuperAdmin: manage approved office IP addresses that employees
 * must be connected to in order to check in/out.
 */

import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { format, parseISO } from "date-fns";
import toast from "react-hot-toast";
import { Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import Badge from "@/components/Common/Badge";

interface OfficeIP {
  id: number;
  ip_address: string;
  network_name: string | null;
  status: string;
  created_at: string;
}

interface IPFormValues {
  ip_address: string;
  network_name: string;
}

export default function OfficeIPPage() {
  const [ips, setIps] = useState<OfficeIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset } = useForm<IPFormValues>();

  const fetchIPs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<OfficeIP[]>("/office-ips/");
      setIps(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIPs();
  }, [fetchIPs]);

  const onSubmit = async (values: IPFormValues) => {
    setSubmitting(true);
    try {
      await api.post("/office-ips/", { ...values, status: "active" });
      toast.success("Office IP added");
      setModalOpen(false);
      reset();
      fetchIPs();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (ip: OfficeIP) => {
    try {
      await api.put(`/office-ips/${ip.id}/toggle`);
      fetchIPs();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDelete = async (ip: OfficeIP) => {
    if (!confirm(`Remove network "${ip.network_name ?? ip.ip_address}"?`)) return;
    try {
      await api.delete(`/office-ips/${ip.id}`);
      toast.success("Office IP removed");
      fetchIPs();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Office IPs</h1>
            <p className="text-sm text-ink-500">Networks employees must be on to check in/out</p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={16} />
            Add Network
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-3 font-medium">Network</th>
                    <th className="px-4 py-3 font-medium">IP Address</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {ips.map((ip) => (
                    <tr key={ip.id} className="hover:bg-ink-50/60">
                      <td className="px-4 py-3 font-medium text-ink-900">{ip.network_name ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-600">{ip.ip_address}</td>
                      <td className="px-4 py-3 text-ink-600">{format(parseISO(ip.created_at), "dd MMM yyyy")}</td>
                      <td className="px-4 py-3">
                        <Badge status={ip.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleToggle(ip)}
                            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100"
                            aria-label="Toggle status"
                            title={ip.status === "active" ? "Deactivate" : "Activate"}
                          >
                            {ip.status === "active" ? <WifiOff size={15} /> : <Wifi size={15} />}
                          </button>
                          <button
                            onClick={() => handleDelete(ip)}
                            className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
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

            <div className="space-y-2 p-2 sm:hidden">
              {ips.map((ip) => (
                <div key={ip.id} className="rounded-lg border border-ink-200 bg-white p-2.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2 border-b border-ink-100 pb-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{ip.network_name ?? "—"}</p>
                      <p className="text-[11px] text-ink-500">{format(parseISO(ip.created_at), "dd MMM yyyy")}</p>
                    </div>
                    <Badge status={ip.status} />
                  </div>
                  <div className="mt-2 space-y-2 text-xs text-ink-700">
                    <div className="rounded-md bg-ink-50 px-2 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">IP Address</p>
                      <p className="mt-1 font-mono text-[11px]">{ip.ip_address}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleToggle(ip)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-ink-50 px-2.5 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-100"
                      aria-label="Toggle status"
                    >
                      {ip.status === "active" ? <WifiOff size={14} /> : <Wifi size={14} />} {ip.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(ip)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Office Network"
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
              {submitting ? "Adding..." : "Add Network"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Network Name</label>
            <input {...register("network_name")} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" placeholder="Main Office WiFi" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">IP Address</label>
            <input {...register("ip_address", { required: true })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm font-mono" placeholder="49.36.121.64" />
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}