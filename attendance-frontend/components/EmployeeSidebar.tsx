"use client";

/**
 * components/EmployeeSidebar.tsx
 * Left navigation for the Employee role — a narrower set of pages
 * than AdminSidebar.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { LayoutDashboard, CalendarCheck, Plane, ClipboardEdit, MessageSquare, ContactRound, X, BookOpen, Users, FileBarChart, FileText, NotebookPen } from "lucide-react";
import { getSession } from "@/lib/auth";
import { hasPermission, usePermissions } from "@/lib/permissions";
import api from "@/lib/api";

const EMPLOYEE_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/my-profile", label: "My Profile", icon: ContactRound },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/attendance", label: "My Attendance", icon: CalendarCheck },
  { href: "/leave", label: "My Leave", icon: Plane },
  { href: "/corrections", label: "Corrections", icon: ClipboardEdit },
  { href: "/daily-report", label: "Daily Report", icon: FileText },
  { href: "/feedback", label: "Feedback", icon: MessageSquare },
];

interface EmployeeSidebarProps {
  isMobile?: boolean;
  onClose?: () => void;
}

export default function EmployeeSidebar({ isMobile = false, onClose }: EmployeeSidebarProps) {
  const pathname = usePathname();
  const session = getSession();
  const { permissions } = usePermissions();
  const [pendingCounts, setPendingCounts] = useState({ requests: 0, leave: 0, devices: 0, feedback: 0 });
  useEffect(() => {
    if (session?.role !== "team_leader") return;
    const refresh = () => api.get<typeof pendingCounts>("/notifications/pending-request-count")
      .then(({ data }) => setPendingCounts(data))
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [session?.role]);
  const teamItems = session?.role === "team_leader"
    ? [
        (hasPermission(permissions, "corrections.team_view") || hasPermission(permissions, "reports.team_view") || hasPermission(permissions, "employees.team_view")) && { href: "/requests", label: "Requests", icon: ClipboardEdit },
        hasPermission(permissions, "employees.team_view") && { href: "/team-employees", label: "Team Employees", icon: Users },
        hasPermission(permissions, "kundli.team_view") && { href: "/kundli", label: "Team Kundli", icon: NotebookPen },
      ].filter(Boolean) as typeof EMPLOYEE_NAV_ITEMS
    : [];
  const navItems = [...EMPLOYEE_NAV_ITEMS, ...teamItems]
    .filter((item) => !(session?.role === "team_leader" && item.href === "/daily-report"))
    .map((item) => {
    if (session?.role !== "team_leader") return item;
    if (item.href === "/attendance") return { ...item, label: "Attendance" };
    if (item.href === "/leave") return { ...item, label: "Leave" };
    return item;
    });

  return (
    <aside className="flex h-full w-full lg:w-60 flex-col border-r border-ink-200 bg-white">
      <div className="flex h-16 items-center justify-between border-b border-ink-200 px-5">
        <div className="flex items-center gap-2">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-sm font-semibold text-ink-900">
            {session?.role === "team_leader" ? "Team Leader" : "My Workspace"}
          </span>
        </div>
        {/* Close button - only on mobile */}
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
        {navItems.map(({ href, label, icon: Icon }) => {
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
            </Link>
          );
        })}
        {session?.role === "team_leader" && (
          <div className="mt-3 border-t border-ink-100 pt-3">
            <Link href="/admin-reports" onClick={onClose} className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", pathname === "/admin-reports" ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900")}>
              <FileBarChart size={17} /> Reports
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}
