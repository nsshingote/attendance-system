"use client";

/**
 * components/Navbar.tsx
 * Top bar shown on every authenticated page: current user, role, logout.
 * Responsive: adjusts padding and text size on mobile.
 */

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

  return (
    <header className="flex h-16 items-center justify-between border-b border-ink-200 bg-white/80 px-3 backdrop-blur sm:px-6">
      {/* Left side - Menu button (mobile) + Title */}
      <div className="flex items-center gap-2">
        {/* Mobile menu button - triggers sidebar */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 rounded-lg hover:bg-ink-50 text-ink-600"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
        
        <p className="text-sm font-semibold text-ink-900 hidden sm:block">
          Attendance Management System
        </p>
        <p className="text-sm font-semibold text-ink-900 sm:hidden">
          AMS
        </p>
      </div>

      {/* Right side - User info & Logout */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* User Info - Hidden on very small screens, visible on sm+ */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-ink-50 px-2 py-1.5 sm:px-3">
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-brand-600">
            {session?.userId && <img src={getProfilePhotoUrl(session.userId)} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
            <UserIcon size={14} className="absolute" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium text-ink-900">{session?.name ?? "Guest"}</p>
            <p className="text-xs text-ink-500">{roleLabel}</p>
          </div>
        </div>

        {/* Compact user icon for mobile */}
        <div className="flex sm:hidden items-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-brand-600">
            {session?.userId && <img src={getProfilePhotoUrl(session.userId)} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
            <UserIcon size={14} className="absolute" />
          </div>
        </div>

        {/* Logout Button */}
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
