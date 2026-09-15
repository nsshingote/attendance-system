"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import api, { getErrorMessage } from "@/lib/api";

type User = { id: number; name: string; role: string; department: string; status: string };
type Department = { id: number; name: string };
type Team = {
  id: number; name: string; department_id: number | null; team_leader_id: number | null;
  status: "active" | "inactive"; team_leader: User | null; members: User[];
};

type TeamForm = {
  name: string;
  department_id: string;
  team_leader_id: string;
  member_ids: number[];
  status: "active" | "inactive";
};

const emptyForm: TeamForm = { name: "", department_id: "", team_leader_id: "", member_ids: [], status: "active" };

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);

  const load = async () => {
    try {
      const [teamResponse, userResponse, departmentResponse] = await Promise.all([
        api.get<Team[]>("/teams/"),
        api.get<User[]>("/users/"),
        api.get<Department[]>("/reports/departments"),
      ]);
      setTeams(teamResponse.data);
      setUsers(userResponse.data);
      setDepartments(departmentResponse.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); };
  const openEdit = (team: Team) => {
    setEditingId(team.id);
    setForm({
      name: team.name,
      department_id: team.department_id ? String(team.department_id) : "",
      team_leader_id: team.team_leader_id ? String(team.team_leader_id) : "",
      member_ids: team.members.map((member) => member.id),
      status: team.status,
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        name: form.name,
        department_id: form.department_id ? Number(form.department_id) : null,
        team_leader_id: form.team_leader_id ? Number(form.team_leader_id) : null,
        member_ids: form.member_ids,
        status: form.status,
      };
      if (editingId) await api.put(`/teams/${editingId}`, payload);
      else await api.post("/teams/", payload);
      toast.success(editingId ? "Team updated" : "Team created");
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const toggleMember = (id: number) => {
    setForm((current) => ({
      ...current,
      member_ids: current.member_ids.includes(id)
        ? current.member_ids.filter((memberId) => memberId !== id)
        : [...current.member_ids, id],
    }));
  };

  const leaders = users.filter((user) => user.role === "team_leader");
  const memberOptions = users.filter((user) => user.role === "user" || user.role === "team_leader");
  const departmentNames = Array.from(new Set(memberOptions.map((user) => user.department).filter(Boolean))).sort();
  const toggleDepartment = (department: string) => {
    const departmentIds = memberOptions
      .filter((user) => user.department === department)
      .map((user) => user.id);
    const allSelected = departmentIds.every((id) => form.member_ids.includes(id));
    setForm((current) => ({
      ...current,
      member_ids: allSelected
        ? current.member_ids.filter((id) => !departmentIds.includes(id))
        : Array.from(new Set([...current.member_ids, ...departmentIds])),
    }));
  };

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-semibold text-ink-900">Teams</h1><p className="text-sm text-ink-500">Manage Team Leaders and team members</p></div>
          <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white"><Plus size={16} /> New Team</button>
        </div>
        <form onSubmit={save} className="space-y-4 rounded-xl border border-ink-200 bg-white p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Assign Team Leader</label>
            <select value={form.team_leader_id} onChange={(e) => setForm({ ...form, team_leader_id: e.target.value })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="">Select Team Leader</option>{leaders.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink-700">Assign Team Members</label>
            <button
              type="button"
              onClick={() => setMembersOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-ink-200 bg-white px-3 py-2 text-left text-sm text-ink-700"
            >
              <span>
                {form.member_ids.length
                  ? `${form.member_ids.length} member${form.member_ids.length === 1 ? "" : "s"} selected`
                  : "Select team members"}
              </span>
              <span className="text-ink-400">{membersOpen ? "▲" : "▼"}</span>
            </button>
            {membersOpen && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-ink-200 bg-white p-3">
                <div className="mb-3 flex flex-wrap gap-2 border-b border-ink-100 pb-3">
                  {departmentNames.map((department) => {
                    const departmentIds = memberOptions.filter((user) => user.department === department).map((user) => user.id);
                    const selectedCount = departmentIds.filter((id) => form.member_ids.includes(id)).length;
                    return (
                      <button
                        key={department}
                        type="button"
                        onClick={() => toggleDepartment(department)}
                        className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
                      >
                        {selectedCount === departmentIds.length ? `Clear ${department}` : `Select ${department}`}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {memberOptions.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 text-sm text-ink-700">
                      <input type="checkbox" checked={form.member_ids.includes(user.id)} onChange={() => toggleMember(user.id)} />
                      <span>{user.name} <span className="text-xs text-ink-400">({user.department})</span></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.member_ids.map((id) => {
                const member = memberOptions.find((user) => user.id === id);
                return member ? <span key={id} className="rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-700">{member.name}</span> : null;
              })}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Team Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enter team name" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Department</label>
              <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                <option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </div>
            {editingId && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "inactive" })} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <option value="active">Active</option><option value="inactive">Inactive</option>
                </select>
              </div>
            )}
          </div>
          <button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white">{editingId ? "Save Changes" : "Create Team"}</button>
        </form>
        {loading ? <Loading /> : <div className="space-y-3">{teams.map((team) => (
          <div key={team.id} className="rounded-xl border border-ink-200 bg-white p-4">
            <div className="flex items-center justify-between"><div><h2 className="font-semibold text-ink-900">{team.name}</h2><p className="text-sm text-ink-500">{team.team_leader?.name || "No Team Leader"} · {team.status}</p></div><button onClick={() => openEdit(team)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm">Edit</button></div>
            <p className="mt-2 text-sm text-ink-600">Members: {team.members.length ? team.members.map((member) => member.name).join(", ") : "None"}</p>
          </div>
        ))}</div>}
      </div>
    </AppShell>
  );
}
