// "use client";

// /**
//  * components/Dashboard/EmployeeDashboard.tsx
//  * Employee landing dashboard: today's status, quick check-in/out, leave balance.
//  */

// import { useEffect, useState } from "react";
// import toast from "react-hot-toast";
// import { Plane, ClipboardEdit } from "lucide-react";
// import api, { getErrorMessage } from "@/lib/api";
// import Loading from "@/components/Common/Loading";
// import Badge from "@/components/Common/Badge";
// import CheckInButton from "@/components/Attendance/CheckInButton";
// import CheckOutButton from "@/components/Attendance/CheckOutButton";
// import StatCard from "./StatCard";

// interface EmployeeSnapshot {
//   check_in: string | null;
//   check_out: string | null;
//   today_status: string;
//   pending_leave_requests: number;
//   pending_corrections: number;
// }

// export default function EmployeeDashboard() {
//   const [snapshot, setSnapshot] = useState<EmployeeSnapshot | null>(null);
//   const [loading, setLoading] = useState(true);

//   const fetchSnapshot = async () => {
//     try {
//       const { data } = await api.get("/dashboard/me");
//       setSnapshot({
//         check_in: data.check_in || null,
//         check_out: data.check_out || null,
//         today_status: data.today_status || "Absent",
//         pending_leave_requests: data.pending_leave_requests || 0,
//         pending_corrections: data.pending_corrections || 0,
//       });
//     } catch (error) {
//       toast.error(getErrorMessage(error));
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchSnapshot();
//   }, []);

//   if (loading) return <Loading fullScreen />;
//   if (!snapshot) return <p className="text-sm text-ink-500">Unable to load your dashboard.</p>;

//   const checkedIn = snapshot.check_in !== null && snapshot.check_in !== undefined;
//   const checkedOut = snapshot.check_out !== null && snapshot.check_out !== undefined;

//   return (
//     <div className="w-full max-w-full overflow-x-hidden">
//       <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
//         <div>
//           <h1 className="text-lg md:text-xl font-semibold text-ink-900">My Dashboard</h1>
//           <p className="text-sm text-ink-500">Here&apos;s your snapshot for today</p>
//         </div>

//         <div className="rounded-xl border border-ink-200 bg-white p-4 md:p-6 shadow-card">
//           <div className="flex flex-wrap items-center justify-between gap-4">
//             <div>
//               <p className="text-sm text-ink-500">Today&apos;s Status</p>
//               <div className="mt-1.5">
//                 <Badge status={snapshot.today_status} />
//               </div>
//             </div>
//             <div className="flex gap-3">
//               <CheckInButton
//                 disabled={checkedIn}
//                 onSuccess={fetchSnapshot}
//               />
//               <CheckOutButton
//                 disabled={!checkedIn || checkedOut}
//                 onSuccess={fetchSnapshot}
//               />
//             </div>
//           </div>
//         </div>

//         <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
//           <StatCard label="Pending Leave Requests" value={snapshot.pending_leave_requests} icon={Plane} tone="amber" />
//           <StatCard label="Pending Corrections" value={snapshot.pending_corrections} icon={ClipboardEdit} tone="amber" />
//         </div>
//       </div>
//     </div>
//   );
// }


"use client";

/**
 * components/Dashboard/EmployeeDashboard.tsx
 * Employee landing dashboard: today's status, quick check-in/out, leave balance.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plane, ClipboardEdit } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";
import Badge from "@/components/Common/Badge";
import CheckInButton from "@/components/Attendance/CheckInButton";
import CheckOutButton from "@/components/Attendance/CheckOutButton";
import StatCard from "./StatCard";

interface EmployeeSnapshot {
  check_in: string | null;
  check_out: string | null;
  today_status: string;
  pending_leave_requests: number;
  pending_corrections: number;
}

export default function EmployeeDashboard() {
  const [snapshot, setSnapshot] = useState<EmployeeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/dashboard/me");
      setSnapshot({
        check_in: data.check_in || null,
        check_out: data.check_out || null,
        today_status: data.today_status || "Absent",
        pending_leave_requests: data.pending_leave_requests || 0,
        pending_corrections: data.pending_corrections || 0,
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  if (loading) return <Loading fullScreen />;
  if (!snapshot) return <p className="text-sm text-ink-500">Unable to load your dashboard.</p>;

  const checkedIn = snapshot.check_in !== null && snapshot.check_in !== undefined;
  const checkedOut = snapshot.check_out !== null && snapshot.check_out !== undefined;

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
        <div>
          <h1 className="text-lg md:text-xl font-semibold text-ink-900">My Dashboard</h1>
          <p className="text-sm text-ink-500">Here&apos;s your snapshot for today</p>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-4 md:p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-ink-500">Today&apos;s Status</p>
              <div className="mt-1.5">
                <Badge status={snapshot.today_status} />
              </div>
            </div>
            <div className="flex gap-3">
              <CheckInButton
                disabled={checkedIn}
                onSuccess={fetchSnapshot}
              />
              <CheckOutButton
                disabled={!checkedIn || checkedOut}
                onSuccess={fetchSnapshot}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Pending Leave Requests" value={snapshot.pending_leave_requests} icon={Plane} tone="amber" />
          <StatCard label="Pending Corrections" value={snapshot.pending_corrections} icon={ClipboardEdit} tone="amber" />
        </div>
      </div>
    </div>
  );
}