"use client";

/**
 * app/daily-report/page.tsx
 * Daily Report submission page.
 * Employees submit their daily report before checkout.
 * SuperAdmin is exempt from writing reports.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { getSession, isSuperAdmin } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ReportForm from "@/components/Reports/ReportForm";
import Loading from "@/components/Common/Loading";

export default function DailyReportPage() {
  const session = getSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Check if user is SuperAdmin (exempt from reports)
  useEffect(() => {
    if (isSuperAdmin(session?.role)) {
      toast.custom((t) => (
        <div
          className={`${
            t.visible ? 'animate-enter' : 'animate-leave'
          } max-w-md w-full bg-blue-50 border border-blue-200 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
        >
          <div className="flex-1 w-0 p-4">
            <div className="flex items-start">
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-blue-900">
                  ℹ️ SuperAdmin Exempt
                </p>
                <p className="mt-1 text-sm text-blue-700">
                  SuperAdmin is exempt from submitting daily reports.
                </p>
              </div>
            </div>
          </div>
          <div className="flex border-l border-blue-200">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 hover:text-blue-500 focus:outline-none"
            >
              Close
            </button>
          </div>
        </div>
      ), { duration: 3000 });
      
      router.push("/dashboard");
      return;
    }
    setLoading(false);
  }, [session, router]);

  const handleSuccess = () => {
    toast.success("Report submitted successfully!");
    router.push("/dashboard");
  };

  const handleCancel = () => {
    router.push("/dashboard");
  };

  if (loading) {
    return (
      <AppShell>
        <Loading fullScreen />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink-900">Daily Report</h1>
          <p className="text-sm text-ink-500">
            Please submit your daily report before checking out.
          </p>
          <p className="text-xs text-ink-400 mt-1">
            * SuperAdmin is exempt from submitting daily reports.
          </p>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <ReportForm
            userId={session?.userId}  // ← ADDED THIS
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </AppShell>
  );
}