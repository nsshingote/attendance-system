
// "use client";

// /**
//  * app/attendance/page.tsx
//  * Employee: own attendance (table + calendar). Admin/SuperAdmin: same page
//  * but can pick any employee via a dropdown to view their records.
//  *
//  * Note: Half Day marking now lives on the Leave page only (app/leave/page.tsx).
//  */

// import { useEffect, useState, useCallback } from "react";
// import toast from "react-hot-toast";
// import api, { getErrorMessage } from "@/lib/api";
// import { getSession, isAdmin } from "@/lib/auth";
// import AppShell from "@/components/AppShell";
// import Loading from "@/components/Common/Loading";
// import Modal from "@/components/Common/Modal";
// import MonthSelector from "@/components/Calendar/MonthSelector";
// import UserCalendar from "@/components/Users/UserCalender";
// import AttendanceTable, { AttendanceRecord } from "@/components/Attendance/AttendanceTable";
// import CorrectionForm from "@/components/Corrections/Correctionform";
// import { Calendar as CalendarIcon } from "lucide-react";
// import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";

// interface UserOption {
//   id: number;
//   name: string;
// }

// interface ReportData {
//   attendance_date: string;
//   report_display: string | null;
// }

// export default function AttendancePage() {
//   const session = getSession();
//   const today = new Date();
//   const [year, setYear] = useState(today.getFullYear());
//   const [month, setMonth] = useState(today.getMonth() + 1);
//   const [view, setView] = useState<"table" | "calendar">("table");
  
//   // Date filter state
//   const [selectedDate, setSelectedDate] = useState<string>("");
//   const [showDatePicker, setShowDatePicker] = useState(false);
//   const [fromDate, setFromDate] = useState<string>("");
//   const [toDate, setToDate] = useState<string>("");

//   const [users, setUsers] = useState<UserOption[]>([]);
//   const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

//   const [records, setRecords] = useState<AttendanceRecord[]>([]);
//   const [summary, setSummary] = useState({ Present: 0, "Half Day": 0, Absent: 0, Holiday: 0, Leave: 0, WFH: 0 });
//   const [loading, setLoading] = useState(true);

//   const [correctionModal, setCorrectionModal] = useState<AttendanceRecord | null>(null);
//   const [submittingCorrection, setSubmittingCorrection] = useState(false);

//   const admin = isAdmin(session?.role);

//   useEffect(() => {
//     if (!admin) return;
//     api
//       .get<UserOption[]>("/users/")
//       .then(({ data }) => setUsers(data))
//       .catch(() => {});
//   }, [admin]);

//   const fetchData = useCallback(async () => {
//     setLoading(true);
//     try {
//       // Build params with date filter if selected
//       const params: any = { year, month };
//       if (fromDate && toDate) {
//         params.from_date = fromDate;
//         params.to_date = toDate;
//       } else if (selectedDate) {
//         params.date_value = selectedDate;
//       }

//       const attendanceUrl = admin ? "/attendance/all" : "/attendance/me";
//       if (admin && selectedUserIds.length) params.employee_ids = selectedUserIds;
//       const summaryUserId = selectedUserIds.length === 1 ? selectedUserIds[0] : session?.userId;

//       const [recordsRes, summaryRes] = await Promise.all([
//         api.get<AttendanceRecord[]>(attendanceUrl, { params, paramsSerializer: { indexes: null } }),
//         api.get(
//           `/attendance/summary/${
//             summaryUserId
//           }`,
//           { params: { year, month } }
//         ).catch(() => ({ data: {} })),
//       ]);

// const recordsWithReport = (recordsRes.data || []).map((record: any) => ({
//   ...record,
//   report:
//     typeof record.has_report === "boolean"
//       ? record.has_report
//         ? "Submitted"
//         : "Not Submitted"
//       : record.report || "Not Submitted",
// }));

// setRecords(recordsWithReport || []);

// setSummary(
//   summaryRes.data || {
//     Present: 0,
//     "Half Day": 0,
//     Absent: 0,
//     Holiday: 0,
//     Leave: 0,
//     WFH: 0,
//   }
// );
//     } catch (error) {
//       toast.error(getErrorMessage(error));
//       setRecords([]);
//     } finally {
//       setLoading(false);
//     }
//   }, [selectedUserIds, year, month, admin, session?.userId, selectedDate, fromDate, toDate]);

//   useEffect(() => {
//     fetchData();
//   }, [fetchData]);

//   // Clear date filter
//   const applyDateFilter = (dateValue: string) => {
//     setSelectedDate(dateValue);
//     setFromDate("");
//     setToDate("");
//     if (dateValue) {
//       const parsed = new Date(dateValue);
//       setYear(parsed.getFullYear());
//       setMonth(parsed.getMonth() + 1);
//     }
//   };

//   const clearDateFilter = () => {
//     setSelectedDate("");
//     setShowDatePicker(false);
//   };

//   const clearRangeFilter = () => {
//     setFromDate("");
//     setToDate("");
//   };

//   const submitCorrection = async () => {
//     if (!correctionModal) {
//       toast.error("No correction selected");
//       return;
//     }
//     setSubmittingCorrection(true);
//     try {
//       // This will be handled by the CorrectionForm component
//       setCorrectionModal(null);
//       toast.success("Correction request submitted");
//       fetchData();
//     } catch (error) {
//       toast.error(getErrorMessage(error));
//     } finally {
//       setSubmittingCorrection(false);
//     }
//   };

//   return (
//     <AppShell>
//       <div className="w-full max-w-full overflow-x-hidden">
//         <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
//           <div className="flex flex-wrap items-center justify-between gap-3">
//             <div>
//               <h1 className="text-lg md:text-xl font-semibold text-ink-900">Attendance</h1>
//               <p className="text-sm text-ink-500">
//                 {admin ? (selectedUserIds.length ? `Viewing ${selectedUserIds.length} employee${selectedUserIds.length === 1 ? "" : "s"}` : "Viewing all employees") : "Your attendance history"}
//               </p>
//             </div>

//             <div className="flex flex-wrap items-center gap-2">
//               {admin && (
//                 <EmployeeMultiSelect employees={users} value={selectedUserIds} onChange={setSelectedUserIds} />
//               )}

//               <div className="flex flex-wrap items-center gap-2">
//                 <label className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
//                   From
//                   <input
//                     type="date"
//                     value={fromDate}
//                     onChange={(e) => {
//                       setFromDate(e.target.value);
//                       setSelectedDate("");
//                     }}
//                     className="h-10 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
//                   />
//                 </label>
//                 <label className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
//                   To
//                   <input
//                     type="date"
//                     value={toDate}
//                     onChange={(e) => {
//                       setToDate(e.target.value);
//                       setSelectedDate("");
//                     }}
//                     className="h-10 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
//                   />
//                 </label>
//                 {(fromDate || toDate) && (
//                   <button
//                     onClick={clearRangeFilter}
//                     className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
//                   >
//                     Clear Range
//                   </button>
//                 )}
//               </div>

//               <div className="relative min-w-45">
//                 <button
//                   onClick={() => setShowDatePicker(!showDatePicker)}
//                   className={`flex min-w-0 items-center gap-1 rounded-lg border px-3 py-2 text-sm ${
//                     selectedDate ? "border-brand-500 bg-brand-50 text-brand-600" : "border-ink-200 bg-white text-ink-600"
//                   }`}
//                 >
//                   <CalendarIcon size={16} />
//                   {selectedDate ? new Date(selectedDate).toLocaleDateString() : "Date"}
//                   {selectedDate && (
//                     <span
//                       onClick={(e) => {
//                         e.stopPropagation();
//                         clearDateFilter();
//                       }}
//                       className="ml-1 cursor-pointer text-ink-400 hover:text-ink-600"
//                     >
//                       ×
//                     </span>
//                   )}
//                 </button>

//                 {showDatePicker && (
//                   <>
//                     <div
//                       className="fixed inset-0 z-40"
//                       onClick={() => setShowDatePicker(false)}
//                     />
//                     <div className="absolute right-0 top-full mt-1 z-50 min-w-55 w-65 rounded-lg border border-ink-200 bg-white p-3 shadow-lg">
//                       <input
//                         type="date"
//                         value={selectedDate}
//                         onChange={(e) => {
//                           applyDateFilter(e.target.value);
//                           setShowDatePicker(false);
//                         }}
//                         className="w-full rounded border border-ink-200 px-3 py-2 text-sm"
//                       />
//                       <div className="mt-2 flex flex-wrap gap-2">
//                         <button
//                           onClick={() => {
//                             const today = new Date().toISOString().split("T")[0];
//                             applyDateFilter(today);
//                             setShowDatePicker(false);
//                           }}
//                           className="flex-1 rounded bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
//                         >
//                           Today
//                         </button>
//                         <button
//                           onClick={clearDateFilter}
//                           className="flex-1 rounded border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50"
//                         >
//                           Clear
//                         </button>
//                       </div>
//                     </div>
//                   </>
//                 )}
//               </div>

//               <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
//                 <button
//                   onClick={() => setView("table")}
//                   className={`rounded-md px-3 py-1.5 font-medium ${view === "table" ? "bg-brand-500 text-white" : "text-ink-600"}`}
//                 >
//                   Table
//                 </button>
//                 <button
//                   onClick={() => setView("calendar")}
//                   className={`rounded-md px-3 py-1.5 font-medium ${view === "calendar" ? "bg-brand-500 text-white" : "text-ink-600"}`}
//                 >
//                   Calendar
//                 </button>
//               </div>

//               <MonthSelector
//                 year={year}
//                 month={month}
//                 onChange={(y, m) => {
//                   setYear(y);
//                   setMonth(m);
//                   // Clear date/date-range filters when month changes
//                   if (selectedDate) clearDateFilter();
//                   if (fromDate || toDate) clearRangeFilter();
//                 }}
//               />
//             </div>
//           </div>

//           {/* Show active filters */}
//           {selectedDate && (
//             <div className="flex items-center gap-2 text-sm text-ink-600">
//               <span className="font-medium">Filtering by date:</span>
//               <span className="rounded bg-brand-50 px-2 py-1 text-brand-700">
//                 {new Date(selectedDate).toLocaleDateString()}
//               </span>
//               <button
//                 onClick={clearDateFilter}
//                 className="text-ink-400 hover:text-ink-600"
//               >
//                 × Clear
//               </button>
//             </div>
//           )}

//           {loading ? (
//             <Loading />
//           ) : view === "table" ? (
//             <AttendanceTable
//               records={records}
//               showRequestCorrection={!admin || selectedUserIds.length === 1 && selectedUserIds[0] === session?.userId}
//               onRequestCorrection={setCorrectionModal}
//               showEmployeeName={admin}
//             />
//           ) : (
//             <div className="space-y-3">
//               <UserCalendar
//                 userId={selectedUserIds.length === 1 ? selectedUserIds[0] : -1}
//                 employeeIds={selectedUserIds}
//                 year={year}
//                 month={month}
//                 selectedDate={selectedDate || undefined}
//               />
//             </div>
//           )}
//         </div>
//       </div>

//       <Modal
//         isOpen={!!correctionModal}
//         onClose={() => setCorrectionModal(null)}
//         title="Request Attendance Correction"
//       >
//         {correctionModal && (
//           <CorrectionForm
//             attendanceId={correctionModal.id}
//             attendanceDate={correctionModal.attendance_date}
//             onSuccess={() => {
//               setCorrectionModal(null);
//               fetchData();
//             }}
//             onCancel={() => setCorrectionModal(null)}
//           />
//         )}
//       </Modal>
//     </AppShell>
//   );
// }
 
"use client";

/**
 * app/attendance/page.tsx
 * Employee: own attendance (table + calendar). Admin/SuperAdmin: same page
 * but can pick any employee via a dropdown to view their records.
 *
 * Note: Half Day marking now lives on the Leave page only (app/leave/page.tsx).
 */

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isAdmin } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import MonthSelector from "@/components/Calendar/MonthSelector";
import UserCalendar from "@/components/Users/UserCalender";
import AttendanceTable, { AttendanceRecord } from "@/components/Attendance/AttendanceTable";
import CorrectionForm from "@/components/Corrections/Correctionform";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";

interface UserOption {
  id: number;
  name: string;
}

interface DepartmentOption {
  id: number;
  name: string;
}

interface ReportData {
  attendance_date: string;
  report_display: string | null;
}

type PageAttendanceRecord = AttendanceRecord & {
  user_id: number;
  leave_category?: string | null;
};

export default function AttendancePage() {
  const session = getSession();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [view, setView] = useState<"table" | "calendar">("table");

  // Date range filter state
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [users, setUsers] = useState<UserOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | "">("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string>("");
  const [calendarSelectedStatus, setCalendarSelectedStatus] = useState<string>("Present");
  const [calendarLeaveCategory, setCalendarLeaveCategory] = useState<string>("Paid");
  const [calendarSelectedUserId, setCalendarSelectedUserId] = useState<number | null>(null);
  const [savingCalendarOverride, setSavingCalendarOverride] = useState(false);
  const [calendarEnterTimes, setCalendarEnterTimes] = useState<boolean>(false);
  const [calendarCheckInTime, setCalendarCheckInTime] = useState<string>("");
  const [calendarCheckOutTime, setCalendarCheckOutTime] = useState<string>("");

  const [records, setRecords] = useState<PageAttendanceRecord[]>([]);
  const [summary, setSummary] = useState({ Present: 0, Late: 0, "Half Day": 0, Absent: 0, Holiday: 0, Leave: 0, WFH: 0 });
  const [loading, setLoading] = useState(true);

  const [correctionModal, setCorrectionModal] = useState<PageAttendanceRecord | null>(null);
  const [manualOverrideModal, setManualOverrideModal] = useState<PageAttendanceRecord | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<string>("Present");
  const [leaveCategory, setLeaveCategory] = useState<string>("Paid");
  const [enterTimes, setEnterTimes] = useState<boolean>(false);
  const [checkInTime, setCheckInTime] = useState<string>("");
  const [checkOutTime, setCheckOutTime] = useState<string>("");
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  const admin = isAdmin(session?.role);

  const normalizeOverrideStatus = (status: string) => {
    return status;
  };

  const saveSelectedCalendarOverride = async () => {
    if (!calendarSelectedDate || !calendarSelectedUserId) {
      toast.error("Choose a user and date before applying an override.");
      return;
    }

    setSavingCalendarOverride(true);
    try {
      const normalizedStatus = normalizeOverrideStatus(calendarSelectedStatus);
      const payload: any = {
        status: normalizedStatus,
        check_in: null,
        check_out: null,
      };

      if (normalizedStatus === "On Leave") {
        payload.leave_category = calendarLeaveCategory;
      } else if (calendarEnterTimes) {
        payload.check_in = calendarCheckInTime ? `${calendarSelectedDate}T${calendarCheckInTime}:00` : null;
        payload.check_out = calendarCheckOutTime ? `${calendarSelectedDate}T${calendarCheckOutTime}:00` : null;
      }

      await api.put(`/attendance/user/${calendarSelectedUserId}/date/${calendarSelectedDate}`, payload);
      toast.success("Attendance override saved");
      setCalendarSelectedStatus(calendarSelectedStatus);
      setCalendarRefreshKey((key) => key + 1);
      await fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingCalendarOverride(false);
    }
  };

  const handleSaveManualOverride = async () => {
    if (!manualOverrideModal) return;
    setSubmittingOverride(true);

    try {
      const normalizedOverrideStatus = normalizeOverrideStatus(overrideStatus);
      const payload: any = { status: normalizedOverrideStatus };

      if (normalizedOverrideStatus === "On Leave") {
        payload.leave_category = leaveCategory;
        payload.check_in = null;
        payload.check_out = null;
      } else if (enterTimes) {
        payload.check_in = checkInTime ? `${manualOverrideModal.attendance_date}T${checkInTime}:00` : null;
        payload.check_out = checkOutTime ? `${manualOverrideModal.attendance_date}T${checkOutTime}:00` : null;
      } else {
        payload.check_in = null;
        payload.check_out = null;
      }

      await api.put(`/attendance/user/${manualOverrideModal.user_id}/date/${manualOverrideModal.attendance_date}`, payload);
      toast.success("Attendance override saved");
      setManualOverrideModal(null);
      setCalendarRefreshKey((key) => key + 1);
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmittingOverride(false);
    }
  };

  useEffect(() => {
    if (!admin) return;

    api.get<UserOption[]>('/users/')
      .then(({ data }) => setUsers(data))
      .catch(() => {});
  }, [admin]);

  useEffect(() => {
    if (!admin) return;

    api
      .get<DepartmentOption[]>('/reports/departments')
      .then(({ data }) => setDepartments(data))
      .catch(() => {});
  }, [admin]);

  useEffect(() => {
    if (!manualOverrideModal) {
      setEnterTimes(false);
      setCheckInTime("");
      setCheckOutTime("");
      return;
    }

    const toTimeInput = (isoString?: string | null) => {
      if (!isoString) return "";
      const date = new Date(isoString);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    };

    setOverrideStatus(manualOverrideModal.status || "Present");
    setLeaveCategory(manualOverrideModal.leave_category || "Paid");
    setEnterTimes(Boolean(manualOverrideModal.check_in || manualOverrideModal.check_out));
    setCheckInTime(toTimeInput(manualOverrideModal.check_in));
    setCheckOutTime(toTimeInput(manualOverrideModal.check_out));
  }, [manualOverrideModal]);

  useEffect(() => {
    setCalendarEnterTimes(false);
    setCalendarCheckInTime("");
    setCalendarCheckOutTime("");
  }, [calendarSelectedDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Build params with date range filter if selected
      const params: any = { year, month };
      if (fromDate && toDate) {
        params.from_date = fromDate;
        params.to_date = toDate;
      }

      const attendanceUrl = admin ? "/attendance/all" : "/attendance/me";
      if (admin && selectedUserIds.length) params.employee_ids = selectedUserIds;
      if (admin && selectedDepartmentId) params.department_id = selectedDepartmentId;
      const summaryUserId = selectedUserIds.length === 1 ? selectedUserIds[0] : session?.userId;

      const [recordsRes, summaryRes] = await Promise.all([
        api.get<PageAttendanceRecord[]>(attendanceUrl, { params, paramsSerializer: { indexes: null } }),
        api.get(
          `/attendance/summary/${
            summaryUserId
          }`,
          { params: { year, month } }
        ).catch(() => ({ data: {} })),
      ]);

const recordsWithReport = (recordsRes.data || []).map((record: any) => ({
  ...record,
  report:
    typeof record.has_report === "boolean"
      ? record.has_report
        ? "Submitted"
        : "Not Submitted"
      : record.report || "Not Submitted",
}));

setRecords(recordsWithReport || []);

setSummary(
  summaryRes.data || {
    Present: 0,
    Late: 0,
    "Half Day": 0,
    Absent: 0,
    Holiday: 0,
    Leave: 0,
    WFH: 0,
  }
);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [selectedUserIds, selectedDepartmentId, year, month, admin, session?.userId, fromDate, toDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const clearRangeFilter = () => {
    setFromDate("");
    setToDate("");
  };

  const submitCorrection = async () => {
    if (!correctionModal) {
      toast.error("No correction selected");
      return;
    }
    setSubmittingCorrection(true);
    try {
      // This will be handled by the CorrectionForm component
      setCorrectionModal(null);
      toast.success("Correction request submitted");
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmittingCorrection(false);
    }
  };

  return (
    <AppShell>
      <div className="w-full max-w-full overflow-x-hidden">
        <div className="space-y-4 md:space-y-6 pb-4 md:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg md:text-xl font-semibold text-ink-900">Attendance</h1>
              <p className="text-sm text-ink-500">
                {admin ? (selectedUserIds.length ? `Viewing ${selectedUserIds.length} employee${selectedUserIds.length === 1 ? "" : "s"}` : "Viewing all employees") : "Your attendance history"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {admin && (
                <>
                  <EmployeeMultiSelect employees={users} value={selectedUserIds} onChange={setSelectedUserIds} />
                  <label className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
                    Department
                    <select
                      value={selectedDepartmentId}
                      onChange={(e) => setSelectedDepartmentId(e.target.value ? Number(e.target.value) : "")}
                      className="h-10 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
                    >
                      <option value="">All Departments</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-10 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
                />
              </label>
              <label className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-10 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  onClick={clearRangeFilter}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600 hover:bg-ink-50"
                >
                  Clear Range
                </button>
              )}

              <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
                <button
                  onClick={() => setView("table")}
                  className={`rounded-md px-3 py-1.5 font-medium ${view === "table" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                >
                  Table
                </button>
                <button
                  onClick={() => setView("calendar")}
                  className={`rounded-md px-3 py-1.5 font-medium ${view === "calendar" ? "bg-brand-500 text-white" : "text-ink-600"}`}
                >
                  Calendar
                </button>
              </div>

              {view === "calendar" && (
                <MonthSelector
                  year={year}
                  month={month}
                  onChange={(y, m) => { setYear(y); setMonth(m); }}
                />
              )}
            </div>
          </div>

          {loading ? (
            <Loading />
          ) : view === "table" ? (
            <AttendanceTable
              records={records}
              showRequestCorrection={!admin || (selectedUserIds.length === 1 && selectedUserIds[0] === session?.userId)}
              onRequestCorrection={setCorrectionModal}
              showEmployeeName={admin}
              showAdminActions={admin}
              onManualOverride={(record) => {
                setManualOverrideModal(record);
                setOverrideStatus(record.status);
              }}
            />
          ) : (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <div className="w-full">
                <UserCalendar
                  userId={selectedUserIds.length === 1 ? selectedUserIds[0] : -1}
                  employeeIds={selectedUserIds.length > 1 ? selectedUserIds : undefined}
                  departmentId={selectedDepartmentId || undefined}
                  year={year}
                  month={month}
                  canOverride={admin && selectedUserIds.length === 1}
                  refreshKey={calendarRefreshKey}
                  selectedDate={calendarSelectedDate || undefined}
                  onOverrideSaved={() => {
                    setCalendarRefreshKey((k) => k + 1);
                    fetchData();
                  }}
                  onSelectDay={(day) => {
                    const nextStatus = day.working_day_label === "Extra Working Day"
                      ? "Extra Working Day"
                      : (day.status || "Present");
                    setCalendarSelectedDate(day.date);
                    setCalendarSelectedStatus(nextStatus);
                    setCalendarSelectedUserId(selectedUserIds.length === 1 ? selectedUserIds[0] : null);
                  }}
                />
              </div>

              {calendarSelectedDate && calendarSelectedUserId && (
                <div className="w-full rounded-xl border border-ink-200 bg-white p-4 shadow-card">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">Override Status</p>
                      <p className="text-xs text-ink-500">
                        {new Date(calendarSelectedDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <span className="rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-700">Employee #{calendarSelectedUserId}</span>
                  </div>
                  <label className="block text-sm font-medium text-ink-700">
                    Status
                    <select
                      value={calendarSelectedStatus}
                      onChange={(e) => {
                        const nextStatus = e.target.value;
                        setCalendarSelectedStatus(nextStatus);
                        if (nextStatus === "On Leave") {
                          setCalendarEnterTimes(false);
                          setCalendarCheckInTime("");
                          setCalendarCheckOutTime("");
                        }
                        if (nextStatus !== "On Leave") {
                          setCalendarLeaveCategory("Paid");
                        }
                      }}
                      className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                    >
                      {[
                        "Present",
                        "Late",
                        "Absent",
                        "WFH",
                        "Half Day",
                        "Extra Working Day",
                      ].map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  {calendarSelectedStatus === "On Leave" && (
                    <label className="mt-3 block text-sm font-medium text-ink-700">
                      Leave category
                      <select value={calendarLeaveCategory} onChange={(e) => setCalendarLeaveCategory(e.target.value)} className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm">
                        <option value="Paid">Paid</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Carried">Carried</option>
                      </select>
                    </label>
                  )}
                  {calendarSelectedStatus !== "On Leave" && (
                    <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-4">
                      <p className="mb-2 text-sm font-medium text-ink-700">Do you want to fill Check-in and Check-out time?</p>
                      <div className="flex flex-wrap gap-2">
                        <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${calendarEnterTimes ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                          <input
                            type="radio"
                            name="calendarEnterTimes"
                            checked={calendarEnterTimes}
                            onChange={() => setCalendarEnterTimes(true)}
                            className="mr-2 h-4 w-4"
                          />
                          Yes
                        </label>
                        <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${!calendarEnterTimes ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                          <input
                            type="radio"
                            name="calendarEnterTimes"
                            checked={!calendarEnterTimes}
                            onChange={() => {
                              setCalendarEnterTimes(false);
                              setCalendarCheckInTime("");
                              setCalendarCheckOutTime("");
                            }}
                            className="mr-2 h-4 w-4"
                          />
                          No
                        </label>
                      </div>
                      {calendarEnterTimes && (
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm text-ink-600">
                            Check In
                            <input
                              type="time"
                              value={calendarCheckInTime}
                              onChange={(e) => setCalendarCheckInTime(e.target.value)}
                              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-sm text-ink-600">
                            Check Out
                            <input
                              type="time"
                              value={calendarCheckOutTime}
                              onChange={(e) => setCalendarCheckOutTime(e.target.value)}
                              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={saveSelectedCalendarOverride}
                    disabled={savingCalendarOverride}
                    className="mt-3 inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-200"
                  >
                    {savingCalendarOverride ? "Saving..." : "Apply Override"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={!!correctionModal}
        onClose={() => setCorrectionModal(null)}
        title="Request Attendance Correction"
      >
        {correctionModal && (
          <CorrectionForm
            attendanceId={correctionModal.id}
            attendanceDate={correctionModal.attendance_date}
            onSuccess={() => {
              setCorrectionModal(null);
              fetchData();
            }}
            onCancel={() => setCorrectionModal(null)}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!manualOverrideModal}
        onClose={() => setManualOverrideModal(null)}
        title="Manual Attendance Override"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setManualOverrideModal(null)}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveManualOverride}
              disabled={submittingOverride}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-200"
            >
              {submittingOverride ? "Saving..." : "Save Override"}
            </button>
          </div>
        }
      >
        {manualOverrideModal && (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              Override attendance for <strong>{manualOverrideModal.user_name ?? `User #${manualOverrideModal.user_id}`}</strong> on <strong>{new Date(manualOverrideModal.attendance_date).toLocaleDateString()}</strong>.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Status</label>
              <select
                value={overrideStatus}
                onChange={(e) => {
                  setOverrideStatus(e.target.value);
                  if (e.target.value === "On Leave") {
                    setEnterTimes(false);
                    setCheckInTime("");
                    setCheckOutTime("");
                  }
                }}
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
              >
                {[
                  "Present",
                  "Late",
                  "Half Day",
                  "Absent",
                  "WFH",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            {overrideStatus === "On Leave" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Leave Category</label>
                <select
                  value={leaveCategory}
                  onChange={(e) => setLeaveCategory(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                >
                  {[
                    "Paid",
                    "Carried",
                    "Unpaid",
                    "Privilege",
                  ].map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-ink-500">
                  Leave overrides create a one-day approved leave record and mark attendance as On Leave.
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Enter Check-in/Check-out time?</label>
                <div className="flex flex-wrap gap-2">
                  <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${enterTimes ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                    <input
                      type="radio"
                      name="enterTimes"
                      checked={enterTimes}
                      onChange={() => setEnterTimes(true)}
                      className="mr-2 h-4 w-4"
                    />
                    Yes
                  </label>
                  <label className={`flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm ${!enterTimes ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700"}`}>
                    <input
                      type="radio"
                      name="enterTimes"
                      checked={!enterTimes}
                      onChange={() => setEnterTimes(false)}
                      className="mr-2 h-4 w-4"
                    />
                    No
                  </label>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Choose No to clear any existing check-in/check-out times and save only the override status.
                </p>
              </div>
            )}

            {enterTimes && overrideStatus !== "On Leave" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Check In</label>
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Check Out</label>
                  <input
                    type="time"
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-ink-500">
              This override is persistent and will be used instead of automatic status calculation for this record.
            </p>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
