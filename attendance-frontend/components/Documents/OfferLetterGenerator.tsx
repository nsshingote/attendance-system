"use client";

import { useEffect, useState } from "react";
import { Eye, FilePlus2, Send } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { type OfferLetterValues } from "@/lib/offerLetterPdf";

type Employee = { 
  id: number; 
  name: string; 
  designation: string; 
  department: string; 
  place_of_posting: string | null;
  date_of_joining: string | null;
  created_at: string; 
  role: string 
};

const companyAddress = "D1, Plot No. 275, Shree Samarth CHS, Gorai 2, Mumbai - 400091";
const dateValue = (date: Date | string) => new Date(date).toLocaleDateString("en-GB");

export function OfferLetterPreview({ values }: { values: OfferLetterValues }) {
  return (
    <article className="mx-auto min-h-760px max-w-760px bg-white p-6 font-serif text-[13px] leading-relaxed text-slate-900 shadow-sm sm:p-10">
      <header className="border-b-4 border-orange-500 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-3xl font-bold">
              <span className="text-orange-500">Prop</span>
              <span className="text-blue-900">Checkup</span>
            </div>
            <p className="text-xs font-semibold text-orange-600">India's First Home Inspection Startup</p>
          </div>
          <div className="text-right font-sans text-xs text-blue-900">
            <p>www.propcheckup.com</p>
            <p>info@propcheckup.com</p>
            <p>+91- 8689868659</p>
          </div>
        </div>
      </header>

      <h1 className="my-5 text-center text-xl font-bold">OFFER LETTER</h1>
      <p>Date: <strong className="underline">{values.letter_date}</strong></p>
      <p className="mt-3"><strong>Company Address</strong> - {values.company_address}</p>

      <p className="mt-5">To,</p>
      <p className="font-bold underline">{values.employee_name}</p>
      <p className="mt-3 font-bold">› Subject: Offer for Position of {values.designation}</p>
      <p className="mt-3">Dear <strong className="underline">{values.employee_name}</strong>,</p>

      <p className="mt-3">We are pleased to extend an offer of employment to you for the position of <strong>{values.designation}</strong> at <strong>PropCheckup</strong>. We believe your skills and experience make you an excellent fit for our organization.</p>

      <ul className="mt-3 list-disc space-y-1 pl-6">
        <li>Position: <strong>{values.designation}</strong></li>
        <li>Department: <strong>{values.department}</strong></li>
        <li>Place of Posting: <strong>{values.place_of_posting}</strong></li>
        <li>Date of Joining: <strong>{values.date_of_joining}</strong></li>
      </ul>

      <p className="mt-3">This offer is contingent upon:</p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Satisfactory background verification</li>
        <li>Submission of required documents</li>
        <li>Compliance with company policies</li>
      </ul>

      <p className="mt-3">The compensation and benefits will be discussed and finalized with the HR department. We look forward to your positive response by the date specified below.</p>

      {values.acceptance_date && (
        <p className="mt-3">Expected Response Date: <strong>{values.acceptance_date}</strong></p>
      )}

      <p className="mt-3">Please confirm your acceptance or discuss any queries with our HR department.</p>
      <p className="mt-3">We look forward to having you join PropCheckup.</p>
      <p className="mt-5">Sincerely,</p>
      <p className="mt-8 font-bold">Authorized Signatory</p>
      <p className="font-bold">PropCheckup</p>

      <p className="mt-8 font-bold">• Offer Acceptance</p>
      <p>I, {values.employee_name}, accept the terms and conditions mentioned in this offer letter.</p>
      <p className="mt-2">Signature: ____________________                 Date: ______________</p>
    </article>
  );
}

export default function OfferLetterGenerator() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<OfferLetterValues>({
    employee_name: "",
    designation: "",
    department: "",
    place_of_posting: "",
    date_of_joining: "",
    letter_date: dateValue(new Date()),
    company_address: companyAddress,
    acceptance_date: "",
  });

  useEffect(() => {
    api
      .get("/users/")
      .then(({ data }) => setEmployees(data.filter((employee: Employee) => employee.role === "user")))
      .catch((error) => toast.error(getErrorMessage(error)));
  }, []);

  const selectEmployee = (id: string) => {
    setEmployeeId(id);
    const employee = employees.find((item) => String(item.id) === id);
    if (employee) {
      setValues((previous) => ({
        ...previous,
        employee_name: employee.name,
        designation: employee.designation,
        department: employee.department,
        place_of_posting: employee.place_of_posting || "",
        date_of_joining: employee.date_of_joining 
          ? dateValue(employee.date_of_joining)
          : dateValue(employee.created_at),
      }));
    }
  };

  const update = (key: keyof OfferLetterValues, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const save = async (send: boolean) => {
    if (!employeeId) return toast.error("Select an employee");
    setSaving(true);
    try {
      await api.post("/employee-documents/letters/offer", {
        employee_id: Number(employeeId),
        ...values,
        send,
      });
      toast.success(send ? "Offer letter sent to employee documents" : "Offer letter draft saved");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const fields: [keyof OfferLetterValues, string][] = [
    ["employee_name", "Employee Name"],
    ["designation", "Job Title"],
    ["department", "Department"],
    ["place_of_posting", "Place of Posting"],
    ["date_of_joining", "Date of Joining"],
    ["letter_date", "Letter Date"],
    ["acceptance_date", "Expected Response Date (Optional)"],
    ["company_address", "Company Address"],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Offer Letter</h2>
            <p className="text-sm text-ink-500">Select an employee, edit the details, preview, then save a draft or send the letter.</p>
          </div>
          <FilePlus2 className="text-brand-600" />
        </div>
        <label className="mt-5 block max-w-md text-sm font-medium">
          Select Employee
          <select
            value={employeeId}
            onChange={(event) => selectEmployee(event.target.value)}
            className="mt-1 block w-full rounded-lg border-ink-200"
          >
            <option value="">Select employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {employeeId && (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h3 className="font-semibold">Editable letter details</h3>
            <p className="mb-4 text-xs text-ink-500">Changes apply only to this offer letter.</p>
            <div className="space-y-3">
              {fields.map(([key, label]) => (
                <label key={key} className="block text-xs font-medium text-ink-600">
                  {label}
                  <input
                    value={values[key]}
                    onChange={(event) => update(key, event.target.value)}
                    className="mt-1 block w-full rounded-lg border-ink-200 text-sm"
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 grid gap-2">
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 text-sm font-medium"
              >
                <Eye size={16} /> Generate Draft
              </button>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Send size={16} /> Send to Employee
              </button>
            </div>
          </section>

          <div className="rounded-xl border border-ink-200 bg-ink-100 p-3 sm:p-6">
            <p className="mb-3 text-xs font-medium text-ink-500">PREVIEW</p>
            <OfferLetterPreview values={values} />
          </div>
        </div>
      )}
    </div>
  );
}
