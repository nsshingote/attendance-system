"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import MonthSelector from "@/components/Calendar/MonthSelector";
import UserAttendanceChart from "@/components/Users/AttendanceChart";
import { AppointmentLetterPreview } from "@/components/Documents/AppointmentLetterGenerator";
import { OfferLetterPreview } from "@/components/Documents/OfferLetterGenerator";
import { downloadAppointmentLetterPdf, type AppointmentLetterValues } from "@/lib/appointmentLetterPdf";
import { downloadOfferLetterPdf, type OfferLetterValues } from "@/lib/offerLetterPdf";
import api, { getErrorMessage } from "@/lib/api";
import { getToken } from "@/lib/auth";

type User = {
  id: number;
  name: string;
  email?: string;
  mobile: string;
  department: string;
  designation: string;
  created_at: string;
  phone?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_email?: string | null;
  emergency_contact_address?: string | null;
};

type Slip = { id: number; month: number; year: number; total_amount: number; status: string };
type GeneratedDocument = { id: number; document_type: string; title: string; content: string; created_at: string };
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

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
const personalDocLabels: Record<string, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  bank_passbook: "Bank Passbook",
  "10th_marksheet": "10th Marksheet",
  other: "Other",
};

export default function MyProfilePage() {
  const today = new Date();
  const [tab, setTab] = useState("Profile");
  const [profile, setProfile] = useState<User | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [personalDocuments, setPersonalDocuments] = useState<PersonalDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<GeneratedDocument | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState("aadhaar");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [profileForm, setProfileForm] = useState({
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    pincode: "",
    country: "",
    emergency_contact_name: "",
    emergency_contact_relationship: "",
    emergency_contact_phone: "",
    emergency_contact_email: "",
    emergency_contact_address: "",
  });

  const loadPersonalDocuments = async () => {
    const { data } = await api.get<PersonalDocument[]>("/employee-documents/personal-documents/mine");
    setPersonalDocuments(data);
  };

  useEffect(() => {
    Promise.all([
      api.get("/users/me"),
      api.get("/employee-documents/salary-slips/mine"),
      api.get("/employee-documents/documents/mine"),
      api.get("/employee-documents/personal-documents/mine"),
    ])
      .then(([me, salary, employeeDocuments, personalDocs]) => {
        const userData = me.data as User;
        setProfile(userData);
        setProfileForm({
          address_line_1: userData.address_line_1 || "",
          address_line_2: userData.address_line_2 || "",
          city: userData.city || "",
          state: userData.state || "",
          pincode: userData.pincode || "",
          country: userData.country || "",
          emergency_contact_name: userData.emergency_contact_name || "",
          emergency_contact_relationship: userData.emergency_contact_relationship || "",
          emergency_contact_phone: userData.emergency_contact_phone || "",
          emergency_contact_email: userData.emergency_contact_email || "",
          emergency_contact_address: userData.emergency_contact_address || "",
        });
        setSlips(salary.data);
        setDocuments(employeeDocuments.data);
        setPersonalDocuments(personalDocs.data);
      })
      .catch((error) => toast.error(getErrorMessage(error)));
  }, []);

  const handleProfileSave = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { data } = await api.put<User>("/users/me/profile", profileForm);
      setProfile(data);
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFile) {
      toast.error("Select a file to upload");
      return;
    }
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("document_type", uploadType);
      formData.append("file", selectedFile);
      await api.post("/employee-documents/personal-documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSelectedFile(null);
      setUploadType("aadhaar");
      await loadPersonalDocuments();
      toast.success("Document uploaded successfully");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadPersonalDoc = async (documentId: number) => {
    const token = getToken();
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/employee-documents/personal-documents/download/${documentId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Unable to download file");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `document_${documentId}`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDeletePersonalDoc = async (documentId: number) => {
    try {
      await api.delete(`/employee-documents/personal-documents/${documentId}`);
      await loadPersonalDocuments();
      toast.success("Document deleted successfully");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const appointmentValues =
    selectedDocument?.document_type === "appointment_letter"
      ? (JSON.parse(selectedDocument.content) as AppointmentLetterValues)
      : null;
  const offerValues =
    selectedDocument?.document_type === "offer_letter"
      ? (JSON.parse(selectedDocument.content) as OfferLetterValues)
      : null;

  return (
    <AppShell allowedRoles={["user"]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">My Profile</h1>
          <p className="text-sm text-ink-500">View and update your personal information and documents</p>
        </div>

        <div className="flex w-fit rounded-lg border border-ink-200 bg-white p-1">
          {["Profile", "Documents", "Salary Slips"].map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === item ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"}`}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === "Profile" && (
          <div className="space-y-6">
            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Basic Information</h2>
              {profile ? (
                <dl className="grid gap-5 sm:grid-cols-2">
                  {[
                    ["Full name", profile.name],
                    ["Designation", profile.designation],
                    ["Department", profile.department],
                    ["Phone number", profile.mobile || "—"],
                    ["Email", profile.email || "—"],
                    [
                      "Joined",
                      profile.created_at
                        ? new Date(profile.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })
                        : "—",
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                      <dd className="mt-1 text-sm font-medium text-ink-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-ink-500">Loading profile…</p>
              )}
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Address Details</h2>
              <form onSubmit={handleProfileSave} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-ink-600">
                    Address Line 1
                    <input
                      value={profileForm.address_line_1}
                      onChange={(e) => setProfileForm({ ...profileForm, address_line_1: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Address Line 2
                    <input
                      value={profileForm.address_line_2}
                      onChange={(e) => setProfileForm({ ...profileForm, address_line_2: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    City
                    <input
                      value={profileForm.city}
                      onChange={(e) => setProfileForm({ ...profileForm, city: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    State
                    <input
                      value={profileForm.state}
                      onChange={(e) => setProfileForm({ ...profileForm, state: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Pincode
                    <input
                      value={profileForm.pincode}
                      onChange={(e) => setProfileForm({ ...profileForm, pincode: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Country
                    <input
                      value={profileForm.country}
                      onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                </div>
                <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                  Save Address
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">Emergency Contact</h2>
              <form onSubmit={handleProfileSave} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-ink-600">
                    Emergency Contact Name
                    <input
                      value={profileForm.emergency_contact_name}
                      onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Relationship
                    <input
                      value={profileForm.emergency_contact_relationship}
                      onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_relationship: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Phone Number
                    <input
                      value={profileForm.emergency_contact_phone}
                      onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_phone: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600">
                    Email
                    <input
                      value={profileForm.emergency_contact_email}
                      onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm text-ink-600 md:col-span-2">
                    Address
                    <textarea
                      value={profileForm.emergency_contact_address}
                      onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_address: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2"
                      rows={3}
                    />
                  </label>
                </div>
                <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                  Save Emergency Contact
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <h2 className="mb-5 font-semibold">My Documents</h2>
              <form onSubmit={handleUpload} className="mb-6 space-y-4 rounded-xl border border-ink-200 bg-ink-50 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm text-ink-600">
                    Document Type
                    <select
                      value={uploadType}
                      onChange={(e) => setUploadType(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2"
                    >
                      {Object.entries(personalDocLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-ink-600">
                    File
                    <input
                      type="file"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Upload size={16} /> {uploading ? "Uploading..." : "Upload Document"}
                </button>
              </form>

              <div className="space-y-3">
                {personalDocuments.length ? (
                  personalDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex flex-col gap-3 rounded-lg border border-ink-200 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-medium text-ink-900">
                          {doc.title || personalDocLabels[doc.document_type] || doc.document_type}
                        </p>
                        <p className="text-xs text-ink-500">
                          {doc.original_filename} · {new Date(doc.uploaded_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDownloadPersonalDoc(doc.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"
                        >
                          <Download size={14} /> Download
                        </button>
                        <button
                          onClick={() => handleDeletePersonalDoc(doc.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ink-500">No personal documents uploaded yet.</p>
                )}
              </div>
            </section>

            {profile && (
              <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink-900">Attendance Breakdown</h2>
                  <MonthSelector
                    year={year}
                    month={month}
                    onChange={(selectedYear, selectedMonth) => {
                      setYear(selectedYear);
                      setMonth(selectedMonth);
                    }}
                  />
                </div>
                <UserAttendanceChart userId={profile.id} year={year} month={month} />
              </section>
            )}
          </div>
        )}

        {tab === "Documents" && (
          <section className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="border-b border-ink-200 px-5 py-4">
              <h2 className="font-semibold">My Documents</h2>
            </div>
            <div className="space-y-6 p-5">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink-900">Personal Documents</h3>
                <div className="space-y-3">
                  {personalDocuments.length ? (
                    personalDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex flex-col gap-3 rounded-lg border border-ink-200 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="font-medium text-ink-900">
                            {doc.title || personalDocLabels[doc.document_type] || doc.document_type}
                          </p>
                          <p className="text-xs text-ink-500">{doc.original_filename}</p>
                        </div>
                        <button
                          onClick={() => handleDownloadPersonalDoc(doc.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"
                        >
                          <Download size={14} /> Download
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-ink-500">No personal documents uploaded.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-ink-900">Generated Company Documents</h3>
                <div className="space-y-3">
                  {documents.length ? (
                    documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex flex-col gap-3 rounded-lg border border-ink-200 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="font-medium text-ink-900">{document.title}</p>
                          <p className="text-xs text-ink-500">
                            {new Date(document.created_at).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedDocument(document)}
                            className="rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"
                          >
                            View
                          </button>
                          {(document.document_type === "offer_letter" || document.document_type === "appointment_letter") && (
                            <button
                              onClick={() => {
                                if (document.document_type === "appointment_letter") {
                                  downloadAppointmentLetterPdf(JSON.parse(document.content) as AppointmentLetterValues);
                                } else if (document.document_type === "offer_letter") {
                                  downloadOfferLetterPdf(JSON.parse(document.content) as OfferLetterValues);
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"
                            >
                              <Download size={14} /> Download
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-ink-500">No generated company documents yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "Salary Slips" && (
          <section className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="border-b border-ink-200 px-5 py-4">
              <h2 className="font-semibold">Salary Slips</h2>
            </div>
            <div className="table-wrapper">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-ink-600">
                  <tr>
                    <th className="px-5 py-3">Month</th>
                    <th className="px-5 py-3">Salary</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {slips.length ? (
                    slips.map((slip) => (
                      <tr key={slip.id} className="border-t border-ink-100">
                        <td className="px-5 py-3">
                          {new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}
                        </td>
                        <td className="px-5 py-3">{money(slip.total_amount)}</td>
                        <td className="px-5 py-3">{slip.status}</td>
                        <td className="px-5 py-3 text-ink-500">
                          <FileText size={16} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-ink-500">
                        No salary slips available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedDocument && (appointmentValues || offerValues) && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
            <div className="mx-auto my-4 max-w-4xl rounded-xl bg-ink-100 p-3 shadow-xl sm:p-6">
              <div className="mb-3 flex justify-end gap-2">
                {appointmentValues && (
                  <button
                    onClick={() => downloadAppointmentLetterPdf(appointmentValues)}
                    className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium"
                  >
                    <Download size={15} /> Download PDF
                  </button>
                )}
                {offerValues && (
                  <button
                    onClick={() => downloadOfferLetterPdf(offerValues)}
                    className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium"
                  >
                    <Download size={15} /> Download PDF
                  </button>
                )}
                <button onClick={() => setSelectedDocument(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium">
                  Close
                </button>
              </div>
              {appointmentValues && <AppointmentLetterPreview values={appointmentValues} />}
              {offerValues && <OfferLetterPreview values={offerValues} />}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
