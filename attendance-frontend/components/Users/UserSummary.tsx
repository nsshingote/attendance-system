"use client";

/**
 * components/Users/UserSummary.tsx
 * User profile card shown at the top of the user detail page.
 * Shows: Name, Department, Role, Status, Email, Mobile, Avatar
 */

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { getProfilePhotoUrl } from "@/lib/api";

interface UserSummaryProps {
  user: {
    id: number;
    name: string;
    mobile: string;
    email: string | null;
    department: string;
    designation: string;
    role: string;
    status: string;
  };
}

export default function UserSummary({ user }: UserSummaryProps) {
  const [photoVersion, setPhotoVersion] = useState(Date.now());

  useEffect(() => {
    const handlePhotoUpdate = () => setPhotoVersion(Date.now());
    window.addEventListener("profile-photo-updated", handlePhotoUpdate);
    return () => window.removeEventListener("profile-photo-updated", handlePhotoUpdate);
  }, []);

  const photoUrl = getProfilePhotoUrl(user.id, photoVersion);

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start gap-6">
        <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-brand-700">
          <img
            src={photoUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onLoad={(event) => {
              const icon = (event.currentTarget.parentElement?.querySelector("[data-role='profile-avatar-fallback']") as HTMLElement | null);
              if (icon) icon.style.display = "none";
            }}
            onError={(event) => {
              event.currentTarget.style.display = "none";
              const icon = (event.currentTarget.parentElement?.querySelector("[data-role='profile-avatar-fallback']") as HTMLElement | null);
              if (icon) icon.style.display = "block";
            }}
          />
          <User data-role="profile-avatar-fallback" size={36} className="absolute" />
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-ink-900">{user.name}</h2>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-ink-600"><span className="font-medium text-ink-700">Department:</span> {user.department}</span>
            <span className="text-ink-600"><span className="font-medium text-ink-700">Role:</span> {user.role}</span>
            <span className="text-ink-600"><span className="font-medium text-ink-700">Status:</span>{" "}<span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${user.status === "active" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{user.status}</span></span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-600">
            <span><span className="font-medium text-ink-700">Email:</span> {user.email || "—"}</span>
            <span><span className="font-medium text-ink-700">Mobile:</span> {user.mobile}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
