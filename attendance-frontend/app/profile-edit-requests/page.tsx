"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";

type Request = { id: number; employee_name: string; section: string; requested_data: Record<string, string>; status: string; created_at: string };

export function ProfileEditRequestsContent() {
  const [requests, setRequests] = useState<Request[]>([]);
  const load = () => api.get<Request[]>("/users/profile-edit-requests", { params: { status: "Pending" } }).then(({ data }) => setRequests(data)).catch((error) => toast.error(getErrorMessage(error)));
  useEffect(() => { load(); }, []);
  const decide = async (id: number, status: "Approved" | "Rejected") => { try { await api.post(`/users/profile-edit-requests/${id}/decision`, { status }); toast.success(`Request ${status.toLowerCase()}`); load(); } catch (error) { toast.error(getErrorMessage(error)); } };
  return <div className="mx-auto max-w-5xl space-y-6"><div><h1 className="text-xl font-semibold">Profile Edit Requests</h1><p className="text-sm text-ink-500">Approve or reject employee profile and document edit requests.</p></div><div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card"><table className="w-full text-sm"><thead className="bg-ink-50 text-left"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Section</th><th className="px-4 py-3">Requested data</th><th className="px-4 py-3">Action</th></tr></thead><tbody>{requests.length ? requests.map((request) => <tr key={request.id} className="border-t border-ink-100 align-top"><td className="px-4 py-3 font-medium">{request.employee_name}</td><td className="px-4 py-3 capitalize">{request.section.replaceAll("_", " ")}</td><td className="px-4 py-3">{Object.entries(request.requested_data).filter(([, value]) => value).map(([key, value]) => <p key={key}><span className="text-ink-500">{key.replaceAll("_", " ")}: </span>{value}</p>)}</td><td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => decide(request.id, "Approved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">Approve</button><button onClick={() => decide(request.id, "Rejected")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600">Reject</button></div></td></tr>) : <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-500">No pending profile edit requests.</td></tr>}</tbody></table></div></div>;
}

export default function ProfileEditRequestsPage() {
  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <ProfileEditRequestsContent />
    </AppShell>
  );
}

