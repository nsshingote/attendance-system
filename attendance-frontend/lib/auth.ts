/**
 * lib/auth.ts
 * Client-side session storage (JWT + user info) and role-based helpers.
 * Uses localStorage since this is a browser-only SPA-style app.
 */

import { jwtDecode } from "jwt-decode";
import { useState, useEffect } from "react";

export type Role = "superadmin" | "admin" | "user";

interface JwtPayload {
  sub: string;
  role: Role;
  exp: number;
}

export interface Session {
  token: string;
  userId: number;
  name: string;
  role: Role;
}

const TOKEN_KEY = "ams_token";
const USER_ID_KEY = "ams_user_id";
const NAME_KEY = "ams_name";
const ROLE_KEY = "ams_role";

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_ID_KEY, String(session.userId));
  localStorage.setItem(NAME_KEY, session.name);
  localStorage.setItem(ROLE_KEY, session.role);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const userId = localStorage.getItem(USER_ID_KEY);
  const name = localStorage.getItem(NAME_KEY);
  const role = localStorage.getItem(ROLE_KEY) as Role | null;

  if (!token || !userId || !name || !role) return null;

  return { token, userId: Number(userId), name, role };
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function updateAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function updateSessionName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NAME_KEY, name);
}

/** Returns true if the stored JWT is missing, malformed, or past its expiry. */
export function isTokenExpired(): boolean {
  const token = getToken();
  if (!token) return true;

  try {
    const payload = jwtDecode<JwtPayload>(token);
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export function isAuthenticated(): boolean {
  // Let the Axios interceptor renew an expired access token using the
  // HttpOnly refresh cookie instead of clearing a persistent session.
  return getSession() !== null;
}

export function isAdmin(role?: Role | null): boolean {
  return role === "admin" || role === "superadmin";
}

export function isSuperAdmin(role?: Role | null): boolean {
  return role === "superadmin";
}

/**
 * React hook version of getSession(). Reads the session once on mount and
 * keeps a stable reference across re-renders — use this instead of calling
 * getSession() directly inside a component body, especially if you plan to
 * put the result in a useEffect/useCallback dependency array. Calling
 * getSession() directly on every render returns a new object each time
 * (since it reads localStorage fresh), which breaks memoization and can
 * cause infinite re-render loops if used as a dependency.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  return session;
}
