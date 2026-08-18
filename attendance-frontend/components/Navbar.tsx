"use client";

/**
 * components/Navbar.tsx
 * Top bar shown on every authenticated page: current user, role, logout.
 * Responsive: adjusts padding and text size on mobile.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User as UserIcon, Menu } from "lucide-react";
import toast from "react-hot-toast";
import { getSession, clearSession } from "@/lib/auth";
import api, { getProfilePhotoUrl } from "@/lib/api";

interface NavbarProps {
  onMenuClick?: () => void;
}

export default function Navbar({ onMenuClick }: NavbarProps) {
  const router = useRouter();
  const session = getSession();
  const [photoVersion, setPhotoVersion] = useState(Date.now());

  useEffect(() => {
    const refreshPhoto = () => setPhotoVersion(Date.now());
    window.addEventListener("profile-photo-updated", refreshPhoto);
    return () => window.removeEventListener("profile-photo-updated", refreshPhoto);
  }, []);

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      clearSession();
    }
    toast.success("Logged out successfully");
    router.push("/login");
  };

  const roleLabel =
    session?.role === "superadmin" ? "Super Admin" : session?.role === "admin" ? "Admin" : "Employee";
  const photoUrl = session?.userId ? getProfilePhotoUrl(session.userId, photoVersion) : "";

  const renderAvatar = () => (
    <div className="relative h-7 w-7 overflow-hidden rounded-full bg-brand-100 text-brand-600">
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={(event) => {
            const icon = (event.currentTarget.parentElement?.querySelector("[data-role='fallback-icon']") as HTMLElement | null);
            if (icon) icon.style.display = "none";
          }}
          onError={(event) => {
            event.currentTarget.style.display = "none";
            const icon = (event.currentTarget.parentElement?.querySelector("[data-role='fallback-icon']") as HTMLElement | null);
            if (icon) icon.style.display = "block";
          }}
        />
      )}
      <UserIcon data-role="fallback-icon" className="absolute inset-0 m-auto h-4 w-4 text-brand-600" />
    </div>
  );

  return (
    <header className="flex h-16 items-center justify-between border-b border-ink-200 bg-white/80 px-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 rounded-lg hover:bg-ink-50 text-ink-600"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
        <p className="text-sm font-semibold text-ink-900 hidden sm:block">Attendance Management System</p>
        <p className="text-sm font-semibold text-ink-900 sm:hidden">AMS</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-ink-50 px-2 py-1.5 sm:px-3">
          {renderAvatar()}
          <div className="leading-tight">
            <p className="text-sm font-medium text-ink-900">{session?.name ?? "Guest"}</p>
            <p className="text-xs text-ink-500">{roleLabel}</p>
          </div>
        </div>

        <div className="flex sm:hidden items-center gap-1.5">{renderAvatar()}</div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 sm:px-3"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
