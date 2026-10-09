"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Eye, Pencil, Trash2, Upload } from "lucide-react";
import { jsPDF } from "jspdf";
import { EMPLOYEE_DOCUMENT_LOGO_PATH, loadEmployeeDocumentLogoDataUrl } from "@/lib/employeeDocumentBranding";
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
import { HIDDEN_PDF_PREVIEW_CONTAINER_STYLE } from "@/lib/dynamicLetterLayout";
import { shareIOSFile } from "@/lib/iosFileDownload";
import { isIOSBrowser } from "@/lib/pdfDownload";
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
  place_of_posting?: string | null;
  location?: string | null;
  pan_number?: string | null;
  account_number?: string | null;
  payment_mode?: string | null;
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

type SalaryRow = { name: string; amount: number };
type SalaryEmployeeDetails = { name: string; designation: string; department: string; phone_number: string; email: string; joining_date: string; pan_number: string; account_number: string; location: string; payment_mode: string; days_in_month: number; days_worked: number };
type Slip = { id: number; month: number; year: number; total_amount: number; net_pay?: number; total_earnings?: number; lop_deduction?: number; total_deductions?: number; lwp_days?: number; employee_details?: SalaryEmployeeDetails; earnings?: SalaryRow[]; deductions?: SalaryRow[]; status: string; particulars: string };
type SalaryRequestRow = { name: string; amount: string; custom?: boolean };
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
const numberWords = (value: number): string => {
  const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (number: number): string => {
    if (number < 20) return ones[number];
    if (number < 100) return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
    return `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underThousand(number % 100)}` : ""}`;
  };
  if (!Number.isFinite(value) || value < 0) return "Zero Rupees Only";
  const totalPaise = Math.round(value * 100);
  let rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  if (!rupees) return `Zero Rupees${paise ? ` and ${underThousand(paise)} Paise` : ""} Only`;
  const parts: string[] = [];
  const groups: [number, string][] = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]];
  for (const [size, label] of groups) {
    if (rupees >= size) {
      const count = Math.floor(rupees / size);
      parts.push(`${underThousand(count)} ${label}`);
      rupees %= size;
    }
  }
  if (rupees) parts.push(underThousand(rupees));
  return `Rupees ${parts.join(" ")}${paise ? ` and ${underThousand(paise)} Paise` : ""} Only`;
};
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const slipEmployeeDetails = (slip: Slip, profile: User | null): SalaryEmployeeDetails => {
  const saved = slip.employee_details;
  return {
    name: saved?.name || profile?.name || "", designation: saved?.designation || profile?.designation || "",
    department: saved?.department || profile?.department || "", phone_number: saved?.phone_number || profile?.mobile || profile?.phone || "",
    email: saved?.email || profile?.email || "",
    joining_date: saved?.joining_date || (profile?.date_of_joining ? new Date(`${profile.date_of_joining}T00:00:00`).toLocaleDateString("en-IN") : ""),
    pan_number: saved?.pan_number || profile?.pan_number || "", account_number: saved?.account_number || profile?.account_number || "",
    location: saved?.location || profile?.location || profile?.place_of_posting || "", payment_mode: saved?.payment_mode || profile?.payment_mode || "",
    days_in_month: saved?.days_in_month ?? new Date(slip.year, slip.month, 0).getDate(), days_worked: saved?.days_worked ?? 0,
  };
};
const personalDocLabels: Record<string, string> = {
  aadhaar: "Aadhaar Card",
  pan: "PAN Card",
  bank_passbook: "Bank Passbook",
  highest_degree: "Highest Degree",
  other: "Other",
};
const salaryRequestBaseRows: SalaryRequestRow[] = ["Basic Salary", "House Rent Allowance", "Incentive Pay", "Travelling Allowance", "Overtime", "Extra Working Day"].map(name => ({ name, amount: "" }));
const salaryDeductionBaseRows = ["Provident Fund", "Professional Tax", "Health Insurance Contribution"].map(name => ({ name, amount: 0 }));

const isMobileBrowser = () => isIOSBrowser() || /Android/i.test(navigator.userAgent);

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
  const [pendingDynamicPdf, setPendingDynamicPdf] = useState<{ document: GeneratedDocument; targetWindow: Window | null } | null>(null);
  const [iosDownloadFile, setIOSDownloadFile] = useState<File | null>(null);
  const dynamicPreviewRef = useRef<HTMLDivElement>(null);
  const [selectedSlip, setSelectedSlip] = useState<Slip | null>(null);
  const [profileRequests, setProfileRequests] = useState<ProfileEditRequest[]>([]);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingBasic, setEditingBasic] = useState(false);
  const [editingEmergency, setEditingEmergency] = useState(false);
  const [otherDocumentTitle, setOtherDocumentTitle] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState("pan");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [profileForm, setProfileForm] = useState({
    email: "",
    mobile: "",
    location: "",
    pan_number: "",
    account_number: "",
    payment_mode: "",
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
  const [showSalaryRequest, setShowSalaryRequest] = useState(false);
  const [salaryRequestPeriod, setSalaryRequestPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [salaryRequestRows, setSalaryRequestRows] = useState<SalaryRequestRow[]>(salaryRequestBaseRows.map(row => ({ ...row })));
  const [sendingSalaryRequest, setSendingSalaryRequest] = useState(false);

  const loadPersonalDocuments = async () => {
    const { data } = await api.get<PersonalDocument[]>("/employee-documents/personal-documents/mine");
    setPersonalDocuments(data);
  };

  const submitSalarySlipRequest = async () => {
    const [requestYear, requestMonth] = salaryRequestPeriod.split("-").map(Number);
    setSendingSalaryRequest(true);
    try {
      await api.post("/employee-documents/salary-slips/request", {
        year: requestYear, month: requestMonth,
        earnings: salaryRequestRows.filter(row => row.name.trim()).map(row => ({ name: row.name.trim(), amount: Number(row.amount) || 0 })),
        deductions: salaryDeductionBaseRows,
      });
      const { data } = await api.get<Slip[]>("/employee-documents/salary-slips/mine");
      setSlips(data);
      setShowSalaryRequest(false);
      setSalaryRequestRows(salaryRequestBaseRows.map(row => ({ ...row })));
      toast.success("Salary slip request sent for review");
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setSendingSalaryRequest(false); }
  };

  const salaryRequestTotal = salaryRequestRows.reduce((sum, row) => sum + (row.name.trim() ? Number(row.amount) || 0 : 0), 0);
  const [requestYear, requestMonth] = salaryRequestPeriod.split("-").map(Number);
  const selectedPeriodSlip = slips.find(slip => slip.year === requestYear && slip.month === requestMonth);
  const finalSalarySlips = slips.filter(slip => slip.status === "Sent");
  const pendingSalaryRequests = slips.filter(slip => slip.status === "Pending Review");

  useEffect(() => {
    Promise.all([
      api.get<User>("/users/me"),
      api.get<CompanyBranding>("/settings/branding"),
      api.get<Slip[]>("/employee-documents/salary-slips/mine"),
      api.get<GeneratedDocument[]>("/employee-documents/documents/mine"),
      api.get<PersonalDocument[]>("/employee-documents/personal-documents/mine"),
      api.get<PersonalDocumentRequest[]>("/employee-documents/personal-document-requests/mine"),
      api.get<ProfileEditRequest[]>("/users/me/profile-edit-requests"),
    ])
      .then(([me, branding, salary, employeeDocuments, personalDocs, documentRequests, requests]) => {
        const userData = me.data;
        setProfile(userData);
        setPhotoUrl(getProfilePhotoUrl(userData.id, Date.now()));
        setCompanyBranding(branding.data);
        setProfileForm({
          email: userData.email || "",
          mobile: userData.mobile || "",
          location: userData.location || userData.place_of_posting || "",
          pan_number: userData.pan_number || "",
          account_number: userData.account_number || "",
          payment_mode: userData.payment_mode || "",
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

  const handleProfileSave = async (event: FormEvent, section: "address" | "emergency_contact") => {
    event.preventDefault();
    try {
      const fields = section === "address"
        ? ["address_line_1", "address_line_2", "city", "state", "pincode", "country"] as const
        : ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"] as const;
      const requested_data = Object.fromEntries(fields.map((field) => [field, profileForm[field]]));
      const locked = section === "emergency_contact" && profile ? fields.some((field) => Boolean(profile[field])) : false;
      if (locked) {
        await api.post("/users/me/profile-edit-requests", { section, requested_data });
        setProfileRequests((previous) => [...previous.filter((item) => item.section !== section || item.status !== "Pending"), { id: Date.now(), section, status: "Pending" }]);
        section === "address" ? setEditingAddress(false) : setEditingEmergency(false);
        toast.success("Edit approval request sent to Admin and Superadmin");
      } else {
        const { data } = await api.put<User>("/users/me/profile", requested_data);
        setProfile(data);
        setPhotoUrl(getProfilePhotoUrl(data.id, Date.now()));
        // Dispatch profile update event to refresh admin pages and user lists
        window.dispatchEvent(new Event("profile-updated"));
        toast.success(`${section === "address" ? "Address" : "Emergency contact"} saved`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleBasicSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingBasic) return;
    try {
      const { data } = await api.put<User>("/users/me/profile", {
        email: profileForm.email,
        mobile: profileForm.mobile,
        location: profileForm.location,
        pan_number: profileForm.pan_number,
        account_number: profileForm.account_number,
        payment_mode: profileForm.payment_mode,
      });
      setProfile(data);
      setEditingBasic(false);
      window.dispatchEvent(new Event("profile-updated"));
      toast.success("Email and phone number updated");
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
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const period = new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    const details = slipEmployeeDetails(slip, profile);
    const earnings = slip.earnings || (() => { try { return JSON.parse(slip.particulars) as SalaryRow[]; } catch { return []; } })();
    const deductions = slip.deductions || [];
    const totalEarnings = Number(slip.total_earnings ?? slip.total_amount ?? 0);
    const totalDeductions = Number(slip.total_deductions ?? 0);
    const lopDeduction = Number(slip.lop_deduction ?? 0);
    const netPay = Number(slip.net_pay ?? slip.total_amount ?? 0);
    let y = 17;

    try {
      const logo = await loadEmployeeDocumentLogoDataUrl();
      const logoProperties = pdf.getImageProperties(logo);
      const logoScale = Math.min(65 / logoProperties.width, 22 / logoProperties.height);
      pdf.addImage(logo, "PNG", margin, y - 5 + (22 - logoProperties.height * logoScale) / 2, logoProperties.width * logoScale, logoProperties.height * logoScale);
    } catch {
      // Preserve the salary-slip download if the optional branding asset is unavailable.
    }
    pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(107, 114, 128);
    pdf.text("SALARY SLIP", pageWidth - margin, y - 1, { align: "right" });
    pdf.setFontSize(9); pdf.text(`For the month of ${period}`, pageWidth - margin, y + 5, { align: "right" });
    y += 18; pdf.setDrawColor(37, 99, 235); pdf.setLineWidth(0.7); pdf.line(margin, y, pageWidth - margin, y); y += 5;

    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - 40) return;
      pdf.addPage(); y = 20;
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(31, 41, 55);
      pdf.text(`SALARY SLIP - ${period} (continued)`, margin, y); y += 9;
    };
    const sectionTitle = (title: string) => {
      ensureSpace(12); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(31, 41, 55);
      pdf.text(title, margin, y); y += 6;
    };
    sectionTitle("EMPLOYEE DETAILS");
    pdf.setFontSize(7.5); pdf.setDrawColor(209, 213, 219); pdf.setFillColor(249, 250, 251);
    const employeeRows: [string, string, string, string][] = [
      ["Name", details.name, "Designation", details.designation],
      ["Department", details.department, "Phone Number", details.phone_number],
      ["Email", details.email, "Joining Date", details.joining_date],
      ["PAN No.", details.pan_number, "Account No.", details.account_number],
      ["Location", details.location, "Payment Mode", details.payment_mode],
      ["Days in Month", String(details.days_in_month), "Days Worked", String(details.days_worked)],
      ["LWP Days", String(slip.lwp_days || 0), "", ""],
    ];
    const detailBoxHeight = employeeRows.length * 7 + 2;
    pdf.rect(margin, y - 4, contentWidth, detailBoxHeight, "FD");
    employeeRows.forEach((row, index) => {
      const rowY = y + index * 7;
      pdf.setFont("helvetica", "bold"); pdf.text(`${row[0]}:`, margin + 3, rowY, { maxWidth: 28 });
      pdf.setFont("helvetica", "normal"); pdf.text(row[1] || "-", margin + 32, rowY, { maxWidth: 48 });
      if (row[2]) {
        pdf.setFont("helvetica", "bold"); pdf.text(`${row[2]}:`, margin + 88, rowY, { maxWidth: 28 });
        pdf.setFont("helvetica", "normal"); pdf.text(row[3] || "-", margin + 117, rowY, { maxWidth: 48 });
      }
    });
    y += detailBoxHeight + 8;

    const drawRows = (title: string, rows: SalaryRow[], totalLabel: string, total: number) => {
      sectionTitle(title);
      pdf.setFillColor(239, 246, 255); pdf.setDrawColor(209, 213, 219); pdf.rect(margin, y - 4, contentWidth, 7, "FD");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text("Description", margin + 3, y); pdf.text("Amount (INR)", pageWidth - margin - 3, y, { align: "right" }); y += 7;
      rows.forEach((row, index) => {
        ensureSpace(7);
        if (index % 2 === 0) { pdf.setFillColor(249, 250, 251); pdf.rect(margin, y - 3, contentWidth, 5, "F"); }
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(31, 41, 55);
        pdf.text(row.name, margin + 3, y, { maxWidth: 130 }); pdf.text(pdfAmount(row.amount), pageWidth - margin - 3, y, { align: "right" }); y += 5;
      });
      ensureSpace(10); pdf.setDrawColor(37, 99, 235); pdf.line(margin, y, pageWidth - margin, y); y += 5;
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.5); pdf.text(totalLabel, margin + 3, y); pdf.text(pdfAmount(total), pageWidth - margin - 3, y, { align: "right" }); y += 9;
    };
    drawRows("EARNINGS", earnings, "TOTAL EARNINGS", totalEarnings);
    drawRows("DEDUCTIONS", [{ name: "LWP Deduction", amount: lopDeduction }, ...deductions], "TOTAL DEDUCTIONS", totalDeductions);
    ensureSpace(36); pdf.setFillColor(239, 246, 255); pdf.rect(margin, y - 4, contentWidth, 10, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(31, 41, 55);
    pdf.text("NET PAY", margin + 3, y + 2); pdf.text(`INR ${pdfAmount(netPay)}`, pageWidth - margin - 3, y + 2, { align: "right" }); y += 15;
    pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); pdf.text("Amount in Words:", margin, y);
    pdf.setFont("helvetica", "normal");
    const amountWordsLines = pdf.splitTextToSize(numberWords(netPay), contentWidth - 30);
    pdf.text(amountWordsLines, margin + 29, y, { maxWidth: contentWidth - 30 });
    y += amountWordsLines.length * 4 + 2;
    pdf.setFontSize(7); pdf.setTextColor(75, 85, 99);
    pdf.text("This is a system-generated salary slip. No signature is required.", pageWidth / 2, y, { align: "center" });

    const footerTop = pageHeight - 27;
    pdf.setDrawColor(209, 213, 219); pdf.line(margin, footerTop, pageWidth - margin, footerTop);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(75, 85, 99);
    const address = companyBranding?.company_address || "";
    if (address) pdf.text(pdf.splitTextToSize(address, contentWidth - 10), pageWidth / 2, footerTop + 5, { align: "center" });
    pdf.save(`salary-slip-${period.replace(" ", "-")}.pdf`);
  };

  const handleDownloadPersonalDoc = async (documentId: number, filename?: string) => {
    try {
      const { data } = await api.get<Blob>(`/employee-documents/personal-documents/download/${documentId}`, { responseType: "blob" });
      const fileName = filename || `document_${documentId}`;
      if (isIOSBrowser()) {
        setIOSDownloadFile(new File([data], fileName, { type: data.type || "application/octet-stream" }));
        return;
      }
      const url = window.URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleViewPersonalDoc = async (documentId: number) => {
    // This must run synchronously with the tap; iOS blocks popups opened after
    // an awaited network request.
    const previewWindow = window.open("about:blank", "_blank");
    try {
      const { data } = await api.get<Blob>(`/employee-documents/personal-documents/download/${documentId}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(data);
      if (previewWindow) {
        previewWindow.location.href = url;
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      } else {
        window.location.assign(url);
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
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
    selectedDocument?.document_type === "appointment_letter" && !JSON.parse(selectedDocument.content).resolved_content
      ? (JSON.parse(selectedDocument.content) as AppointmentLetterValues)
      : null;
  const offerValues =
    selectedDocument?.document_type === "offer_letter" && !JSON.parse(selectedDocument.content).resolved_content
      ? (JSON.parse(selectedDocument.content) as OfferLetterValues)
      : null;
  const dynamicValues = selectedDocument && !appointmentValues && !offerValues
    ? (JSON.parse(selectedDocument.content) as { resolved_content?: string; template_content?: string; template_layout?: unknown; layout_validated?: boolean })
    : null;

  useEffect(() => {
    if (!pendingDynamicPdf || !selectedDocument || selectedDocument.id !== pendingDynamicPdf.document.id || !dynamicValues?.resolved_content || !dynamicPreviewRef.current) return;
    void downloadDynamicLetterPdf(selectedDocument.title, dynamicValues.resolved_content, profile?.name, dynamicPreviewRef.current, pendingDynamicPdf.targetWindow, file => setIOSDownloadFile(file))
    .catch(error => toast.error(getErrorMessage(error)))
    .finally(() => {
      setPendingDynamicPdf(null);
      setSelectedDocument(null);
    });
  }, [dynamicValues?.resolved_content, pendingDynamicPdf, profile?.name, selectedDocument]);

  const downloadGeneratedDocument = async (document: GeneratedDocument) => {
    try {
      const values = JSON.parse(document.content) as AppointmentLetterValues & OfferLetterValues & { resolved_content?: string };
      if (values.resolved_content) {
        const targetWindow = null;
        setSelectedDocument(document);
        setPendingDynamicPdf({ document, targetWindow });
        return;
      } else if (document.document_type === "appointment_letter") {
        downloadAppointmentLetterPdf(values, file => setIOSDownloadFile(file));
      } else if (document.document_type === "offer_letter") {
        downloadOfferLetterPdf(values, file => setIOSDownloadFile(file));
      } else {
        throw new Error("This document has no renderable content");
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const saveIOSDownload = async () => {
    if (!iosDownloadFile) return;
    try {
      await shareIOSFile(iosDownloadFile);
      setIOSDownloadFile(null);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell>
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
                  <form onSubmit={handleBasicSave} className="flex-1">
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
                      ["Location", profile.location || profile.place_of_posting || "—"],
                      ["PAN No.", profile.pan_number || "—"],
                      ["Account No.", profile.account_number || "—"],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
                        <dd className="mt-1 text-sm font-medium text-ink-900">
                          {editingBasic && ["Phone number", "Email", "Location", "PAN No.", "Account No."].includes(String(label)) ? (
                            <input
                              type={label === "Email" ? "email" : label === "Phone number" ? "tel" : "text"}
                              value={label === "Email" ? profileForm.email : label === "Phone number" ? profileForm.mobile : label === "Location" ? profileForm.location : label === "PAN No." ? profileForm.pan_number : label === "Account No." ? profileForm.account_number}
                              onChange={(event) => setProfileForm({
                                ...profileForm,
                                [label === "Email" ? "email" : label === "Phone number" ? "mobile" : label === "Location" ? "location" : label === "PAN No." ? "pan_number" : label === "Account No." ? "account_number"]: event.target.value,
                              })}
                              className="w-full rounded-lg border border-ink-200 px-3 py-2"
                            />
                          ) : value}
                        </dd>
                      </div>
                    ))}
                    </dl>
                    <div className="mt-5 flex gap-2">
                      {!editingBasic ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileForm((previous) => ({
                              ...previous,
                              email: profile.email || "",
                              mobile: profile.mobile || "",
                              location: profile.location || profile.place_of_posting || "",
                              pan_number: profile.pan_number || "",
                              account_number: profile.account_number || "",
                              payment_mode: profile.payment_mode || "",
                            }));
                            setEditingBasic(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium"
                        >
                          <Pencil size={14} /> Edit details
                        </button>
                      ) : (
                        <>
                          <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Save</button>
                          <button type="button" onClick={() => setEditingBasic(false)} className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium">Cancel</button>
                        </>
                      )}
                    </div>
                  </form>
                </div>
              ) : (
                <p className="text-sm text-ink-500">Loading profile…</p>
              )}
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-semibold">Address Details</h2>{!editingAddress && <button type="button" onClick={() => setEditingAddress(true)} className="inline-flex items-center gap-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium"><Pencil size={14} /> Edit</button>}</div>
              <form onSubmit={(event) => handleProfileSave(event, "address")} className="space-y-4">
                <fieldset disabled={!editingAddress} className="grid gap-4 md:grid-cols-2">
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
                {editingAddress && <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                  Save Address
                </button>
                }
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
                          <button type="button" onClick={() => void handleDownloadPersonalDoc(doc.id, doc.original_filename)} style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", pointerEvents: "auto" }} className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-brand-700"><Download size={14} /> Download</button>
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
          <div className="space-y-5">
            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold">Salary Slip Requests</h2><p className="mt-1 text-sm text-ink-500">Choose a month and submit your salary details for review.</p></div>
                {!showSalaryRequest && <button onClick={() => setShowSalaryRequest(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Request Salary Slip</button>}
              </div>
              {pendingSalaryRequests.length > 0 && <div className="mt-4 space-y-2">{pendingSalaryRequests.map(slip => <div key={slip.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm"><span>{new Date(slip.year, slip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</span><div className="flex items-center gap-3"><span className="font-medium text-amber-800">Pending Review</span><button onClick={async () => { if (!window.confirm("Cancel this pending salary slip request?")) return; try { await api.delete(`/employee-documents/salary-slips/mine/${slip.id}`); setSlips(current => current.filter(item => item.id !== slip.id)); toast.success("Salary slip request cancelled"); } catch (error) { toast.error(getErrorMessage(error)); } }} className="inline-flex items-center gap-1 text-red-600"><Trash2 size={14} /> Cancel Request</button></div></div>)}</div>}
              {showSalaryRequest && <div className="mt-5 border-t border-ink-100 pt-5">
                <label className="block max-w-xs text-sm font-medium">Month &amp; Year<input type="month" value={salaryRequestPeriod} onChange={event => setSalaryRequestPeriod(event.target.value)} className="mt-1 block w-full rounded-lg border-ink-200" /></label>
                {selectedPeriodSlip ? <p className="mt-4 rounded-lg bg-ink-50 p-3 text-sm text-ink-600">A request for this month already exists: <strong>{selectedPeriodSlip.status}</strong>.</p> : <>
                  <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200">
                    <table className="w-full table-fixed text-sm">
                      <thead className="bg-ink-50 text-left text-ink-600"><tr><th className="w-3/5 px-3 py-3">Earning</th><th className="w-2/5 px-3 py-3">Amount</th></tr></thead>
                      <tbody>{salaryRequestRows.map((row, index) => <tr key={index} className="border-t border-ink-100">
                        <td className="p-2">{row.custom ? <div className="flex min-w-0 items-center gap-1"><input aria-label="Particular / Name" placeholder="Particular / Name" value={row.name} onChange={event => setSalaryRequestRows(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, name: event.target.value } : item))} className="min-w-0 w-full rounded-lg border-ink-200 px-2" /><button aria-label="Remove custom particular" onClick={() => setSalaryRequestRows(current => current.filter((_, rowIndex) => rowIndex !== index))} className="shrink-0 rounded-lg border border-ink-300 p-2 text-red-600"><Trash2 size={16} /></button></div> : <span className="px-1 font-medium">{row.name}</span>}</td>
                        <td className="p-2"><input aria-label={`${row.name || "Custom particular"} amount`} type="number" min="0" inputMode="decimal" value={row.amount} onChange={event => setSalaryRequestRows(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item))} className="min-w-0 w-full rounded-lg border-ink-200 px-2" /></td>
                      </tr>)}</tbody>
                      <tfoot className="border-t border-ink-200 bg-ink-50">
                        <tr><td className="px-3 py-3 font-semibold">Total Earnings</td><td className="px-3 py-3 font-semibold text-emerald-700">{money(salaryRequestTotal)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                  <button onClick={() => setSalaryRequestRows(current => [...current, { name: "", amount: "", custom: true }])} className="mt-3 text-sm font-medium text-brand-700">Other +</button>
                  <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowSalaryRequest(false)} className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium">Cancel</button><button disabled={sendingSalaryRequest} onClick={() => void submitSalarySlipRequest()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{sendingSalaryRequest ? "Sending…" : "Send Request"}</button></div>
                </>}
              </div>}
            </section>
            <section className="rounded-xl border border-ink-200 bg-white shadow-card">
              <div className="border-b border-ink-200 px-5 py-4"><h2 className="font-semibold">Final Salary Slips</h2></div>
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
                  {finalSalarySlips.length ? (
                    finalSalarySlips.map((slip) => (
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
                        No finalized salary slips available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
          </section>
          </div>
        )}

        {selectedDocument && !pendingDynamicPdf && (appointmentValues || offerValues || dynamicValues?.resolved_content) && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
            <div className="mx-auto my-4 max-w-4xl rounded-xl bg-ink-100 p-3 shadow-xl sm:p-6">
              <div className="mb-3 flex flex-wrap justify-end gap-2">
                {appointmentValues && (
                  <button
                    onClick={() => downloadAppointmentLetterPdf(appointmentValues, file => setIOSDownloadFile(file))}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium sm:flex-none"
                  >
                    <Download size={15} /> Download PDF
                  </button>
                )}
                {offerValues && (
                  <button
                    onClick={() => downloadOfferLetterPdf(offerValues, file => setIOSDownloadFile(file))}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium sm:flex-none"
                  >
                    <Download size={15} /> Download PDF
                  </button>
                )}
                {dynamicValues?.resolved_content && (
                  <button
                    onClick={() => {
                      if (selectedDocument && dynamicValues?.resolved_content) {
                        void downloadDynamicLetterPdf(selectedDocument.title, dynamicValues.resolved_content, profile?.name, dynamicPreviewRef.current, null, file => setIOSDownloadFile(file))
                          .catch(error => toast.error(getErrorMessage(error)));
                      }
                    }}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium sm:flex-none"
                  >
                    <Download size={15} /> Download PDF
                  </button>
                )}
                <button onClick={() => setSelectedDocument(null)} className="min-h-10 flex-1 rounded-lg bg-white px-4 py-2 text-sm font-medium sm:flex-none">
                  Close
                </button>
              </div>
              {appointmentValues && <AppointmentLetterPreview values={appointmentValues} />}
              {offerValues && <OfferLetterPreview values={offerValues} />}
              {dynamicValues?.resolved_content && <DynamicLetterPreview ref={dynamicPreviewRef} title={selectedDocument.title} content={dynamicValues.resolved_content} templateContent={dynamicValues.template_content} templateLayout={dynamicValues.template_layout} layoutValidated={dynamicValues.layout_validated} />}
            </div>
          </div>
        )}
        {pendingDynamicPdf && selectedDocument && dynamicValues?.resolved_content && (
          <div aria-hidden="true" style={HIDDEN_PDF_PREVIEW_CONTAINER_STYLE}>
            <DynamicLetterPreview ref={dynamicPreviewRef} title={selectedDocument.title} content={dynamicValues.resolved_content} templateContent={dynamicValues.template_content} templateLayout={dynamicValues.template_layout} layoutValidated={dynamicValues.layout_validated} />
          </div>
        )}
        {selectedSlip && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
            <div className="mx-auto my-8 max-w-3xl rounded-xl bg-ink-100 p-3 shadow-xl sm:p-6">
              <div className="mb-3 flex justify-end">
                <button onClick={() => setSelectedSlip(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm">Close</button>
              </div>
              <article className="mx-auto min-h-680px max-w-794px bg-white p-6 text-sm text-ink-800 shadow-sm sm:p-10">
                <header className="border-b-2 border-brand-600 pb-3"><div className="flex items-center justify-between gap-5"><div className="flex min-w-0 items-center gap-4"><img src={EMPLOYEE_DOCUMENT_LOGO_PATH} alt="PropCheckup logo" className="h-14 w-14 shrink-0 rounded object-contain" /><div><h2 className="truncate text-xl font-bold text-ink-900">PropCheckup</h2><p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-ink-500">Salary Slip</p></div></div><p className="shrink-0 text-right text-xs text-ink-600">For the month of<br /><span className="font-semibold text-ink-900">{new Date(selectedSlip.year, selectedSlip.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}</span></p></div></header>
                {(() => {
                  const details = slipEmployeeDetails(selectedSlip, profile);
                  const earnings = selectedSlip.earnings || (JSON.parse(selectedSlip.particulars || "[]") as SalaryRow[]);
                  const deductions = selectedSlip.deductions || [];
                  const totalEarnings = selectedSlip.total_earnings ?? selectedSlip.total_amount;
                  const totalDeductions = selectedSlip.total_deductions ?? 0;
                  const netPay = selectedSlip.net_pay ?? selectedSlip.total_amount;
                  return <>
                    <section className="mt-3"><h3 className="border-b border-ink-200 pb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Employee Details</h3><dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">{([["Name", details.name], ["Designation", details.designation], ["Department", details.department], ["Phone Number", details.phone_number], ["Email", details.email], ["Joining Date", details.joining_date], ["PAN No.", details.pan_number], ["Account No.", details.account_number], ["Location", details.location], ["Payment Mode", details.payment_mode], ["Days in Month", details.days_in_month], ["Days Worked", details.days_worked], ["LWP Days", selectedSlip.lwp_days || 0]] as [string, string | number][]).map(([label, value]) => <div key={label}><dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt><dd className="mt-1 font-medium text-ink-900">{value ?? "?"}</dd></div>)}</dl></section>
                    <section className="mt-7"><h3 className="border-b border-ink-200 pb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Earnings</h3><div className="mt-3 overflow-hidden rounded-lg border border-ink-200"><table className="w-full text-sm"><thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-800"><tr><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Amount</th></tr></thead><tbody>{earnings.map((row, index) => <tr key={`${row.name}-${index}`} className={index % 2 === 0 ? "bg-ink-50/60" : "bg-white"}><td className="px-4 py-2">{row.name}</td><td className="px-4 py-2 text-right font-medium">{money(row.amount)}</td></tr>)}</tbody><tfoot className="border-t bg-brand-50"><tr><th className="px-4 py-2 text-left">Total Earnings</th><th className="px-4 py-2 text-right">{money(totalEarnings)}</th></tr></tfoot></table></div></section>
                    <section className="mt-7"><h3 className="border-b border-ink-200 pb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Deductions</h3><div className="mt-3 overflow-hidden rounded-lg border border-ink-200"><table className="w-full text-sm"><thead className="bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-800"><tr><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Amount</th></tr></thead><tbody><tr className="bg-ink-50/60"><td className="px-4 py-2">LWP Deduction</td><td className="px-4 py-2 text-right font-medium">{money(selectedSlip.lop_deduction || 0)}</td></tr>{deductions.map((row, index) => <tr key={`${row.name}-${index}`} className={index % 2 === 0 ? "bg-white" : "bg-ink-50/60"}><td className="px-4 py-2">{row.name}</td><td className="px-4 py-2 text-right font-medium">{money(row.amount)}</td></tr>)}</tbody><tfoot className="border-t bg-brand-50"><tr><th className="px-4 py-2 text-left">Total Deductions</th><th className="px-4 py-2 text-right">{money(totalDeductions)}</th></tr></tfoot></table></div></section>
                    <section className="mt-5 rounded-lg bg-brand-50 p-4"><div className="flex justify-between text-base font-bold"><span>Net Pay</span><span>{money(netPay)}</span></div><p className="mt-2 text-xs"><strong>Amount in Words:</strong> {numberWords(netPay)}</p><p className="mt-2 text-center text-xs text-ink-500">This is a system-generated salary slip. No signature is required.</p></section>
                  </>;
                })()}
                <footer className="mt-8 border-t border-ink-200 pt-4 text-center text-xs leading-relaxed text-ink-500"><p>{companyBranding?.company_address || "?"}</p></footer>
              </article>
              <button onClick={() => void downloadSalarySlip(selectedSlip)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"><Download size={14} /> Download PDF</button>
            </div>
          </div>
        )}
        {iosDownloadFile && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-ink-900">File ready to save</h2>
              <p className="mt-2 text-sm text-ink-600">Tap Save to Files to choose where to save <span className="font-medium">{iosDownloadFile.name}</span>.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setIOSDownloadFile(null)} className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700">Cancel</button>
                <button type="button" onClick={() => void saveIOSDownload()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Save to Files</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  ); 
}
