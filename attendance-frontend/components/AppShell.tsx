"use client";

/**
 * components/AppShell.tsx
 * Shared shell for every authenticated page.
 */

import { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { isAuthenticated, getSession, isAdmin, Role } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import AdminSidebar from "@/components/AdminSidebar";
import EmployeeSidebar from "@/components/EmployeeSidebar";
import Loading from "@/components/Common/Loading";
import { hasPermission, usePermissions } from "@/lib/permissions";

interface AppShellProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

const ADMIN_ROUTE_PERMISSIONS: Array<{ path: string; permission: string; alternatives?: string[] }> = [
  { path: "/employee-documents", permission: "employee_documents.letters.view", alternatives: ["employee_documents.salary_slips.view", "employee_documents.letter_templates.view"] },
  { path: "/admin/report-structure", permission: "report_structure.view" }, { path: "/manage-departments", permission: "departments.view" },
  { path: "/notification-emails", permission: "notification_emails.view" }, { path: "/device-requests", permission: "device_requests.view" },
  { path: "/activity-logs", permission: "activity_logs.view" }, { path: "/recycle-bin", permission: "recycle_bin.view" },
  { path: "/changed-logs", permission: "changed_logs.view" }, { path: "/office-ip", permission: "office_ips.view" },
  { path: "/admin-reports", permission: "reports.all_view" }, { path: "/attendance", permission: "attendance.all_view" },
  { path: "/leave", permission: "leave.all_view" }, { path: "/reports", permission: "monthly_summary.view" },
  { path: "/requests", permission: "requests.view" }, { path: "/holidays", permission: "holidays.view" },
  { path: "/resources", permission: "resources.view" }, { path: "/teams", permission: "teams.view" },
  { path: "/users", permission: "employees.all_view" }, { path: "/kundli", permission: "kundli.team_view" },
  { path: "/feedback", permission: "feedback.view" }, { path: "/settings", permission: "settings.view" },
];

export default function AppShell({ children, allowedRoles }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const [ready, setReady] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    const session = getSession();
    if (allowedRoles && session && !allowedRoles.includes(session.role)) {
      router.replace("/dashboard");
      return;
    }

    // Authentication is established asynchronously after the client session is read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [router, allowedRoles]);

  useEffect(() => {
    const session = getSession();
    if (!ready || permissionsLoading || session?.role !== "admin" || !pathname) return;
    const rule = ADMIN_ROUTE_PERMISSIONS.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
    if (rule && !hasPermission(permissions, rule.permission) && !rule.alternatives?.some((key) => hasPermission(permissions, key))) {
      router.replace("/dashboard");
    }
  }, [pathname, permissions, permissionsLoading, ready, router]);

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMobileSidebarOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setIsMobileSidebarOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobileSidebarOpen]);

  // Close sidebar on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMobileSidebarOpen]);

  if (!ready || permissionsLoading) {
    return <Loading fullScreen />;
  }

  const session = getSession();
  const isUserAdmin = isAdmin(session?.role);
  const SidebarComponent = isUserAdmin ? AdminSidebar : EmployeeSidebar;

  const toggleMobileSidebar = () => {
    setIsMobileSidebarOpen(!isMobileSidebarOpen);
  };

  return (
    <div className="flex h-dvh w-full bg-ink-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block h-full shrink-0">
        <SidebarComponent isMobile={false} />
      </div>

      {/* Mobile Sidebar Overlay */}
      <div
        className={clsx(
          "lg:hidden fixed inset-0 z-50 transition-opacity duration-300",
          isMobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="absolute inset-0 bg-black/50" onClick={() => setIsMobileSidebarOpen(false)} />
        <div
          ref={sidebarRef}
          className={clsx(
            "absolute left-0 top-0 h-full w-72 bg-white shadow-xl transition-transform duration-300 ease-in-out",
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <SidebarComponent isMobile={true} onClose={() => setIsMobileSidebarOpen(false)} />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Navbar onMenuClick={toggleMobileSidebar} />
        
        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6">
          <div className="max-w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
