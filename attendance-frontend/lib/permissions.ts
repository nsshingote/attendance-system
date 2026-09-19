"use client";

import { useSyncExternalStore } from "react";
import api from "@/lib/api";

type PermissionSnapshot = { permissions: string[]; loading: boolean; error: string | null };

let snapshot: PermissionSnapshot = { permissions: [], loading: true, error: null };
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function refreshPermissions(): Promise<void> {
  if (request) return request;
  snapshot = { ...snapshot, loading: true, error: null };
  emit();
  request = api.get<string[]>("/permissions/me")
    .then(({ data }) => {
      snapshot = { permissions: data, loading: false, error: null };
    })
    .catch((requestError: unknown) => {
      snapshot = {
        permissions: [],
        loading: false,
        error: requestError instanceof Error ? requestError.message : "Unable to load permissions",
      };
    })
    .finally(() => {
      request = null;
      emit();
    });
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (snapshot.loading && !request) void refreshPermissions();
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const serverSnapshot: PermissionSnapshot = { permissions: [], loading: true, error: null };
const getServerSnapshot = () => serverSnapshot;

export function usePermissions(): PermissionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function hasPermission(permissions: string[], key: string): boolean {
  return permissions.includes(key);
}
