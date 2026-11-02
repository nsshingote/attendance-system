"use client";

/**
 * app/holidays/page.tsx
 * Admin/SuperAdmin: add/delete holidays; employees see a read-only list.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import toast from "react-hot-toast";
import { CalendarDays, Download, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";
import HolidayCalendar from "@/components/Holidays/HolidayCalendar";
import { hasPermission, usePermissions } from "@/lib/permissions";

interface Holiday {
  id: number;
  holiday_date: string;
  holiday_name: string;
  applies_to: string;
  user_ids: number[];
  team_ids: number[];
  user_names: string[];
  team_names: string[];
}

interface UserOption {
  id: number;
  name: string;
  attendance_mode?: "office" | "onsite" | null;
}

interface TeamOption {
  id: number;
  name: string;
}

interface WorkingDayAssignment {
  id: number;
  user_id: number;
  work_date: string;
  marked_by: number | null;
  created_at: string;
}

export default function HolidaysPage() {
  const { permissions } = usePermissions();
  const admin = hasPermission(permissions, "holidays.manage");
  const canViewWorkingDays = hasPermission(permissions, "attendance.all_view");

  const [holidaysByYear, setHolidaysByYear] = useState<Record<number, Holiday[]>>({});
  const [failedYears, setFailedYears] = useState<number[]>([]);
  const [workingDaysByYear, setWorkingDaysByYear] = useState<Record<number, WorkingDayAssignment[]>>({});
  const [failedWorkingDayYears, setFailedWorkingDayYears] = useState<number[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeMonth, setActiveMonth] = useState(() => startOfMonth(new Date()));
  const [selectedRange, setSelectedRange] = useState<{ start: string; end: string } | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [newName, setNewName] = useState("");
  const [appliesTo, setAppliesTo] = useState("all_users");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [selectedWorkDate, setSelectedWorkDate] = useState("");
  const [workingSundaySubmitting, setWorkingSundaySubmitting] = useState(false);
  const submissionLock = useRef(false);
  const holidayRequests = useRef(new Map<number, Promise<Holiday[]>>());

  const visibleDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(activeMonth)),
    end: endOfWeek(endOfMonth(activeMonth)),
  });
  const visibleYears = Array.from(new Set(visibleDays.map((day) => day.getFullYear())));
  const visibleYearsKey = visibleYears.join(",");
  const holidays = visibleYears.flatMap((year) => holidaysByYear[year] ?? []);
  const loading = visibleYears.some((year) => !(year in holidaysByYear) && !failedYears.includes(year));
  const visibleFailedYears = visibleYears.filter((year) => failedYears.includes(year));
  const calendarYear = activeMonth.getFullYear();
  const selectedYearHolidays = holidaysByYear[calendarYear] ?? [];
  const selectedYearLoading = !(calendarYear in holidaysByYear) && !failedYears.includes(calendarYear);
  const workingDaysLoading = canViewWorkingDays &&
    !(calendarYear in workingDaysByYear) &&
    !failedWorkingDayYears.includes(calendarYear);
  const canExportCalendar = canViewWorkingDays &&
    calendarYear in holidaysByYear &&
    !failedYears.includes(calendarYear) &&
    calendarYear in workingDaysByYear &&
    !failedWorkingDayYears.includes(calendarYear) &&
    !workingDaysLoading;

  const loadHolidayYear = useCallback((year: number) => {
    const pending = holidayRequests.current.get(year);
    if (pending) return pending;

    const request = api.get<Holiday[]>("/holidays/", { params: { year } })
      .then(({ data }) => data)
      .finally(() => holidayRequests.current.delete(year));
    holidayRequests.current.set(year, request);
    return request;
  }, []);

  useEffect(() => {
    const yearsToLoad = visibleYearsKey
      .split(",")
      .map(Number)
      .filter((year) => !(year in holidaysByYear) && !failedYears.includes(year));
    if (!yearsToLoad.length) return;

    let active = true;
    void Promise.all(yearsToLoad.map(async (year) => {
      try {
        const data = await loadHolidayYear(year);
        if (active) {
          setHolidaysByYear((current) => ({ ...current, [year]: data }));
          setFailedYears((current) => current.filter((failedYear) => failedYear !== year));
        }
      } catch {
        if (active) setFailedYears((current) => current.includes(year) ? current : [...current, year]);
      }
    }));

    return () => {
      active = false;
    };
  }, [failedYears, holidaysByYear, loadHolidayYear, visibleYearsKey]);

  useEffect(() => {
    if (!canViewWorkingDays || calendarYear in workingDaysByYear || failedWorkingDayYears.includes(calendarYear)) return;

    let active = true;
    api.get<WorkingDayAssignment[]>("/attendance/working-sunday", { params: { year: calendarYear } })
      .then(({ data }) => {
        if (active) {
          setWorkingDaysByYear((current) => ({ ...current, [calendarYear]: data }));
          setFailedWorkingDayYears((current) => current.filter((year) => year !== calendarYear));
        }
      })
      .catch(() => {
        if (active) {
          setFailedWorkingDayYears((current) => current.includes(calendarYear) ? current : [...current, calendarYear]);
        }
      });

    return () => {
      active = false;
    };
  }, [calendarYear, canViewWorkingDays, failedWorkingDayYears, workingDaysByYear]);

  useEffect(() => {
    if (!admin) return;
    api
      .get<UserOption[]>("/users/")
      .then(({ data }) => {
        setUsers(data);
        if (data.length) setSelectedUserId((current) => current || data[0].id);
      })
      .catch(() => {});
    api.get<TeamOption[]>("/teams/")
      .then(({ data }) => setTeams(data))
      .catch(() => {});
  }, [admin]);

  const handleAdd = async () => {
    if (submissionLock.current) return;
    if (!fromDate || !toDate || !newName) {
      toast.error("Please provide a date range and name");
      return;
    }
    if (fromDate > toDate) {
      toast.error("End date must be on or after start date");
      return;
    }
    if (appliesTo === "specific_users" && selectedUserIds.length === 0) {
      toast.error("Please select at least one user");
      return;
    }
    if (appliesTo === "specific_teams" && selectedTeamIds.length === 0) {
      toast.error("Please select at least one team");
      return;
    }
    submissionLock.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.post<Holiday[]>("/holidays/range", {
        from_date: fromDate,
        to_date: toDate,
        holiday_name: newName,
        applies_to: appliesTo,
        user_ids: appliesTo === "specific_users" ? selectedUserIds : [],
        team_ids: appliesTo === "specific_teams" ? selectedTeamIds : [],
      });
      toast.success(data.length === 1 ? "Holiday added" : `${data.length} holidays added`);
      setModalOpen(false);
      setFromDate("");
      setToDate("");
      setNewName("");
      setAppliesTo("all_users");
      setSelectedUserIds([]);
      setSelectedTeamIds([]);
      const years = Array.from(new Set(data.map((holiday) => parseISO(holiday.holiday_date).getFullYear())));
      invalidateHolidayYears(years);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  const invalidateHolidayYears = (years: number[]) => {
    if (!years.length) return;
    setHolidaysByYear((current) => {
      const next = { ...current };
      years.forEach((year) => delete next[year]);
      return next;
    });
    setFailedYears((current) => current.filter((year) => !years.includes(year)));
  };

  const handleDelete = async (holiday: Holiday) => {
    if (!confirm(`Delete holiday "${holiday.holiday_name}"?`)) return;
    try {
      await api.delete(`/holidays/${holiday.id}`);
      toast.success("Holiday deleted");
      invalidateHolidayYears([parseISO(holiday.holiday_date).getFullYear()]);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleMarkWorkingSunday = async () => {
    if (!selectedUserId || !selectedWorkDate) {
      toast.error("Please choose an employee and date");
      return;
    }

    setWorkingSundaySubmitting(true);
    try {
      const { data } = await api.post("/attendance/working-sunday", {
        user_id: Number(selectedUserId),
        work_date: selectedWorkDate,
      });
      toast.success(data?.message || "Working Sunday marked");
      invalidateWorkingDayYear(parseISO(selectedWorkDate).getFullYear());
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setWorkingSundaySubmitting(false);
    }
  };

  const handleUnmarkWorkingSunday = async () => {
    if (!selectedUserId || !selectedWorkDate) {
      toast.error("Please choose an employee and date");
      return;
    }

    setWorkingSundaySubmitting(true);
    try {
      const { data } = await api.delete("/attendance/working-sunday", {
        params: {
          user_id: Number(selectedUserId),
          work_date: selectedWorkDate,
        },
      });
      toast.success(data?.message || "Working Sunday unmarked");
      invalidateWorkingDayYear(parseISO(selectedWorkDate).getFullYear());
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setWorkingSundaySubmitting(false);
    }
  };

  const handleMonthChange = (month: Date) => {
    const nextMonth = startOfMonth(month);
    if (!isSameMonth(activeMonth, nextMonth)) {
      setActiveMonth(nextMonth);
      setSelectedRange(null);
    }
  };

  const handleSelectDate = (date: string) => {
    const selected = parseISO(date);
    if (!isSameMonth(activeMonth, selected)) {
      handleMonthChange(selected);
    }
    setSelectedRange({ start: date, end: date });
  };

  const openAddHoliday = () => {
    setFromDate(selectedRange?.start ?? "");
    setToDate(selectedRange?.end ?? "");
    setModalOpen(true);
  };

  const rangeHolidays = selectedRange
    ? holidays.filter((holiday) => holiday.holiday_date >= selectedRange.start && holiday.holiday_date <= selectedRange.end)
    : [];
  const selectedDatesLabel = selectedRange
    ? selectedRange.start === selectedRange.end
      ? format(parseISO(selectedRange.start), "EEEE, dd MMM yyyy")
      : `${format(parseISO(selectedRange.start), "dd MMM yyyy")} – ${format(parseISO(selectedRange.end), "dd MMM yyyy")}`
    : "";
  const selectedRangeYears = selectedRange
    ? Array.from(new Set(eachDayOfInterval({
      start: parseISO(selectedRange.start),
      end: parseISO(selectedRange.end),
    }).map((day) => day.getFullYear())))
    : [];
  const selectedRangeLoading = selectedRangeYears.some(
    (year) => !(year in holidaysByYear) && !failedYears.includes(year),
  );
  const selectedRangeFailedYears = selectedRangeYears.filter((year) => failedYears.includes(year));
  const getAudienceLabel = (holiday: Holiday) => {
    if (holiday.applies_to === "all_users") return "All Users";
    if (holiday.applies_to === "office" || holiday.applies_to === "onsite") {
      const coveredUsers = users.filter(
        (user) => (user.attendance_mode || "office") === holiday.applies_to,
      );
      if (!coveredUsers.length) {
        return holiday.applies_to === "office"
          ? "Office attendance mode"
          : "Onsite attendance mode";
      }
      const audience = holiday.applies_to === "office" ? "Office" : "Onsite";
      return `${audience}: ${coveredUsers.map((user) => user.name).join(", ")}`;
    }
    if (holiday.applies_to === "specific_users") {
      const names = holiday.user_names?.length
        ? holiday.user_names
        : holiday.user_ids.map((id) => users.find((user) => user.id === id)?.name || `User #${id}`);
      return `Specific Users: ${names.join(", ")}`;
    }
    if (holiday.applies_to === "specific_teams") {
      const names = holiday.team_names?.length
        ? holiday.team_names
        : holiday.team_ids.map((id) => teams.find((team) => team.id === id)?.name || `Team #${id}`);
      return `Specific Teams: ${names.join(", ")}`;
    }
    return holiday.applies_to.replace("_", " ");
  };
  const invalidateWorkingDayYear = (year: number) => {
    setWorkingDaysByYear((current) => {
      const next = { ...current };
      delete next[year];
      return next;
    });
    setFailedWorkingDayYears((current) => current.filter((failedYear) => failedYear !== year));
  };
  const calendarExportRows = [
    ...(holidaysByYear[calendarYear] ?? []).map((holiday) => ({
      Date: holiday.holiday_date,
      Weekday: format(parseISO(holiday.holiday_date), "EEEE"),
      "Entry Type": "Holiday",
      "Event Name": holiday.holiday_name,
      "Assignment Type": holiday.applies_to,
      "Assignment Details": getAudienceLabel(holiday),
    })),
    ...(workingDaysByYear[calendarYear] ?? []).map((assignment) => ({
      Date: assignment.work_date,
      Weekday: format(parseISO(assignment.work_date), "EEEE"),
      "Entry Type": "Working Day",
      "Event Name": "Working Day",
      "Assignment Type": "Employee",
      "Assignment Details": users.find((user) => user.id === assignment.user_id)?.name ?? `User #${assignment.user_id}`,
    })),
  ].sort((a, b) => a.Date.localeCompare(b.Date) || a["Entry Type"].localeCompare(b["Entry Type"]));

  const handleExportCSV = () => {
    if (!canExportCalendar) return;
    const columns = ["Date", "Weekday", "Entry Type", "Event Name", "Assignment Type", "Assignment Details"];
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [
      columns.map(escapeCsv).join(","),
      ...calendarExportRows.map((row) => columns.map((column) => escapeCsv(row[column as keyof typeof row])).join(",")),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `holidays-${calendarYear}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (!canExportCalendar) return;
    const worksheet = XLSX.utils.json_to_sheet(calendarExportRows, {
      header: ["Date", "Weekday", "Entry Type", "Event Name", "Assignment Type", "Assignment Details"],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Calendar");
    XLSX.writeFile(workbook, `holidays-${calendarYear}.xlsx`);
  };

  return (
    <AppShell requiredPermission="holidays.view">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Holidays</h1>
            <p className="text-sm text-ink-500">Company holiday calendar for {activeMonth.getFullYear()}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!canExportCalendar}
              title={!canViewWorkingDays ? "Attendance view permission is required to export working-day assignments" : undefined}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} /> Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!canExportCalendar}
              title={!canViewWorkingDays ? "Attendance view permission is required to export working-day assignments" : undefined}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </button>
            {admin && (
              <button
                onClick={openAddHoliday}
                className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                <Plus size={16} />
                Add Holiday
              </button>
            )}
          </div>
        </div>

        {canViewWorkingDays && workingDaysLoading && (
          <p role="status" className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-500">
            Loading working-day assignments for {calendarYear}...
          </p>
        )}
        {failedWorkingDayYears.includes(calendarYear) && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">Could not load working-day assignments for {calendarYear}.</p>
            <button
              type="button"
              onClick={() => setFailedWorkingDayYears((current) => current.filter((year) => year !== calendarYear))}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {admin && (
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-ink-900">Mark Working Day</h2>
              <p className="text-sm text-ink-500">Choose an employee and any date to allow remote attendance on that day, including Sundays and holidays.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto]">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">Employee</label>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value ? Number(event.target.value) : "")}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
                <input
                  type="date"
                  value={selectedWorkDate}
                  onChange={(event) => setSelectedWorkDate(event.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={handleMarkWorkingSunday}
                  disabled={workingSundaySubmitting}
                  className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
                >
                  {workingSundaySubmitting ? "Working..." : "Mark"}
                </button>
                <button
                  onClick={handleUnmarkWorkingSunday}
                  disabled={workingSundaySubmitting}
                  className="rounded-lg border border-ink-200 px-3.5 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-60"
                >
                  {workingSundaySubmitting ? "Working..." : "Unmark"}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <p role="status" className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-500">
            Loading holiday calendar...
          </p>
        )}
        {visibleFailedYears.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">
              Could not load holidays for {visibleFailedYears.join(", ")}.
            </p>
            <button
              type="button"
              onClick={() => setFailedYears((current) => current.filter((year) => !visibleFailedYears.includes(year)))}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
          <HolidayCalendar
            month={activeMonth}
            holidays={loading ? [] : holidays}
            selectedRange={selectedRange}
            onMonthChange={handleMonthChange}
            onDateSelect={handleSelectDate}
            onRangeSelect={(start, end) => setSelectedRange({ start, end })}
          />

          <aside className="rounded-2xl border border-ink-200 bg-white p-4 shadow-card sm:p-5">
            {selectedRange ? (
              <>
                <div className="mb-4 border-b border-ink-100 pb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                    {selectedRange.start === selectedRange.end ? "Selected date" : "Selected date range"}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-900">{selectedDatesLabel}</h2>
                </div>
                {selectedRangeLoading ? (
                  <p className="py-6 text-center text-sm text-ink-500">Loading holiday details...</p>
                ) : selectedRangeFailedYears.length ? (
                  <p role="alert" className="py-6 text-center text-sm text-red-600">
                    Could not load holidays for {selectedRangeFailedYears.join(", ")}. Use Retry above to try again.
                  </p>
                ) : rangeHolidays.length ? (
                  <div className="space-y-3">
                    {rangeHolidays.map((holiday) => (
                      <article key={holiday.id} className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-ink-900">{holiday.holiday_name}</h3>
                            <p className="mt-1 text-sm text-ink-600">
                              {format(parseISO(holiday.holiday_date), "EEEE, dd MMM yyyy")}
                            </p>
                          </div>
                          {admin && (
                            <button
                              onClick={() => handleDelete(holiday)}
                              className="shrink-0 rounded-lg p-2 text-ink-400 hover:bg-red-100 hover:text-red-600"
                              aria-label={`Delete ${holiday.holiday_name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        <p className="mt-3 border-t border-amber-200/70 pt-2.5 text-xs leading-relaxed text-ink-600">
                          <span className="font-semibold text-ink-700">Applies to: </span>
                          {getAudienceLabel(holiday)}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-50 text-ink-400">
                      <CalendarDays size={20} />
                    </div>
                    <p className="text-sm font-medium text-ink-800">No holidays on this date</p>
                    {admin && (
                      <button
                        onClick={openAddHoliday}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
                      >
                        <Plus size={15} />
                        Add Holiday
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <CalendarDays size={20} />
                </div>
                <h2 className="font-semibold text-ink-900">Holiday details</h2>
                <p className="mt-1 max-w-xs text-sm text-ink-500">
                  Select a date to view its holidays and assignment details.
                </p>
              </div>
            )}
          </aside>
        </div>

        {selectedYearLoading ? (
          <Loading />
        ) : selectedYearHolidays.length === 0 && failedYears.includes(calendarYear) ? null : selectedYearHolidays.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No holidays added yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {selectedYearHolidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:border-brand-200 hover:shadow-md">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{h.holiday_name}</p>
                  <p className="text-sm text-ink-500">{format(parseISO(h.holiday_date), "EEEE, dd MMM yyyy")}</p>
                  <p className="mt-1 text-xs text-ink-500">{getAudienceLabel(h)}</p>
                </div>
                {admin && (
                  <button
                    onClick={() => handleDelete(h)}
                    className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete holiday"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Holiday"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={submitting}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add Holiday"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">From Date</label>
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">To Date</label>
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Applies To</label>
            <select value={appliesTo} onChange={(event) => setAppliesTo(event.target.value)} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
              <option value="all_users">All Users</option>
              <option value="specific_users">Specific Users</option>
              <option value="office">Office</option>
              <option value="onsite">Onsite</option>
              <option value="specific_teams">Specific Teams</option>
            </select>
          </div>
          {appliesTo === "specific_users" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">Users</label>
              <select multiple value={selectedUserIds.map(String)} onChange={(event) => setSelectedUserIds(Array.from(event.target.selectedOptions, (option) => Number(option.value)))} className="h-28 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
          )}
          {appliesTo === "specific_teams" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">Teams</label>
              <select multiple value={selectedTeamIds.map(String)} onChange={(event) => setSelectedTeamIds(Array.from(event.target.selectedOptions, (option) => Number(option.value)))} className="h-28 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Holiday Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="E.g. Independence Day"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
