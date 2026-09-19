"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import EmployeeMultiSelect from "./EmployeeMultiSelect";

export interface TeamOption {
  id: number;
  name: string;
  status?: string;
  members?: Array<{ id: number }>;
}

interface Props {
  value: number[];
  onChange: (teamIds: number[], memberIds: number[]) => void;
  className?: string;
}

/** Team filter shared by employee-list pages. Team membership is resolved client-side. */
export default function TeamMultiSelect({ value, onChange, className }: Props) {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  useEffect(() => {
    api.get<TeamOption[]>("/teams/").then(({ data }) => setTeams(data.filter((team) => team.status === "active"))).catch(() => {});
  }, []);
  const options = teams.map((team) => ({ id: team.id, name: team.name }));
  return <EmployeeMultiSelect employees={options} value={value} onChange={(ids) => onChange(ids, Array.from(new Set(teams.filter((team) => ids.includes(team.id)).flatMap((team) => (team.members || []).map((member) => member.id)))))} allLabel="All Teams" searchPlaceholder="Search teams" className={className} />;
}
