"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import UserSummary from "@/components/Users/UserSummary";
import UserCalendar from "@/components/Users/UserCalender";
import UserAttendanceChart from "@/components/Users/AttendanceChart";
import MonthSelector from "@/components/Calendar/MonthSelector";
import { AppointmentLetterPreview } from "@/components/Documents/AppointmentLetterGenerator";
import { OfferLetterPreview } from "@/components/Documents/OfferLetterGenerator";
import { downloadAppointmentLetterPdf, type AppointmentLetterValues } from "@/lib/appointmentLetterPdf";
import { downloadOfferLetterPdf, type OfferLetterValues } from "@/lib/offerLetterPdf";
import { getToken } from "@/lib/auth";

interface UserDetail {
  id: number;
  name: string;
  mobile: string;
  email: string | null;
  department: string;
  designation: string;
  role: string;
  status: string;
  annual_leave: number;
  leave_encashed: number;
  date_of_joining?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
}

interface AttendanceSummary {
  Present: number;
  Late: number;
  "Half Day": number;
  Holiday: number;
  Absent: number;
  WFH: number;
  Leave: number;
  "Total Hours": number;
}

type SelectedCalendarDay = {
  date: string;
  status?: string;
  leave_category?: string | null;
  working_day_label?: "Working Day" | "Extra Working Day" | null;
  day_type?: string;
};

type PersonalDocument = {
  id: number;
  employee_id: number;
  document_type: string;
  title: string;
  original_filename: string;
  file_name: string;
  file_path: string;
  mime_type?: string | null;
  file_size: number;
  uploaded_at: string;
};

type GeneratedDocument = {
  id: number;
  employee_id: number;
  employee_name?: string | null;
  document_type: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  sent_at?: string | null;
};

const defaultAttendanceSummary: AttendanceSummary = {
  Present: 0,
  Late: 0,
  "Half Day": 0,
  Holiday: 0,
  Absent: 0,
  WFH: 0,
  Leave: 0,
  "Total Hours": 0,
};

const personalDocLabels: Record<string, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  bank_passbook: "Bank Passbook",
  "10th_marksheet": "10th Marksheet",
  other: "Other",
};

export default function UserDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const today = new Date();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary>(defaultAttendanceSummary);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSummary, setRangeSummary] = useState<AttendanceSummary | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedDay, setSelectedDay] = useState<SelectedCalendarDay | null>(null);
  const [selectedOverrideStatus, setSelectedOverrideStatus] = useState("Present");
  const [savingSelectedOverride, setSavingSelectedOverride] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"Attendance" | "Personal Info" | "Documents">("Attendance");
  const [personalDocs, setPersonalDocs] = useState<PersonalDocument[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);
  const [selectedGeneratedDocument, setSelectedGeneratedDocument] = useState<GeneratedDocument | null>(null);

  const handleSelectDay = (day: SelectedCalendarDay) => {
    setSelectedDate(day.date);
    setSelectedDay(day);
    setSelectedOverrideStatus(day.status || "Present");
  };

  const handleSelectedDateChange = (value: string) => {
    setSelectedDate(value);
    setSelectedDay(null);
    setSelectedOverrideStatus("Present");

    if (!value) return;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setYear(parsed.getFullYear());
      setMonth(parsed.getMonth() + 1);
    }
  };

  const saveSelectedDateOverride = async () => {
    if (!selectedDate || !user) return;

    setSavingSelectedOverride(true);
    try {
      await api.put(`/attendance/user/${user.id}/date/${selectedDate}`, {
        status: selectedOverrideStatus,
        check_in: null,
        check_out: null,
      });

      toast.success("Override saved");
      setSelectedOverrideStatus(selectedOverrideStatus);
      setCalendarRefreshKey((value) => value + 1);
      await loadAttendanceSummary();
      await loadUserData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingSelectedOverride(false);
    }
  };

  const loadUserData = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const { data } = await api.get<UserDetail>(`/users/${userId}`);
      setUser(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadAttendanceSummary = async () => {
    if (!userId) return;
    setAttendanceLoading(true);
    try {
      const { data } = await api.get<AttendanceSummary>(`/attendance/summary/${userId}`, {
        params: { year, month },
      });
      setAttendanceSummary(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const loadDocumentData = async () => {
    if (!userId) return;
    try {
      const [personalRes, generatedRes] = await Promise.all([
        api.get<PersonalDocument[]>(`/employee-documents/personal-documents/${userId}`),
        api.get<GeneratedDocument[]>(`/employee-documents/documents/${userId}`),
      ]);
      setPersonalDocs(personalRes.data);
      setGeneratedDocs(generatedRes.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleAverageRange = async () => {
    if (!userId) return;
    if (!fromDate || !toDate) {
      toast.error("Please select both From Date and To Date.");
      return;
    }
    if (new Date(fromDate) > new Date(toDate)) {
      toast.error("From Date cannot be after To Date.");
      return;
    }

    setRangeLoading(true);
    try {
      const { data } = await api.get<AttendanceSummary>(`/attendance/summary/${userId}`, {
        params: {
          from_date: fromDate,
          to_date: toDate,
        },
      });
      setRangeSummary(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRangeLoading(false);
    }
  };

  const handleDownloadPersonalDoc = async (documentId: number) => {
    const token = getToken();
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/employee-documents/personal-documents/download/${documentId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Unable to download file");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `document_${documentId}`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadUserData();
    loadDocumentData();
  }, [userId]);

  useEffect(() => {
    loadAttendanceSummary();
  }, [userId, year, month]);

  useEffect(() => {
    const handleProfileUpdate = () => {
      loadUserData();
      loadDocumentData();
    };
    window.addEventListener("profile-updated", handleProfileUpdate);
    return () => window.removeEventListener("profile-updated", handleProfileUpdate);
  }, [userId]);

  const formatAverageHours = (totalHours: number, presentDays: number) => {
    if (!presentDays || totalHours <= 0) {
      return "0h 0m";
    }
    const average = totalHours / presentDays;
    const hours = Math.floor(average);
    const minutes = Math.round((average - hours) * 60);
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  };

  const activeDays = attendanceSummary.Present + attendanceSummary["Half Day"] + attendanceSummary.WFH;
  const averageWorkingHours = formatAverageHours(attendanceSummary["Total Hours"], activeDays);
  const rangeActiveDays = rangeSummary
    ? rangeSummary.Present + rangeSummary["Half Day"] + rangeSummary.WFH
    : 0;
  const rangeAverageWorkingHours = rangeSummary
    ? formatAverageHours(rangeSummary["Total Hours"], rangeActiveDays)
    : "-";

  const appointmentValues = selectedGeneratedDocument?.document_type === "appointment_letter" ? JSON.parse(selectedGeneratedDocument.content) as AppointmentLetterValues : null;
  const offerValues = selectedGeneratedDocument?.document_type === "offer_letter" ? JSON.parse(selectedGeneratedDocument.content) as OfferLetterValues : null;

  const handleDeleteDocument = async (documentId: number) => {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    try {
      await api.delete(`/employee-documents/documents/${documentId}`);
      loadDocumentData();
      toast.success("Document deleted successfully");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (loading) {
    return (
      <AppShell allowedRoles={["admin", "superadmin"]}>
        <Loading fullScreen />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell allowedRoles={["admin", "superadmin"]}>
        <p className="text-sm text-ink-500">User not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <UserSummary user={user} />

        <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-1">
          {(["Attendance", "Personal Info", "Documents"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === tab ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "Attendance" && (
          <div className="grid grid-cols-1 gap-6">
            <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-6">
              <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-semibold text-ink-900">Attendance Breakdown</h3>
                  <MonthSelector
                    year={year}
                    month={month}
                    onChange={(y, m) => {
                      setYear(y);
                      setMonth(m);
                      setSelectedDate("");
                      setSelectedDay(null);
                    }}
                  />
                </div>
                <UserAttendanceChart key={calendarRefreshKey} userId={user.id} year={year} month={month} />
              </div>

              <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
                <div className="flex items-center justify-between gap-3 mb-4"><h3 className="text-sm font-semibold text-ink-900">Average Working Hours</h3></div>
                <div className="rounded-2xl bg-ink-50 p-6">
                  <div className="grid gap-4">
                    <p className="text-sm text-ink-600">Average across present days, half days, and approved WFH</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm text-ink-600">From Date<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="space-y-1 text-sm text-ink-600">To Date<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm" /></label>
                    </div>
                    <button onClick={handleAverageRange} disabled={rangeLoading} className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{rangeLoading ? "Calculating..." : "Average"}</button>
                    <div className="rounded-xl bg-white p-4 border border-ink-200 text-center"><p className="text-sm text-ink-600">Selected range average</p><p className="mt-3 text-2xl font-semibold text-ink-900">{rangeSummary ? rangeAverageWorkingHours : "—"}</p></div>
                    <div className="grid grid-cols-2 gap-3 text-sm text-ink-600">
                      <div className="rounded-xl bg-white p-4 border border-ink-200"><p className="font-medium text-ink-700">Total Hours</p><p className="mt-1 text-ink-900">{rangeSummary ? `${rangeSummary["Total Hours"]}h` : "—"}</p></div>
                      <div className="rounded-xl bg-white p-4 border border-ink-200"><p className="font-medium text-ink-700">Present Days</p><p className="mt-1 text-ink-900">{rangeSummary ? rangeActiveDays : "—"}</p></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card xl:col-span-1">
                <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-ink-900">Attendance Calendar</h3></div>
                <div className="w-full">
                  <UserCalendar
                    userId={user.id}
                    year={year}
                    month={month}
                    selectedDate={selectedDate || undefined}
                    onSelectDay={handleSelectDay}
                    canOverride={false}
                    refreshKey={calendarRefreshKey}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Personal Info" && (
          <div className="space-y-6">
            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Basic Information</h2>
              <dl className="grid gap-5 sm:grid-cols-2">
                {[ ["Name", user.name], ["Designation", user.designation], ["Department", user.department], ["Phone", user.mobile || "—"], ["Email", user.email || "—"], ["Joining Date", user.date_of_joining ? new Date(`${user.date_of_joining}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—"] ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="mt-1 text-sm font-medium text-ink-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Address Details</h2>
              <dl className="grid gap-5 sm:grid-cols-2">
                {[ ["Address Line 1", user.address_line_1 || "—"], ["Address Line 2", user.address_line_2 || "—"], ["City", user.city || "—"], ["State", user.state || "—"], ["Pincode", user.pincode || "—"], ["Country", user.country || "—"] ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="mt-1 text-sm font-medium text-ink-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Emergency Contact</h2>
              <dl className="grid gap-5 sm:grid-cols-2">
                {[ ["Emergency Contact Name", user.emergency_contact_name || "—"], ["Relationship", user.emergency_contact_relationship || "—"], ["Phone", user.emergency_contact_phone || "—"] ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="mt-1 text-sm font-medium text-ink-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        {activeTab === "Documents" && (
          <section className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="border-b border-ink-200 px-5 py-4"><h2 className="font-semibold">Employee Documents</h2></div>
            <div className="space-y-6 p-5">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink-900">Personal Documents</h3>
                <div className="space-y-3">
                  {personalDocs.length ? personalDocs.map((doc) => (
                    <div key={doc.id} className="flex flex-col gap-3 rounded-lg border border-ink-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-ink-900">{doc.title || personalDocLabels[doc.document_type] || doc.document_type}</p>
                        <p className="text-xs text-ink-500">{doc.original_filename}</p>
                      </div>
                      <button onClick={() => handleDownloadPersonalDoc(doc.id)} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"><span>Download</span></button>
                    </div>
                  )) : <p className="text-sm text-ink-500">No personal documents uploaded.</p>}
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink-900">Generated Company Documents</h3>
                <div className="space-y-3">
                  {generatedDocs.length ? generatedDocs.map((document) => (
                    <div key={document.id} className="flex flex-col gap-3 rounded-lg border border-ink-200 p-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium text-ink-900">{document.title}</p>
                        <p className="text-xs text-ink-500">{new Date(document.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectedGeneratedDocument(document)} className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700">View</button>
                        {(document.document_type === "offer_letter" || document.document_type === "appointment_letter") && (
                          <button onClick={() => {
                            if (document.document_type === "appointment_letter") {
                              downloadAppointmentLetterPdf(JSON.parse(document.content) as AppointmentLetterValues);
                            } else if (document.document_type === "offer_letter") {
                              downloadOfferLetterPdf(JSON.parse(document.content) as OfferLetterValues);
                            }
                          }} className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700">Download</button>
                        )}
                        <button onClick={() => handleDeleteDocument(document.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600">Delete</button>
                      </div>
                    </div>
                  )) : <p className="text-sm text-ink-500">No generated company documents.</p>}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {selectedGeneratedDocument && (appointmentValues || offerValues) && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
          <div className="mx-auto my-4 max-w-4xl rounded-xl bg-ink-100 p-3 shadow-xl sm:p-6">
            <div className="mb-3 flex justify-end gap-2">
              {appointmentValues && <button onClick={() => downloadAppointmentLetterPdf(appointmentValues)} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium">Download PDF</button>}
              {offerValues && <button onClick={() => downloadOfferLetterPdf(offerValues)} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium">Download PDF</button>}
              <button onClick={() => setSelectedGeneratedDocument(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium">Close</button>
            </div>
            {appointmentValues && <AppointmentLetterPreview values={appointmentValues} />}
            {offerValues && <OfferLetterPreview values={offerValues} />}
          </div>
        </div>
      )}
    </AppShell>
  );
}
