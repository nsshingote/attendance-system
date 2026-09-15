"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";

export function usePermissions(): { permissions: string[]; loading: boolean } {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get<string[]>("/permissions/me")
      .then(({ data }) => {
        if (active) setPermissions(data);
      })
      .catch(() => {
        if (active) setPermissions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { permissions, loading };
}

export function hasPermission(permissions: string[], key: string): boolean {
  return permissions.includes(key);
}
