"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Download, Eye, Pencil, Trash2, Upload } from "lucide-react";
import { jsPDF } from "jspdf";
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
  date_of_joining?: string | null;
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
};

type Slip = { id: number; month: number; year: number; total_amount: number; status: string; particulars: string };
type ProfileEditRequest = { id: number; section: "address" | "emergency_contact"; status: string };
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
  pan: "PAN Card",
  bank_passbook: "Bank Passbook",
  highest_degree: "Highest Degree",
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
  const [selectedSlip, setSelectedSlip] = useState<Slip | null>(null);
  const [profileRequests, setProfileRequests] = useState<ProfileEditRequest[]>([]);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingEmergency, setEditingEmergency] = useState(false);
  const [otherDocumentTitle, setOtherDocumentTitle] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState("pan");
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
      api.get("/users/me/profile-edit-requests"),
    ])
      .then(([me, salary, employeeDocuments, personalDocs, requests]) => {
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
        });
        setSlips(salary.data);
        setDocuments(employeeDocuments.data);
        setPersonalDocuments(personalDocs.data);
        setProfileRequests(requests.data);
      })
      .catch((error) => toast.error(getErrorMessage(error)));
  }, []);

  useEffect(() => {
    const token = getToken();
    fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/users/me/profile-photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (response) => response.ok ? URL.createObjectURL(await response.blob()) : null)
      .then(setPhotoUrl)
      .catch(() => {});
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, []);

  const handleProfileSave = async (event: FormEvent, section: "address" | "emergency_contact") => {
    event.preventDefault();
    try {
      const fields = section === "address"
        ? ["address_line_1", "address_line_2", "city", "state", "pincode", "country"] as const
        : ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"] as const;
      const requested_data = Object.fromEntries(fields.map((field) => [field, profileForm[field]]));
      const locked = profile ? fields.some((field) => Boolean(profile[field])) : false;
      if (locked) {
        await api.post("/users/me/profile-edit-requests", { section, requested_data });
        setProfileRequests((previous) => [...previous.filter((item) => item.section !== section || item.status !== "Pending"), { id: Date.now(), section, status: "Pending" }]);
        section === "address" ? setEditingAddress(false) : setEditingEmergency(false);
        toast.success("Edit approval request sent to Admin and Superadmin");
      } else {
        const { data } = await api.put<User>("/users/me/profile", requested_data);
        setProfile(data);
        toast.success(`${section === "address" ? "Address" : "Emergency contact"} saved and locked`);
      }
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
      if (uploadType === "other") formData.append("title", otherDocumentTitle);
      formData.append("file", selectedFile);
      await api.post("/employee-documents/personal-documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSelectedFile(null);
      setUploadType("pan");
      setOtherDocumentTitle("");
      await loadPersonalDocuments();
      toast.success("Document uploaded successfully");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoUpload = async (file: File | null) => {
    if (!file) return;
    try {
      const data = new FormData(); data.append("file", file);
      await api.post("/users/me/profile-photo", data, { headers: { "Content-Type": "multipart/form-data" } });
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setPhotoUrl(URL.createObjectURL(file));
      toast.success("Profile image updated");
    } catch (error) { toast.error(getErrorMessage(error)); }
  };

  const downloadSalarySlip = (slip: Slip) => {
    const pdf = new jsPDF(); const period = new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
    pdf.setFontSize(18); pdf.text("Salary Slip", 105, 20, { align: "center" }); pdf.setFontSize(11); pdf.text(`Period: ${period}`, 20, 35);
    let y = 50; JSON.parse(slip.particulars).forEach((row: { name: string; amount: number }) => { pdf.text(row.name, 20, y); pdf.text(money(row.amount), 180, y, { align: "right" }); y += 9; });
    pdf.setFontSize(13); pdf.text(`Total: ${money(slip.total_amount)}`, 180, y + 8, { align: "right" }); pdf.save(`salary-slip-${period.replace(" ", "-")}.pdf`);
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
              <h2 className="mb-4 font-semibold">Profile Image</h2>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-2xl font-semibold text-brand-700">{photoUrl ? <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" /> : profile?.name?.charAt(0)}</div>
                <label className="cursor-pointer rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-brand-700">Upload / Update<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePhotoUpload(event.target.files?.[0] || null)} className="hidden" /></label>
              </div>
            </section>
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
                      profile.date_of_joining
                        ? new Date(`${profile.date_of_joining}T00:00:00`).toLocaleDateString("en-IN", {
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
              <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-semibold">Address Details</h2>{profile && ["address_line_1", "address_line_2", "city", "state", "pincode", "country"].some((field) => Boolean(profile[field as keyof User])) && !editingAddress && <button type="button" onClick={() => setEditingAddress(true)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium"><Pencil size={14} /> Edit</button>}</div>
              <form onSubmit={(event) => handleProfileSave(event, "address")} className="space-y-4">
                <fieldset disabled={Boolean(profile && ["address_line_1", "address_line_2", "city", "state", "pincode", "country"].some((field) => Boolean(profile[field as keyof User])) && !editingAddress)} className="grid gap-4 md:grid-cols-2">
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
                </fieldset>
                {(!profile || !["address_line_1", "address_line_2", "city", "state", "pincode", "country"].some((field) => Boolean(profile[field as keyof User])) || editingAddress) && <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                  {editingAddress ? "Request Approval" : "Save Address"}
                </button>
                }
                {profileRequests.some((item) => item.section === "address" && item.status === "Pending") && <p className="text-sm text-amber-700">Address edit request is pending approval.</p>}
              </form>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-semibold">Emergency Contact</h2>{profile && ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"].some((field) => Boolean(profile[field as keyof User])) && !editingEmergency && <button type="button" onClick={() => setEditingEmergency(true)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium"><Pencil size={14} /> Edit</button>}</div>
              <form onSubmit={(event) => handleProfileSave(event, "emergency_contact")} className="space-y-4">
                <fieldset disabled={Boolean(profile && ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"].some((field) => Boolean(profile[field as keyof User])) && !editingEmergency)} className="grid gap-4 md:grid-cols-2">
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
                </fieldset>
                {(!profile || !["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"].some((field) => Boolean(profile[field as keyof User])) || editingEmergency) && <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                  {editingEmergency ? "Request Approval" : "Save Emergency Contact"}
                </button>
                }
                {profileRequests.some((item) => item.section === "emergency_contact" && item.status === "Pending") && <p className="text-sm text-amber-700">Emergency-contact edit request is pending approval.</p>}
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
                  {uploadType === "other" && <label className="text-sm text-ink-600">Document Name<input value={otherDocumentTitle} onChange={(event) => setOtherDocumentTitle(event.target.value)} placeholder="e.g. Experience Letter" required className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2" /></label>}
                </div>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile || (uploadType === "other" && !otherDocumentTitle.trim())}
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
                        <td className="px-5 py-3">
                          <div className="flex gap-2"><button onClick={() => setSelectedSlip(slip)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-brand-700"><Eye size={14} /> View</button><button onClick={() => downloadSalarySlip(slip)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-brand-700"><Download size={14} /> Download</button></div>
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
        {selectedSlip && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><div className="mx-auto my-12 max-w-lg rounded-xl bg-white p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Salary Slip — {new Date(selectedSlip.year, selectedSlip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</h2><button onClick={() => setSelectedSlip(null)} className="rounded-lg border px-3 py-1.5 text-sm">Close</button></div><div className="space-y-2 text-sm">{JSON.parse(selectedSlip.particulars).map((row: { name: string; amount: number }) => <div key={row.name} className="flex justify-between"><span>{row.name}</span><span>{money(row.amount)}</span></div>)}<div className="mt-4 flex justify-between border-t pt-3 font-semibold"><span>Total</span><span>{money(selectedSlip.total_amount)}</span></div></div><button onClick={() => downloadSalarySlip(selectedSlip)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"><Download size={14} /> Download</button></div></div>}
      </div>
    </AppShell>
  );
}
