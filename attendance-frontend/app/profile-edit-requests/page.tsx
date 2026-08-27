"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";

type Request = { id: number; employee_name: string; section: string; requested_data: Record<string, string>; status: string; created_at: string; request_source?: "profile" | "personal_document" };

export function ProfileEditRequestsContent() {
  const [requests, setRequests] = useState<Request[]>([]);
  const load = () => api.get<Request[]>("/users/profile-edit-requests").then(({ data }) => setRequests(data)).catch((error) => toast.error(getErrorMessage(error)));
  useEffect(() => { load(); }, []);
  const decide = async (request: Request, status: "Approved" | "Rejected") => { try { const endpoint = request.request_source === "personal_document" ? `/employee-documents/personal-document-requests/${request.id}/decision` : `/users/profile-edit-requests/${request.id}/decision`; await api.post(endpoint, { status }); toast.success(`Request ${status.toLowerCase()}`); load(); } catch (error) { toast.error(getErrorMessage(error)); } };
  return <div className="mx-auto max-w-5xl space-y-6"><div><h1 className="text-xl font-semibold">Profile Corrections</h1><p className="text-sm text-ink-500">Approve or reject employee profile and personal document requests.</p></div><div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card"><table className="w-full text-sm"><thead className="bg-ink-50 text-left"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Request</th><th className="px-4 py-3">Requested data</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody>{requests.length ? requests.map((request) => <tr key={`${request.request_source || "profile"}-${request.id}`} className="border-t border-ink-100 align-top"><td className="px-4 py-3 font-medium">{request.employee_name}</td><td className="px-4 py-3">{request.section.startsWith("Document ") ? request.section : request.section.replaceAll("_", " ")}</td><td className="px-4 py-3">{Object.entries(request.requested_data).filter(([, value]) => value).map(([key, value]) => <p key={key}><span className="text-ink-500">{key.replaceAll("_", " ")}: </span>{value}</p>)}</td><td className="px-4 py-3">{new Date(request.created_at).toLocaleDateString("en-IN")}</td><td className="px-4 py-3">{request.status}</td><td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => decide(request, "Approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">Approve</button><button onClick={() => decide(request, "Rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600">Reject</button></div></td></tr>) : <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-500">No pending profile corrections.</td></tr>}</tbody></table></div></div>;
}

export default function ProfileEditRequestsPage() {
  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <ProfileEditRequestsContent />
    </AppShell>
  );
}

