"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";
import toast from "react-hot-toast";

type Request = {
  id: number;
  employee_name: string;
  document_id: number;
  document_title: string | null;
  request_type: "replace" | "delete";
  pending_original_filename?: string | null;
  created_at: string;
};

export default function PersonalDocumentRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const load = async () => {
    try {
      const { data } = await api.get<Request[]>("/employee-documents/personal-document-requests");
      setRequests(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  useEffect(() => { void load(); }, []);
  const decide = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.post(`/employee-documents/personal-document-requests/${id}/decision`, { status });
      toast.success(`Request ${status.toLowerCase()}`);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Personal Document Requests</h1>
          <p className="text-sm text-ink-500">Approve or reject employee document replacements and deletions.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Document</th><th className="px-4 py-3">Request</th><th className="px-4 py-3">New file</th><th className="px-4 py-3">Action</th></tr></thead>
            <tbody>
              {requests.length ? requests.map((request) => (
                <tr key={request.id} className="border-t border-ink-100 align-top">
                  <td className="px-4 py-3 font-medium">{request.employee_name}</td>
                  <td className="px-4 py-3">{request.document_title || `Document #${request.document_id}`}</td>
                  <td className="px-4 py-3 capitalize">{request.request_type}</td>
                  <td className="px-4 py-3">{request.pending_original_filename || "-"}</td>
                  <td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => void decide(request.id, "Approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">Approve</button><button onClick={() => void decide(request.id, "Rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600">Reject</button></div></td>
                </tr>
              )) : <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-500">No pending personal document requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
