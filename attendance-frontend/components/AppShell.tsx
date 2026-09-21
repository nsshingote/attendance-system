"use client";

/**
 * components/AppShell.tsx
 * Shared shell for every authenticated page.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { isAuthenticated, getSession, isAdmin, Role } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import AdminSidebar from "@/components/AdminSidebar";
import EmployeeSidebar from "@/components/EmployeeSidebar";
import Loading from "@/components/Common/Loading";
import { hasPermission, refreshPermissions, usePermissions } from "@/lib/permissions";

interface AppShellProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  requiredPermission?: string;
  alternativePermissions?: string[];
}

export default function AppShell({ children, allowedRoles, requiredPermission, alternativePermissions = [] }: AppShellProps) {
  const router = useRouter();
  const { permissions, loading: permissionsLoading, error: permissionsError } = usePermissions();
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
    if (!ready || permissionsLoading || permissionsError) return;
    if (session?.role === "superadmin") return;
    if (requiredPermission && !hasPermission(permissions, requiredPermission) &&
      !alternativePermissions.some((key) => hasPermission(permissions, key))) {
      router.replace("/dashboard");
      return;
    }
  }, [permissions, permissionsLoading, permissionsError, ready, requiredPermission, alternativePermissions, router]);

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
  if (permissionsError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-50 p-6">
        <div className="rounded-xl border border-ink-200 bg-white p-6 text-center shadow-card">
          <p className="text-sm text-ink-700">Unable to load permissions.</p>
          <button onClick={() => void refreshPermissions()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const session = getSession();
  const hasAdminNavigation = permissions.some((permission) =>
    permission.endsWith(".all_view") ||
    permission.endsWith(".manage") ||
    permission.endsWith(".approve")
  );
  const SidebarComponent = isAdmin(session?.role) || hasAdminNavigation ? AdminSidebar : EmployeeSidebar;

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
