"use client";

/**
 * components/EmployeeSidebar.tsx
 * Left navigation for the Employee role — a narrower set of pages
 * than AdminSidebar.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutDashboard, CalendarCheck, Plane, ClipboardEdit, FileText, X } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/attendance", label: "My Attendance", icon: CalendarCheck },
  { href: "/leave", label: "My Leave", icon: Plane },
  { href: "/daily-report", label: "Daily Report", icon: FileText },
  { href: "/corrections", label: "Corrections", icon: ClipboardEdit },
];

interface EmployeeSidebarProps {
  isMobile?: boolean;
  onClose?: () => void;
}

export default function EmployeeSidebar({ isMobile = false, onClose }: EmployeeSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-full lg:w-60 flex-col border-r border-ink-200 bg-white">
      <div className="flex h-16 items-center justify-between border-b border-ink-200 px-5">
        <div className="flex items-center gap-2">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-sm font-semibold text-ink-900">My Workspace</span>
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
    </aside>
  );
}