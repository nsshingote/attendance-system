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

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-semibold text-ink-900">Teams</h1><p className="text-sm text-ink-500">Manage Team Leaders and team members</p></div>
          <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white"><Plus size={16} /> New Team</button>
        </div>
        <form onSubmit={save} className="space-y-4 rounded-xl border border-ink-200 bg-white p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Team name" className="rounded-lg border border-ink-200 px-3 py-2 text-sm" />
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
            <select value={form.team_leader_id} onChange={(e) => setForm({ ...form, team_leader_id: e.target.value })} className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="">No Team Leader</option>{leaders.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-3">
            {users.filter((user) => user.role === "user" || user.role === "team_leader").map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={form.member_ids.includes(user.id)} onChange={() => toggleMember(user.id)} />{user.name}
              </label>
            ))}
          </div>
          {editingId && <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "inactive" })} className="rounded-lg border border-ink-200 px-3 py-2 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option></select>}
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
