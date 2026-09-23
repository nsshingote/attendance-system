"use client";

import { useSyncExternalStore } from "react";
import api from "@/lib/api";
import { getSession } from "@/lib/auth";

type PermissionSnapshot = {
  permissions: string[];
  loading: boolean;
  error: string | null;
  sessionKey: string | null;
};

const loadingSnapshot: PermissionSnapshot = {
  permissions: [],
  loading: true,
  error: null,
  sessionKey: null,
};
let snapshot: PermissionSnapshot = loadingSnapshot;
let request: Promise<void> | null = null;
let requestSessionKey: string | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function getSessionKey(): string | null {
  const session = getSession();
  return session ? `${session.userId}:${session.token}` : null;
}

function isRetryablePermissionError(requestError: unknown): boolean {
  const error = requestError as { response?: { status?: number } };
  return error.response?.status === 401 || !error.response;
}

export function refreshPermissions(): Promise<void> {
  const sessionKey = getSessionKey();
  if (!sessionKey) {
    snapshot = loadingSnapshot;
    emit();
    return Promise.resolve();
  }
  if (request && requestSessionKey === sessionKey) return request;

  snapshot = {
    permissions: [],
    loading: true,
    error: null,
    sessionKey,
  };
  emit();

  const sessionRequest = (async () => {
    let lastError: unknown = new Error("Unable to load permissions");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { data } = await api.get<string[]>("/permissions/me");
        if (getSessionKey() === sessionKey) {
          snapshot = { permissions: data, loading: false, error: null, sessionKey };
        }
        return;
      } catch (requestError: unknown) {
        lastError = requestError;
        if (
          attempt === 1 ||
          !isRetryablePermissionError(requestError) ||
          getSessionKey() !== sessionKey
        ) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }

    if (getSessionKey() === sessionKey) {
      snapshot = {
        permissions: [],
        loading: false,
        error: lastError instanceof Error ? lastError.message : "Unable to load permissions",
        sessionKey,
      };
    }
  })()
    .finally(() => {
      if (request === sessionRequest) {
        request = null;
        requestSessionKey = null;
      }
      emit();
      if (getSessionKey() && getSessionKey() !== sessionKey) {
        void refreshPermissions();
      }
    });
  request = sessionRequest;
  requestSessionKey = sessionKey;
  return sessionRequest;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const sessionKey = getSessionKey();
  if (snapshot.sessionKey !== sessionKey) {
    snapshot = sessionKey ? { ...loadingSnapshot, sessionKey } : loadingSnapshot;
    emit();
  }
  if (sessionKey && snapshot.loading && !request) void refreshPermissions();
  return () => listeners.delete(listener);
}

const getSnapshot = () => {
  const sessionKey = getSessionKey();
  return snapshot.sessionKey === sessionKey ? snapshot : loadingSnapshot;
};
const serverSnapshot = loadingSnapshot;
const getServerSnapshot = () => serverSnapshot;

export function usePermissions(): PermissionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function hasPermission(permissions: string[], key: string): boolean {
  return permissions.includes(key);
}
