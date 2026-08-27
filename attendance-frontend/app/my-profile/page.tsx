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
import DynamicLetterPreview from "@/components/Documents/DynamicLetterPreview";
import { downloadAppointmentLetterPdf, type AppointmentLetterValues } from "@/lib/appointmentLetterPdf";
import { downloadOfferLetterPdf, type OfferLetterValues } from "@/lib/offerLetterPdf";
import { downloadDynamicLetterPdf } from "@/lib/dynamicLetterPdf";
import api, { getErrorMessage, getProfilePhotoUrl } from "@/lib/api";
import { getToken, updateSessionName } from "@/lib/auth";

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
type CompanyBranding = { company_name: string; company_address: string; logo_url?: string };
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
type PersonalDocumentRequest = { id: number; document_id: number; request_type: "replace" | "delete"; status: string; pending_original_filename?: string | null };

const money = (amount: number | string) => {
  const normalized = Number(String(amount).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(normalized)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(normalized);
};
const pdfAmount = (amount: number | string) => {
  const normalized = Number(String(amount).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(normalized)) return "0.00";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(normalized);
};
const getImageDataUrl = async (imageUrl: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Company logo could not be loaded");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Company logo could not be read"));
    reader.readAsDataURL(blob);
  });
};
const personalDocLabels: Record<string, string> = {
  aadhaar: "Aadhaar Card",
  pan: "PAN Card",
  bank_passbook: "Bank Passbook",
  highest_degree: "Highest Degree",
  other: "Other",
};

const isIOSBrowser = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function MyProfilePage() {
  const today = new Date();
  const [tab, setTab] = useState("Profile");
  const [profile, setProfile] = useState<User | null>(null);
  const [companyBranding, setCompanyBranding] = useState<CompanyBranding | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [personalDocuments, setPersonalDocuments] = useState<PersonalDocument[]>([]);
  const [personalDocumentRequests, setPersonalDocumentRequests] = useState<PersonalDocumentRequest[]>([]);
  const [deleteRequestDocumentId, setDeleteRequestDocumentId] = useState<number | null>(null);
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
  const [filteredSlips, setFilteredSlips] = useState<Slip[]>([]);

  const loadPersonalDocuments = async () => {
    const { data } = await api.get<PersonalDocument[]>("/employee-documents/personal-documents/mine");
    setPersonalDocuments(data);
  };

  useEffect(() => {
    Promise.all([
      api.get("/users/me"),
      api.get<CompanyBranding>("/settings/branding"),
      api.get("/employee-documents/salary-slips/mine"),
      api.get("/employee-documents/documents/mine"),
      api.get("/employee-documents/personal-documents/mine"),
      api.get<PersonalDocumentRequest[]>("/employee-documents/personal-document-requests/mine"),
      api.get("/users/me/profile-edit-requests"),
    ])
      .then(([me, branding, salary, employeeDocuments, personalDocs, documentRequests, requests]) => {
        const userData = me.data as User;
        setProfile(userData);
        setCompanyBranding(branding.data);
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
        setPersonalDocumentRequests(documentRequests.data);
        setProfileRequests(requests.data);
      })
      .catch((error) => toast.error(getErrorMessage(error)));
  }, []);

  useEffect(() => {
    if (profile) setPhotoUrl(getProfilePhotoUrl(profile.id, Date.now()));
  }, [profile]);

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
        // Dispatch profile update event to refresh admin pages and user lists
        window.dispatchEvent(new Event("profile-updated"));
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
      if (profile) setPhotoUrl(getProfilePhotoUrl(profile.id, Date.now()));
      // Emit events to refresh avatars and user lists
      window.dispatchEvent(new Event("profile-photo-updated"));
      window.dispatchEvent(new Event("profile-updated"));
      toast.success("Profile image updated");
    } catch (error) { toast.error(getErrorMessage(error)); }
  };

  const downloadSalarySlip = async (slip: Slip) => {
    if (!profile) return;
    
    const pdf = new jsPDF();
    const period = new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = 17;

    // Company-branded header
    if (companyBranding?.logo_url) {
      try {
        const logo = await getImageDataUrl(companyBranding.logo_url);
        pdf.addImage(logo, "JPEG", margin, y - 5, 22, 22);
      } catch {
        // The salary slip remains usable if the optional branding image is unavailable.
      }
    }
    pdf.setTextColor(31, 41, 55);
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.text(companyBranding?.company_name || "PropCheckup", margin + 28, y + 3);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text("SALARY SLIP", pageWidth - margin, y - 1, { align: "right" });
    pdf.setFontSize(9);
    pdf.text(`For the month of ${period}`, pageWidth - margin, y + 5, { align: "right" });
    y += 27;
    pdf.setDrawColor(37, 99, 235);
    pdf.setLineWidth(0.7);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 11;

    // Employee details
    pdf.setTextColor(31, 41, 55);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text("EMPLOYEE DETAILS", margin, y);
    y += 6;

    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setDrawColor(209, 213, 219);
    pdf.setFillColor(249, 250, 251);
    pdf.rect(margin, y - 4, contentWidth, 34, "FD");

    const detailsData = [
      ["Name", profile.name],
      ["Designation", profile.designation],
      ["Department", profile.department],
      ["Phone Number", profile.mobile || profile.phone || "—"],
      ["Email", profile.email || "—"],
      ["Joining Date", profile.date_of_joining ? new Date(`${profile.date_of_joining}T00:00:00`).toLocaleDateString("en-IN") : "—"],
    ];

    let detailY = y;
    const col1X = 18;
    const col2X = 105;

    detailsData.forEach((item, idx) => {
      if (idx % 2 === 0) {
        pdf.setFont("helvetica", "bold");
        pdf.text(item[0] + ":", col1X, detailY);
        pdf.setFont("helvetica", "normal");
        pdf.text(String(item[1]), col1X + 31, detailY, { maxWidth: 53 });
      } else {
        pdf.setFont("helvetica", "bold");
        pdf.text(item[0] + ":", col2X, detailY);
        pdf.setFont("helvetica", "normal");
        pdf.text(String(item[1]), col2X + 28, detailY, { maxWidth: 55 });
        detailY += 7;
      }
    });

    y = y + 40;

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text("SALARY BREAKDOWN", margin, y);
    y += 6;

    pdf.setDrawColor(37, 99, 235);
    pdf.setFillColor(239, 246, 255);
    pdf.rect(margin, y - 4, contentWidth, 7, "FD");
    
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("Description", 18, y);
    pdf.text("Amount", pageWidth - 18, y, { align: "right" });
    y += 7;

    // Salary rows
    pdf.setFont("helvetica", "normal");
    const particulars = JSON.parse(slip.particulars) as Array<{ name: string; amount: number }>;
    
    particulars.forEach((row) => {
      const desc = String(row.name);
      const amt = pdfAmount(row.amount);
      
      if (particulars.indexOf(row) % 2 === 0) {
        pdf.setFillColor(249, 250, 251);
        pdf.rect(margin, y - 3, contentWidth, 5, "F");
      }
      
      pdf.text(desc, 18, y);
      pdf.text(String(amt), pageWidth - 18, y, { align: "right" });
      y += 5;
    });

    // Total line
    pdf.setDrawColor(37, 99, 235);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 4;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    const totalStr = pdfAmount(slip.total_amount);
    pdf.text("NET AMOUNT", 18, y);
    pdf.text(String(totalStr), pageWidth - 18, y, { align: "right" });
    y += 10;

    // Company address footer
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(75, 85, 99);
    const footerTop = pageHeight - 37;
    pdf.setDrawColor(209, 213, 219);
    pdf.line(margin, footerTop, pageWidth - margin, footerTop);
    const address = companyBranding?.company_address || "—";
    const addressLines = pdf.splitTextToSize(address, contentWidth - 10);
    pdf.text(addressLines, pageWidth / 2, footerTop + 7, { align: "center" });
    pdf.save(`salary-slip-${period.replace(" ", "-")}.pdf`);
  };

  const handleDownloadPersonalDoc = async (documentId: number) => {
    const previewWindow = isIOSBrowser() ? window.open("about:blank", "_blank") : null;
    try {
      const { data } = await api.get<Blob>(`/employee-documents/personal-documents/download/${documentId}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(data);
      if (previewWindow) {
        previewWindow.location.href = url;
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      } else if (isIOSBrowser()) {
        window.location.href = url;
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `document_${documentId}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
      }
    } catch (error) {
      previewWindow?.close();
      throw error;
    }
  };

  const handleViewPersonalDoc = async (documentId: number) => {
    const previewWindow = window.open("about:blank", "_blank");
    try {
      const { data } = await api.get<Blob>(`/employee-documents/personal-documents/download/${documentId}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      if (previewWindow) {
        previewWindow.location.href = url;
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      } else {
        window.location.href = url;
      }
    } catch (error) {
      previewWindow?.close();
      toast.error(getErrorMessage(error));
    }
  };

  const requestReplacePersonalDoc = (documentId: number) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append("file", file);
        await api.post(`/employee-documents/personal-documents/${documentId}/replace-request`, formData);
        toast.success("Replace request sent for approval");
        const { data } = await api.get<PersonalDocumentRequest[]>("/employee-documents/personal-document-requests/mine");
        setPersonalDocumentRequests(data);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    };
    input.click();
  };

  const requestDeletePersonalDoc = async (documentId: number) => {
    try {
      await api.post(`/employee-documents/personal-documents/${documentId}/delete-request`);
      toast.success("Delete request sent for approval");
      const { data } = await api.get<PersonalDocumentRequest[]>("/employee-documents/personal-document-requests/mine");
      setPersonalDocumentRequests(data);
      setDeleteRequestDocumentId(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const pendingDocumentRequest = (documentId: number) => personalDocumentRequests.find((request) => request.document_id === documentId && request.status === "Pending");

  const appointmentValues =
    selectedDocument?.document_type === "appointment_letter"
      ? (JSON.parse(selectedDocument.content) as AppointmentLetterValues)
      : null;
  const offerValues =
    selectedDocument?.document_type === "offer_letter"
      ? (JSON.parse(selectedDocument.content) as OfferLetterValues)
      : null;
  const dynamicValues = selectedDocument && !appointmentValues && !offerValues
    ? (JSON.parse(selectedDocument.content) as { resolved_content?: string })
    : null;

  const downloadGeneratedDocument = async (document: GeneratedDocument) => {
    try {
      const values = JSON.parse(document.content) as AppointmentLetterValues & OfferLetterValues & { resolved_content?: string };
      if (document.document_type === "appointment_letter") {
        downloadAppointmentLetterPdf(values);
      } else if (document.document_type === "offer_letter") {
        downloadOfferLetterPdf(values);
      } else if (values.resolved_content) {
        await downloadDynamicLetterPdf(document.title, values.resolved_content, profile?.name);
      } else {
        throw new Error("This document has no renderable content");
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

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
                <div className="flex flex-col gap-6 sm:flex-row">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-3xl font-semibold text-brand-700">
                      {photoUrl ? <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" onError={() => setPhotoUrl(null)} /> : profile?.name?.charAt(0)}
                    </div>
                    <label className="cursor-pointer rounded-lg border border-ink-300 px-3 py-2 text-xs font-medium text-brand-700">
                      Upload Photo
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePhotoUpload(event.target.files?.[0] || null)} className="hidden" />
                    </label>
                  </div>
                  <dl className="flex-1 grid gap-5 sm:grid-cols-2">
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
                </div>
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
                      <span className="text-xs text-ink-500">Locked</span>
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
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void handleViewPersonalDoc(doc.id)} style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", pointerEvents: "auto" }} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"><Eye size={14} /> View</button>
                          <button type="button" onClick={() => void handleDownloadPersonalDoc(doc.id)} style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", pointerEvents: "auto" }} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"><Download size={14} /> Download</button>
                          <button type="button" onClick={() => requestReplacePersonalDoc(doc.id)} disabled={Boolean(pendingDocumentRequest(doc.id))} style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", pointerEvents: "auto" }} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700 disabled:opacity-50"><Pencil size={14} /> Replace</button>
                          {deleteRequestDocumentId === doc.id ? (
                            <span className="inline-flex items-center gap-2 text-sm">
                              <span className="text-ink-600">Request deletion?</span>
                              <button type="button" onClick={() => void requestDeletePersonalDoc(doc.id)} className="font-medium text-red-600">Confirm</button>
                              <button type="button" onClick={() => setDeleteRequestDocumentId(null)} className="font-medium text-ink-600">Cancel</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setDeleteRequestDocumentId(doc.id)} disabled={Boolean(pendingDocumentRequest(doc.id))} style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", pointerEvents: "auto" }} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"><Trash2 size={14} /> Delete</button>
                          )}
                          {pendingDocumentRequest(doc.id) && <span className="self-center text-xs text-amber-700">{pendingDocumentRequest(doc.id)?.request_type} pending</span>}
                        </div>
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
                          <button onClick={() => void downloadGeneratedDocument(document)} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700">
                            <Download size={14} /> Download
                          </button>
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
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-semibold">Salary Slips</h2>
                </div>
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
                            <div className="flex gap-2">
                              <button onClick={() => setSelectedSlip(slip)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-brand-700">
                                <Eye size={14} /> View
                              </button>
                              <button onClick={() => downloadSalarySlip(slip)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-brand-700">
                                <Download size={14} /> Download
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-ink-500">
                        No salary slips available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
          </section>
        )}

        {selectedDocument && (appointmentValues || offerValues || dynamicValues?.resolved_content) && (
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
              {dynamicValues?.resolved_content && <DynamicLetterPreview title={selectedDocument.title} content={dynamicValues.resolved_content} />}
            </div>
          </div>
        )}
        {selectedSlip && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
            <div className="mx-auto my-8 max-w-3xl rounded-xl bg-ink-100 p-3 shadow-xl sm:p-6">
              <div className="mb-3 flex justify-end">
                <button onClick={() => setSelectedSlip(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm">Close</button>
              </div>
              <article className="mx-auto min-h-680px max-w-794px bg-white p-6 text-sm text-ink-800 shadow-sm sm:p-10">
                <header className="border-b-2 border-brand-600 pb-5">
                  <div className="flex items-center justify-between gap-5">
                    <div className="flex min-w-0 items-center gap-4">
                      {companyBranding?.logo_url && <img src={companyBranding.logo_url} alt="Company logo" className="h-14 w-14 shrink-0 rounded object-contain" />}
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-bold text-ink-900">{companyBranding?.company_name || "PropCheckup"}</h2>
                        <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-ink-500">Salary Slip</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-right text-xs text-ink-600">For the month of<br /><span className="font-semibold text-ink-900">{new Date(selectedSlip.year, selectedSlip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</span></p>
                  </div>
                </header>

                <section className="mt-7">
                  <h3 className="border-b border-ink-200 pb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Employee Details</h3>
                  <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {[
                      ["Employee Name", profile?.name || "—"],
                      ["Designation", profile?.designation || "—"],
                      ["Department", profile?.department || "—"],
                      ["Phone Number", profile?.mobile || profile?.phone || "—"],
                      ["Email Address", profile?.email || "—"],
                      ["Joining Date", profile?.date_of_joining ? new Date(`${profile.date_of_joining}T00:00:00`).toLocaleDateString("en-IN") : "—"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                        <dd className="mt-1 font-medium text-ink-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="mt-8">
                  <h3 className="border-b border-ink-200 pb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Salary Breakdown</h3>
                  <div className="mt-4 overflow-hidden rounded-lg border border-ink-200">
                    <table className="w-full text-sm">
                      <thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-800">
                        <tr><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Amount</th></tr>
                      </thead>
                      <tbody>
                        {JSON.parse(selectedSlip.particulars).map((row: { name: string; amount: number }, index: number) => (
                          <tr key={row.name} className={index % 2 === 0 ? "bg-ink-50/60" : "bg-white"}>
                            <td className="px-4 py-3">{row.name}</td><td className="px-4 py-3 text-right font-medium">{money(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-brand-600 bg-brand-50">
                        <tr><th className="px-4 py-3 text-left text-sm">Net Amount</th><th className="px-4 py-3 text-right text-sm">{money(selectedSlip.total_amount)}</th></tr>
                      </tfoot>
                    </table>
                  </div>
                </section>

                <footer className="mt-12 border-t border-ink-200 pt-4 text-center text-xs leading-relaxed text-ink-500">
                  <p>{companyBranding?.company_address || "—"}</p>
                </footer>
              </article>
              <button onClick={() => void downloadSalarySlip(selectedSlip)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"><Download size={14} /> Download PDF</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
