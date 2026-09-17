"use client";

/**
 * components/AdminSidebar.tsx
 * Left navigation for Admin & Super Admin roles.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Plane,
  ClipboardEdit,
  CalendarDays,
  Settings,
  Smartphone,
  FileBarChart,
  Mail,
  Wifi,
  History,
  UserRoundCog,
  FileText,
  X,
  Layers,
  MessageSquare,
  FolderOpen,
  NotebookPen,
  BookOpen,
} from "lucide-react";
import { getSession, isSuperAdmin } from "@/lib/auth";
import api from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/permissions", label: "Permissions", icon: UserRoundCog },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/employee-documents", label: "Employee Documents", icon: FolderOpen },
  { href: "/kundli", label: "Kundli", icon: NotebookPen },
  { href: "/admin/report-structure", label: "Report Structure", icon: Layers },
  { href: "/manage-departments", label: "Manage Departments", icon: Layers },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/leave", label: "Leave", icon: Plane },
  { href: "/admin-reports", label: "Reports", icon: FileBarChart },
  { href: "/requests", label: "Requests", icon: ClipboardEdit },
  { href: "/holidays", label: "Holidays", icon: CalendarDays },
  { href: "/reports", label: "Monthly Summary", icon: FileBarChart },
  { href: "/device-requests", label: "Device Requests", icon: Smartphone },
  { href: "/notification-emails", label: "Notification Emails", icon: Mail },
  { href: "/office-ip", label: "Office IPs", icon: Wifi },
  { href: "/activity-logs", label: "Activity Logs", icon: History },
  { href: "/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface AdminSidebarProps {
  isMobile?: boolean;
  onClose?: () => void;
}

export default function AdminSidebar({ isMobile = false, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const session = getSession();
  const [pendingCounts, setPendingCounts] = useState({ requests: 0, leave: 0, devices: 0, feedback: 0 });

  useEffect(() => {
    const refresh = () => api.get<typeof pendingCounts>("/notifications/pending-request-count")
      .then(({ data }) => setPendingCounts(data))
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center justify-between border-b border-ink-200 px-5">
        <div className="flex items-center gap-2">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-sm font-semibold text-ink-900">
            {isSuperAdmin(session?.role) ? "Super Admin" : "Admin Panel"}
          </span>
        </div>
        {isMobile && onClose && (
          <button 
            onClick={onClose}
            className="lg:hidden text-ink-500 hover:text-ink-700"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              <Icon size={17} strokeWidth={active ? 2.4 : 2} />
              {label}
              {href === "/requests" && pendingCounts.requests > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                  {pendingCounts.requests > 99 ? "99+" : pendingCounts.requests}
                </span>
              )}
              {href === "/leave" && pendingCounts.leave > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[10px] font-bold leading-5 text-white">{pendingCounts.leave > 99 ? "99+" : pendingCounts.leave}</span>
              )}
              {href === "/device-requests" && pendingCounts.devices > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[10px] font-bold leading-5 text-white">{pendingCounts.devices > 99 ? "99+" : pendingCounts.devices}</span>
              )}
              {href === "/feedback" && pendingCounts.feedback > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[10px] font-bold leading-5 text-white">{pendingCounts.feedback > 99 ? "99+" : pendingCounts.feedback}</span>
              )}
            </Link>
          );
        })}

      </nav>
    </>
  );

  // Mobile: render with overlay
  if (isMobile) {
    return (
      <div className="h-full w-72 bg-white shadow-xl">
        {sidebarContent}
      </div>
    );
  }

  // Desktop: render as sidebar
  return (
    <aside className="hidden lg:flex h-full w-60 shrink-0 flex-col border-r border-ink-200 bg-white">
      {sidebarContent}
    </aside>
  );
}
