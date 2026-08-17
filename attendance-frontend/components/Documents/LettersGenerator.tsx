"use client";

import { useEffect, useState } from "react";
import { Eye, FilePlus2, Send } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { OfferLetterPreview } from "./OfferLetterGenerator";
import { AppointmentLetterPreview } from "./AppointmentLetterGenerator";
import { type OfferLetterValues } from "@/lib/offerLetterPdf";
import { type AppointmentLetterValues } from "@/lib/appointmentLetterPdf";

type Employee = {
  id: number;
  name: string;
  designation: string;
  department: string;
  place_of_posting: string | null;
  date_of_joining: string | null;
  created_at: string;
  role: string;
};

type LetterType = "offer" | "appointment";

interface LetterTemplate {
  type: LetterType;
  label: string;
  fields: Array<[string, string]>;
  getDefaultValues: (employee: Employee) => Record<string, string>;
}

const companyAddress = "D1, Plot No. 275, Shree Samarth CHS, Gorai 2, Mumbai - 400091";
const dateValue = (date: Date | string) => new Date(date).toLocaleDateString("en-GB");

const templates: Record<LetterType, LetterTemplate> = {
  offer: {
    type: "offer",
    label: "Offer Letter",
    fields: [
      ["employee_name", "Employee Name"],
      ["designation", "Job Title"],
      ["department", "Department"],
      ["place_of_posting", "Place of Posting"],
      ["date_of_joining", "Date of Joining"],
      ["letter_date", "Letter Date"],
      ["acceptance_date", "Expected Response Date (Optional)"],
      ["company_address", "Company Address"],
    ],
    getDefaultValues: (employee: Employee) => ({
      employee_name: employee.name,
      designation: employee.designation,
      department: employee.department,
      place_of_posting: employee.place_of_posting || "",
      date_of_joining: employee.date_of_joining
        ? dateValue(employee.date_of_joining)
        : dateValue(employee.created_at),
      letter_date: dateValue(new Date()),
      acceptance_date: "",
      company_address: companyAddress,
    }),
  },
  appointment: {
    type: "appointment",
    label: "Appointment Letter",
    fields: [
      ["employee_name", "Employee Name"],
      ["designation", "Job Title"],
      ["department", "Department"],
      ["office_location", "Office Location / Place of Posting"],
      ["start_date", "Start Date"],
      ["letter_date", "Letter Date"],
      ["salary", "Salary"],
      ["working_hours", "Working Hours"],
      ["working_days", "Working Days"],
      ["authorized_signatory", "Authorized Signatory"],
      ["company_address", "Company Address"],
    ],
    getDefaultValues: (employee: Employee) => ({
      employee_name: employee.name,
      designation: employee.designation,
      department: employee.department,
      office_location: employee.place_of_posting || "",
      start_date: employee.date_of_joining
        ? dateValue(employee.date_of_joining)
        : dateValue(employee.created_at),
      letter_date: dateValue(new Date()),
      salary: "",
      working_hours: "9:30 AM to 6:30 PM",
      working_days: "6 days of the week",
      authorized_signatory: "Authorized Signatory",
      company_address: companyAddress,
    }),
  },
};

export default function LettersGenerator() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [letterType, setLetterType] = useState<LetterType>("offer");
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .get("/users/")
      .then(({ data }) => setEmployees(data.filter((employee: Employee) => employee.role === "user")))
      .catch((error) => toast.error(getErrorMessage(error)));
  }, []);

  const template = templates[letterType];

  const selectEmployee = (id: string) => {
    setEmployeeId(id);
    const employee = employees.find((item) => String(item.id) === id);
    if (employee) {
      setValues(template.getDefaultValues(employee));
    }
  };

  const selectLetterType = (type: LetterType) => {
    setLetterType(type);
    if (employeeId) {
      const employee = employees.find((item) => String(item.id) === employeeId);
      if (employee) {
        setValues(templates[type].getDefaultValues(employee));
      }
    }
  };

  const update = (key: string, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const save = async (send: boolean) => {
    if (!employeeId) return toast.error("Select an employee");
    setSaving(true);
    try {
      const endpoint =
        letterType === "offer"
          ? "/employee-documents/letters/offer"
          : "/employee-documents/letters/appointment";

      await api.post(endpoint, {
        employee_id: Number(employeeId),
        ...values,
        send,
      });

      toast.success(
        send
          ? `${template.label} sent to employee documents`
          : `${template.label} draft saved`
      );

      // Clear form after successful save
      if (send) {
        setEmployeeId("");
        setValues({});
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Generate Letter</h2>
            <p className="text-sm text-ink-500">
              Select an employee and letter type, then customize and send.
            </p>
          </div>
          <FilePlus2 className="text-brand-600" />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
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

          <label className="text-sm font-medium">
            Letter Type
            <select
              value={letterType}
              onChange={(event) =>
                selectLetterType(event.target.value as LetterType)
              }
              className="mt-1 block w-full rounded-lg border-ink-200"
            >
              <option value="offer">Offer Letter</option>
              <option value="appointment">Appointment Letter</option>
            </select>
          </label>
        </div>
      </section>

      {employeeId && (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h3 className="font-semibold">{template.label} Details</h3>
            <p className="mb-4 text-xs text-ink-500">
              Customize the letter details. Changes apply only to this letter.
            </p>
            <div className="space-y-3">
              {template.fields.map(([key, label]) => (
                <label key={key} className="block text-xs font-medium text-ink-600">
                  {label}
                  <input
                    value={values[key] || ""}
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
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 text-sm font-medium hover:bg-ink-50 disabled:opacity-50"
              >
                <Eye size={16} /> Generate Draft
              </button>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Send size={16} /> Send to Employee
              </button>
            </div>
          </section>

          <div className="rounded-xl border border-ink-200 bg-ink-100 p-3 sm:p-6 overflow-auto max-h-600px">
            <p className="mb-3 text-xs font-medium text-ink-500">PREVIEW</p>
            {letterType === "offer" ? (
              <OfferLetterPreview values={values as OfferLetterValues} />
            ) : (
              <AppointmentLetterPreview values={values as AppointmentLetterValues} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
