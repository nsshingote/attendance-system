"use client";

/**
 * app/leave/page.tsx
 * Employee: request Leave (Paid/Carried/Unpaid) or Half
 * Day via a single "+ New Request" button with a type selector — both
 * show up together in "My Requests" with a Type column. View balance,
 * request encashment.
 * Admin/SuperAdmin: also decide on all pending leave requests, half day
 * requests and edit leave-category allocations.
 * approve/reject encashment requests.
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plus, Check, X, Calendar as CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import api, { getErrorMessage } from "@/lib/api";
import { useSession, isAdmin } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ExpandableText from "@/components/Common/ExpandableText";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import Badge from "@/components/Common/Badge";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";
import LeaveForm from "@/components/Leave/LeaveForm";
import LeaveTable, { LeaveRow } from "@/components/Leave/LeaveTable";
import LeaveSummary from "@/components/Leave/LeaveSummary";
import LeaveEncashment from "@/components/Leave/LeaveEncashment";
import HalfDayForm from "@/components/Attendance/HalfDayForm";
import WFHForm from "@/components/Attendance/WFHForm";
import MonthSelector from "@/components/Calendar/MonthSelector";

interface LeaveBalance {
  user_id: number;
  user_name: string;
  paid_leave_available_this_month: number;
  carried_leave: number;
  leave_encashed: number;
  total_leave_balance: number;
}

interface EncashmentRequest {
  id: number;
  user_id: number;
  user_name?: string;
  days: number;
  status: string;
  requested_at: string;
}

interface HalfDayRequestRow {
  id: number;
  user_id: number;
  user_name?: string;
  attendance_date: string;
  slot: string;
  reason: string | null;
  status: string;
  requested_at: string;
}

interface WFHRequestRow {
  id: number;
  user_id: number;
  user_name?: string;
  attendance_date: string;
  reason: string | null;
  status: string;
  requested_at: string;
}

interface UserOption {
  id: number;
  name: string;
}

function countPrivilegeLeaveDays(requests: LeaveRow[], year: number, month: number) {
  return requests.reduce((total, request) => {
    if (request.status !== "Approved") return total;
    if (request.allocations?.length) {
      return total + request.allocations.filter((allocation) => {
        const allocationDate = new Date(`${allocation.allocation_date}T00:00:00`);
        return allocation.leave_category === "Privilege"
          && allocationDate.getFullYear() === year
          && allocationDate.getMonth() + 1 === month;
      }).length;
    }

    if (request.leave_category !== "Privilege") return total;
    const current = new Date(`${request.from_date}T00:00:00`);
    const end = new Date(`${request.to_date}T00:00:00`);
    let count = 0;
    while (current <= end) {
      if (current.getFullYear() === year && current.getMonth() + 1 === month) count += 1;
      current.setDate(current.getDate() + 1);
    }
    return total + count;
  }, 0);
}

// A unified row shape so Leave and Half Day requests can render together
// in one "My Requests" table with a Type column.
interface UnifiedRequestRow {
  id: number;
  type: "Leave" | "Half Day" | "WFH";
  from_date: string;
  to_date: string;
  detail: string; // leave_category, or slot label for half day
  reason: string | null;
  status: string;
}

type Tab = "mine" | "all" | "halfday" | "wfh" | "encashment";

const SLOT_LABELS: Record<string, string> = {
  morning: "Morning (10:00 AM - 2:30 PM)",
  afternoon: "Afternoon (2:30 PM - 6:30 PM)",
};

export default function LeavePage() {
  const session = useSession();
  const admin = isAdmin(session?.role);
  const today = new Date();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [fromDate, setAdminFromDate] = useState<string>("");
  const [toDate, setAdminToDate] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);

  const [myRequests, setMyRequests] = useState<LeaveRow[]>([]);
  const [myHalfDayRequests, setMyHalfDayRequests] = useState<HalfDayRequestRow[]>([]);
  const [myWfhRequests, setMyWfhRequests] = useState<WFHRequestRow[]>([]);
  const [myEncashmentRequests, setMyEncashmentRequests] = useState<EncashmentRequest[]>([]);
  const [allRequests, setAllRequests] = useState<LeaveRow[]>([]);
  const [halfDayRequests, setHalfDayRequests] = useState<HalfDayRequestRow[]>([]);
  const [wfhRequests, setWfhRequests] = useState<WFHRequestRow[]>([]);
  const [encashmentRequests, setEncashmentRequests] = useState<EncashmentRequest[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("mine");
  const [allocationModalLeaveId, setAllocationModalLeaveId] = useState<number | null>(null);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [allocationRows, setAllocationRows] = useState<{ allocation_date: string; leave_category: string }[]>([]);

  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [newRequestType, setNewRequestType] = useState<"leave" | "halfday" | "wfh">("leave");

  // Fetch users for admin dropdown
  useEffect(() => {
    if (admin) {
      api
        .get<UserOption[]>("/users/")
        .then(({ data }) => setUsers(data))
        .catch(() => toast.error("Failed to load users"));
    }
  }, [admin]);

  const fetchAll = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      let params: any = {};
      
      // For admin viewing all employees with date range filter
      if (admin && selectedUserIds.length === 0 && fromDate && toDate) {
        params.from_date = fromDate;
        params.to_date = toDate;
      } else if (admin && selectedUserIds.length > 0) {
        // For admin filtering by specific employees with date range
        if (fromDate) params.from_date = fromDate;
        if (toDate) params.to_date = toDate;
      } else if (!admin) {
        // Employee viewing own requests - use month filter
        params.year = selectedYear;
        params.month = selectedMonth;
      }

      if (admin && selectedUserIds.length === 0) {
        // Admin viewing all employees - show approval tabs
        const [allLeaveRes, halfDayRes, encashmentRes, wfhRes] = await Promise.all([
          api.get<LeaveRow[]>("/leave/", { params }),
          api.get<HalfDayRequestRow[]>("/attendance/half-day-requests", { params }),
          api.get<EncashmentRequest[]>("/leave/encashment-requests", { params: { status_filter: "Pending" } }),
          api.get<WFHRequestRow[]>("/attendance/wfh", { params }).catch(() => ({ data: [] })),
        ]);

        setAllRequests(allLeaveRes.data || []);
        setHalfDayRequests(halfDayRes.data || []);
        setEncashmentRequests(encashmentRes.data || []);
        setWfhRequests(wfhRes.data || []);
        setMyRequests([]);
        setBalance(null);
        setMyHalfDayRequests([]);
        setMyEncashmentRequests([]);
        setMyWfhRequests([]);
      } else if (admin && selectedUserIds.length > 0) {
        // Admin filtering by specific employees
        const userLeavePromises = selectedUserIds.map((userId) =>
          api.get<LeaveRow[]>(`/leave/user/${userId}`, {
            params: fromDate || toDate ? params : { ...params, year: selectedYear, month: selectedMonth },
          }).catch(() => ({ data: [] }))
        );
        const userHalfDayPromises = selectedUserIds.map((userId) =>
          api.get<HalfDayRequestRow[]>(`/attendance/half-day-requests/user/${userId}`, {
            params: fromDate || toDate ? params : { ...params, year: selectedYear, month: selectedMonth },
          }).catch(() => ({ data: [] }))
        );
        const userWfhPromises = selectedUserIds.map((userId) =>
          api.get<WFHRequestRow[]>(`/attendance/wfh/user/${userId}`, {
            params: fromDate || toDate ? params : { ...params, year: selectedYear, month: selectedMonth },
          }).catch(() => ({ data: [] }))
        );

        const [leaveResults, halfDayResults, wfhResults] = await Promise.all([
          Promise.all(userLeavePromises),
          Promise.all(userHalfDayPromises),
          Promise.all(userWfhPromises),
        ]);

        setAllRequests(leaveResults.flatMap((r) => r.data || []));
        setHalfDayRequests(halfDayResults.flatMap((r) => r.data || []));
        setWfhRequests(wfhResults.flatMap((r) => r.data || []));
        setEncashmentRequests([]);
        setMyRequests([]);
        if (selectedUserIds.length === 1) {
          const { data } = await api.get<LeaveBalance>(`/leave/balance/${selectedUserIds[0]}`);
          setBalance(data);
        } else {
          setBalance(null);
        }
        setMyHalfDayRequests([]);
        setMyEncashmentRequests([]);
        setMyWfhRequests([]);
      } else {
        // Employee view - only their own
        const params: any = { year: selectedYear, month: selectedMonth };
        const [leaveRes, balanceRes, halfDayRes, encashmentRes, wfhRes] = await Promise.all([
          api.get<LeaveRow[]>("/leave/me", { params }),
          api.get<LeaveBalance>(`/leave/balance/${session.userId}`),
          api.get<HalfDayRequestRow[]>("/attendance/half-day-requests/me", { params }),
          api.get<EncashmentRequest[]>("/leave/encashment-requests/me", { params }).catch(() => ({ data: [] })),
          api.get<WFHRequestRow[]>("/attendance/wfh/me", { params }).catch(() => ({ data: [] })),
        ]);

        setMyRequests(leaveRes.data || []);
        setBalance(balanceRes.data || null);
        setMyHalfDayRequests(halfDayRes.data || []);
        setMyEncashmentRequests(encashmentRes.data || []);
        setMyWfhRequests(wfhRes.data || []);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [session?.userId, admin, selectedUserIds, fromDate, toDate, selectedYear, selectedMonth]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleDecide = async (
    id: number,
    status: "Approved" | "Rejected"
  ) => {
    if (!id) {
      toast.error("Invalid leave request ID");
      return;
    }
    try {
      await api.put(`/leave/${id}/decide`, { status });
      toast.success(`Leave request ${status.toLowerCase()}`);
      fetchAll();
    } catch (error) {
      console.error("Error approving leave:", error);
      toast.error(getErrorMessage(error));
    }
  };

  const openAllocationModal = (id: number) => {
    setAllocationModalLeaveId(id);
    setAllocationModalOpen(true);
    // find leave in lists
    const all = [...myRequests, ...allRequests];
    const leave = all.find((l: any) => l.id === id);
    if (!leave) {
      setAllocationRows([]);
      return;
    }
    // build rows: if server returned allocations, use them; otherwise derive from range
    if (leave.allocations && leave.allocations.length > 0) {
      setAllocationRows(
        leave.allocations.map((a) => ({ allocation_date: a.allocation_date, leave_category: a.leave_category }))
      );
      return;
    }
    // derive dates
    const from = new Date(`${leave.from_date}T00:00:00`);
    const to = new Date(`${leave.to_date}T00:00:00`);
    const rows: { allocation_date: string; leave_category: string }[] = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      rows.push({ allocation_date: format(d, "yyyy-MM-dd"), leave_category: leave.leave_category || "Unpaid" });
    }
    setAllocationRows(rows);
  };

  const handleDecideEncashment = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.put(`/leave/encash/${id}/decide`, { status });
      toast.success(`Encashment request ${status.toLowerCase()}`);
      fetchAll();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDecideHalfDay = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.put(`/attendance/half-day-requests/${id}`, { status });
      toast.success(`Half day request ${status.toLowerCase()}`);
      fetchAll();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDecideWfh = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await api.put(`/attendance/wfh/${id}`, { status });
      toast.success(`WFH request ${status.toLowerCase()}`);
      fetchAll();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // Merge my leave + half-day + WFH requests into one unified list
  const unifiedMyRequests: UnifiedRequestRow[] = [
    ...myRequests.map((r) => ({
      id: r.id,
      type: "Leave" as const,
      from_date: r.from_date,
      to_date: r.to_date,
      detail: r.allocation_summary || r.leave_category,
      reason: r.reason,
      status: r.status,
    })),
    ...myHalfDayRequests.map((r) => ({
      id: r.id,
      type: "Half Day" as const,
      from_date: r.attendance_date,
      to_date: r.attendance_date,
      detail: SLOT_LABELS[r.slot] ?? r.slot,
      reason: r.reason,
      status: r.status,
    })),
    ...myWfhRequests.map((r) => ({
      id: r.id,
      type: "WFH" as const,
      from_date: r.attendance_date,
      to_date: r.attendance_date,
      detail: "Work From Home",
      reason: r.reason,
      status: r.status,
    })),
  ].sort((a, b) => (a.from_date < b.from_date ? 1 : -1));

  const isViewingAllEmployees = admin && selectedUserIds.length === 0;
  const isViewingSpecificUsers = admin && selectedUserIds.length > 0;
  const isEmployee = !admin;
  const showBalance = Boolean(balance && (isEmployee || selectedUserIds.length === 1));
  const privilegeLeaveThisMonth = countPrivilegeLeaveDays(
    isEmployee ? myRequests : selectedUserIds.length === 1 ? allRequests : [],
    selectedYear,
    selectedMonth,
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Leave</h1>
            <p className="text-sm text-ink-500">
              {isViewingSpecificUsers
                ? `Viewing ${selectedUserIds.length} employee${selectedUserIds.length === 1 ? "" : "s"}`
                : isViewingAllEmployees
                ? "Viewing all employees"
                : "Request leave or a half day, and track your balance"}
            </p>
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Leave requests submitted at least 4 days in advance are accepted as Paid Leave. Requests submitted less than 4 days in advance are treated as LWP.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {admin && (
              <>
                <EmployeeMultiSelect
                  employees={users}
                  value={selectedUserIds}
                  onChange={setSelectedUserIds}
                  allLabel="All Employees"
                />
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setAdminFromDate(e.target.value)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                  placeholder="From Date"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setAdminToDate(e.target.value)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                  placeholder="To Date"
                />
              </>
            )}
            {(isEmployee || selectedUserIds.length === 1) && (
              <MonthSelector
                year={selectedYear}
                month={selectedMonth}
                onChange={(year, month) => {
                  setSelectedYear(year);
                  setSelectedMonth(month);
                }}
              />
            )}
            {(isEmployee || admin) && (
              <button
                onClick={() => {
                  setNewRequestType("leave");
                  setNewRequestOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                <Plus size={16} />
                New Request
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : (
          <>
            {/* Show balance for employees */}
            {showBalance && balance && (
              <LeaveSummary
                paidLeaveAvailableThisMonth={balance.paid_leave_available_this_month}
                carriedLeave={balance.carried_leave}
                leaveEncashed={balance.leave_encashed}
                totalLeaveBalance={balance.total_leave_balance}
                privilegeLeaveThisMonth={privilegeLeaveThisMonth}
              />
            )}
            {/* Show encashment for employees */}
            {isEmployee && balance && (
              <LeaveEncashment carriedLeave={balance.carried_leave} onSuccess={fetchAll} />
            )}

            <div className="flex flex-wrap rounded-lg border border-ink-200 bg-white p-0.5 text-sm w-fit">
              {isEmployee && (
                <button
                  onClick={() => setTab("mine")}
                  className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "mine" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                >
                  My Requests
                  {unifiedMyRequests.filter(r => r.status === "Pending").length > 0 && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      {unifiedMyRequests.filter(r => r.status === "Pending").length}
                    </span>
                  )}
                </button>
              )}
              {admin && (
                <>
                  <button
                    onClick={() => setTab("all")}
                    className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "all" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                  >
                    All Leave Requests
                    {allRequests.filter(r => r.status === "Pending").length > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        {allRequests.filter(r => r.status === "Pending").length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setTab("halfday")}
                    className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "halfday" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                  >
                    Half Day Requests
                    {halfDayRequests.filter(r => r.status === "Pending").length > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        {halfDayRequests.filter(r => r.status === "Pending").length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setTab("wfh")}
                    className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "wfh" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                  >
                    WFH Requests
                    {wfhRequests.filter(r => r.status === "Pending").length > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        {wfhRequests.filter(r => r.status === "Pending").length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setTab("encashment")}
                    className={`rounded-md px-3.5 py-1.5 font-medium ${tab === "encashment" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                  >
                    Encashment Requests
                    {encashmentRequests.filter(r => r.status === "Pending").length > 0 && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        {encashmentRequests.filter(r => r.status === "Pending").length}
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* My Requests tab - for employees or admin viewing specific user */}
            {isEmployee && tab === "mine" && (
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
                {unifiedMyRequests.length === 0 && myEncashmentRequests.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-ink-500">No requests found for this user.</p>
                  </div>
                ) : (
                  <>
                    {/* Leave, Half Day, and WFH Requests table */}
                    {unifiedMyRequests.length > 0 && (
                      <table className="w-full table-fixed text-left text-sm">
                        <thead>
                          <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium">Date</th>
                            <th className="px-4 py-3 font-medium">Details</th>
                            <th className="px-4 py-3 font-medium">Reason</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {unifiedMyRequests.map((r) => (
                            <tr key={`${r.type}-${r.id}`} className="hover:bg-ink-50/60">
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                    r.type === "Leave"
                                      ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"
                                      : r.type === "Half Day"
                                      ? "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200"
                                      : "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200"
                                  }`}
                                >
                                  {r.type}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-ink-700">
                                {r.from_date === r.to_date
                                  ? format(parseISO(r.from_date), "dd MMM yyyy")
                                  : `${format(parseISO(r.from_date), "dd MMM")} – ${format(parseISO(r.to_date), "dd MMM yyyy")}`}
                              </td>
                              <td className="px-4 py-3 text-ink-700">{r.detail}</td>
                              <td className="w-[16rem] max-w-[16rem] min-w-0 wrap-break-word whitespace-normal px-4 py-3 align-top leading-5 text-ink-600">
                                <ExpandableText text={r.reason} limit={42} />
                              </td>
                              <td className="px-4 py-3">
                                <Badge status={r.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {/* Encashment Requests section */}
                    {myEncashmentRequests.length > 0 && (
                      <>
                        <div className="border-t border-ink-200 px-4 py-2 bg-ink-50/50">
                          <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wider">Encashment Requests</h4>
                        </div>
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                              <th className="px-4 py-3 font-medium">Days</th>
                              <th className="px-4 py-3 font-medium">Requested</th>
                              <th className="px-4 py-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink-100">
                            {myEncashmentRequests.map((r) => (
                              <tr key={`encash-${r.id}`} className="hover:bg-ink-50/60">
                                <td className="px-4 py-3 text-ink-700">{r.days}</td>
                                <td className="px-4 py-3 text-ink-600">{format(parseISO(r.requested_at), "dd MMM yyyy")}</td>
                                <td className="px-4 py-3">
                                  <Badge status={r.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* All Leave Requests tab - only for admin viewing all employees */}
            {admin && tab === "all" && (
              <LeaveTable
                requests={allRequests}
                canDecide={admin}
                onDecide={handleDecide}
                onEditAllocations={(id) => openAllocationModal(id)}
              />
            )}

            {/* Half Day Requests tab - only for admin viewing all employees */}
            {admin && tab === "halfday" && (
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
                {halfDayRequests.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-ink-500">No half day requests found.</p>
                  </div>
                ) : (
                  <table className="w-full table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Slot</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {halfDayRequests.map((r) => (
                        <tr key={r.id} className="hover:bg-ink-50/60">
                          <td className="px-4 py-3 font-medium text-ink-900">{r.user_name ?? `User #${r.user_id}`}</td>
                          <td className="px-4 py-3 text-ink-700">{format(parseISO(r.attendance_date), "dd MMM yyyy")}</td>
                          <td className="px-4 py-3 text-ink-700">{SLOT_LABELS[r.slot] ?? r.slot}</td>
                          <td className="w-[16rem] max-w-[16rem] min-w-0 wrap-break-word whitespace-normal px-4 py-3 align-top leading-5 text-ink-600">
                            <ExpandableText text={r.reason} limit={42} />
                          </td>
                          <td className="px-4 py-3">
                            <Badge status={r.status} />
                          </td>
                          <td className="px-4 py-3">
                            {r.status === "Pending" ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => handleDecideHalfDay(r.id, "Approved")}
                                  className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                                  aria-label="Approve"
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  onClick={() => handleDecideHalfDay(r.id, "Rejected")}
                                  className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                  aria-label="Reject"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-ink-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* WFH Requests tab - only for admin viewing all employees */}
            {admin && tab === "wfh" && (
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
                {wfhRequests.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-ink-500">No WFH requests found.</p>
                  </div>
                ) : (
                  <table className="w-full table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {wfhRequests.map((r) => (
                        <tr key={r.id} className="hover:bg-ink-50/60">
                          <td className="px-4 py-3 font-medium text-ink-900">{r.user_name ?? `User #${r.user_id}`}</td>
                          <td className="px-4 py-3 text-ink-700">{format(parseISO(r.attendance_date), "dd MMM yyyy")}</td>
                          <td className="w-[16rem] max-w-[16rem] min-w-0 wrap-break-word whitespace-normal px-4 py-3 align-top leading-5 text-ink-600">
                            <ExpandableText text={r.reason} limit={42} />
                          </td>
                          <td className="px-4 py-3">
                            <Badge status={r.status} />
                          </td>
                          <td className="px-4 py-3">
                            {r.status === "Pending" ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => handleDecideWfh(r.id, "Approved")}
                                  className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                                  aria-label="Approve"
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  onClick={() => handleDecideWfh(r.id, "Rejected")}
                                  className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                  aria-label="Reject"
                                >
                                  <X size={15} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-ink-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Encashment Requests tab - only for admin viewing all employees */}
            {isViewingAllEmployees && tab === "encashment" && (
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-card">
                {encashmentRequests.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-ink-500">No pending encashment requests.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Days</th>
                        <th className="px-4 py-3 font-medium">Requested</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {encashmentRequests.map((r) => (
                        <tr key={r.id} className="hover:bg-ink-50/60">
                          <td className="px-4 py-3 font-medium text-ink-900">{r.user_name ?? `User #${r.user_id}`}</td>
                          <td className="px-4 py-3 text-ink-700">{r.days}</td>
                          <td className="px-4 py-3 text-ink-600">{format(parseISO(r.requested_at), "dd MMM yyyy")}</td>
                          <td className="px-4 py-3">
                            <Badge status={r.status} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleDecideEncashment(r.id, "Approved")}
                                className="rounded-md bg-green-50 p-1.5 text-green-700 hover:bg-green-100"
                                aria-label="Approve"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                onClick={() => handleDecideEncashment(r.id, "Rejected")}
                                className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                                aria-label="Reject"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={newRequestOpen} onClose={() => setNewRequestOpen(false)} title="New Request" size="md">
        <div className="mb-4 flex rounded-lg border border-ink-200 bg-ink-50 p-0.5 text-sm">
          <button
            onClick={() => setNewRequestType("leave")}
            className={`flex-1 rounded-md px-3.5 py-1.5 font-medium ${newRequestType === "leave" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"}`}
          >
            Leave
          </button>
          <button
            onClick={() => setNewRequestType("halfday")}
            className={`flex-1 rounded-md px-3.5 py-1.5 font-medium ${newRequestType === "halfday" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"}`}
          >
            Half Day
          </button>
          <button
            onClick={() => setNewRequestType("wfh")}
            className={`flex-1 rounded-md px-3.5 py-1.5 font-medium ${newRequestType === "wfh" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"}`}
          >
            WFH
          </button>
        </div>

        {newRequestType === "leave" ? (
          <LeaveForm
            onSuccess={() => {
              setNewRequestOpen(false);
              fetchAll();
            }}
            onCancel={() => setNewRequestOpen(false)}
          />
        ) : newRequestType === "halfday" ? (
          <HalfDayForm
            isAdmin={admin}
            onSuccess={() => {
              setNewRequestOpen(false);
              fetchAll();
            }}
            onCancel={() => setNewRequestOpen(false)}
          />
        ) : (
          <WFHForm
            isAdmin={admin}
            onSuccess={() => {
              setNewRequestOpen(false);
              fetchAll();
            }}
            onCancel={() => setNewRequestOpen(false)}
          />
        )}
      </Modal>

      <Modal isOpen={allocationModalOpen} onClose={() => setAllocationModalOpen(false)} title="Edit Allocations">
        <div className="space-y-3">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Category</th></tr></thead>
              <tbody>
                {allocationRows.map((row, index) => (
                  <tr key={row.allocation_date} className="border-b">
                    <td className="px-3 py-2">{new Date(row.allocation_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><select value={row.leave_category} onChange={(event) => setAllocationRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, leave_category: event.target.value } : item))} className="rounded border px-2 py-1 text-sm"><option>Paid</option><option>Carried</option><option>Unpaid</option><option>Privilege</option></select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAllocationModalOpen(false)} className="rounded border px-3 py-1">Cancel</button>
            <button onClick={async () => { if (!allocationModalLeaveId) return; try { await api.put(`/leave/${allocationModalLeaveId}/allocations`, { allocations: allocationRows }); toast.success("Allocations updated"); setAllocationModalOpen(false); fetchAll(); } catch (error) { toast.error(getErrorMessage(error)); } }} className="rounded bg-brand-500 px-3 py-1 text-white">Save</button>
          </div>
        </div>
      </Modal>

    </AppShell>
  );
}
