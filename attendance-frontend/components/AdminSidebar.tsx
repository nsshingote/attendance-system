"use client";

/**
 * components/AdminSidebar.tsx
 * Left navigation for Admin & Super Admin roles.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  FileText,
  FileSearch,
  X,
  Layers,
  MessageSquare,
  FolderOpen,
  NotebookPen,
  BookOpen,
} from "lucide-react";
import { getSession, isSuperAdmin } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/employee-documents", label: "Employee Documents", icon: FolderOpen },
  { href: "/kundli", label: "Kundli", icon: NotebookPen },
  { href: "/admin/report-structure", label: "Report Structure", icon: Layers },
  { href: "/manage-departments", label: "Manage Departments", icon: Layers },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/leave", label: "Leave", icon: Plane },
  { href: "/daily-report", label: "Daily Report", icon: FileText },
  { href: "/admin-reports", label: "Team Reports", icon: FileSearch },
  { href: "/corrections", label: "Corrections", icon: ClipboardEdit },
  { href: "/holidays", label: "Holidays", icon: CalendarDays },
  { href: "/reports", label: "Monthly Reports", icon: FileBarChart },
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
