"use client";

import { useState } from "react";
import { OfferLetterPreview } from "./OfferLetterGenerator";
import { AppointmentLetterPreview } from "./AppointmentLetterGenerator";
import { type OfferLetterValues } from "@/lib/offerLetterPdf";
import { type AppointmentLetterValues } from "@/lib/appointmentLetterPdf";

const companyAddress = "D1, Plot No. 275, Shree Samarth CHS, Gorai 2, Mumbai - 400091";

const templateExamples = {
  offer: {
    label: "Offer Letter",
    description: "Template for offer letters sent to new candidates",
    values: {
      employee_name: "John Doe",
      designation: "Senior Inspector",
      department: "Property Inspection",
      place_of_posting: "Mumbai",
      date_of_joining: "01/09/2026",
      letter_date: "15/08/2026",
      company_address: companyAddress,
      acceptance_date: "25/08/2026",
    } satisfies OfferLetterValues,
  },
  appointment: {
    label: "Appointment Letter",
    description: "Template for appointment letters sent to selected candidates",
    values: {
      employee_name: "Jane Smith",
      designation: "Property Analyst",
      department: "Analysis",
      office_location: "Mumbai",
      start_date: "01/09/2026",
      letter_date: "15/08/2026",
      company_address: companyAddress,
      salary: "₹25,000 - ₹35,000 per month",
      working_hours: "9:30 AM to 6:30 PM",
      working_days: "6 days of the week",
      authorized_signatory: "Authorized Signatory",
    } satisfies AppointmentLetterValues,
  },
} as const;

export default function LetterTemplatesViewer() {
  const [selectedTemplate, setSelectedTemplate] = useState<"offer" | "appointment">(
    "offer"
  );

  const currentTemplate =
    selectedTemplate === "offer" ? templateExamples.offer : templateExamples.appointment;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Letter Templates</h2>
          <p className="text-sm text-ink-500">
            View predefined templates. To generate and send letters to employees, go to
            Letters tab.
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          {(["offer", "appointment"] as const).map((templateType) => (
            <button
              key={templateType}
              onClick={() => setSelectedTemplate(templateType)}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                selectedTemplate === templateType
                  ? "bg-brand-600 text-white"
                  : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
              }`}
            >
              {templateExamples[templateType as "offer" | "appointment"].label}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-lg bg-brand-50 p-3">
          <p className="text-sm text-brand-900">
            {currentTemplate.description}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-ink-200 bg-ink-100 p-3 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-ink-500">
            TEMPLATE PREVIEW — {currentTemplate.label}
          </p>
          <p className="text-xs text-ink-400">
            (Sample data shown for reference)
          </p>
        </div>
        {selectedTemplate === "offer" ? (
          <OfferLetterPreview values={templateExamples.offer.values} />
        ) : (
          <AppointmentLetterPreview values={templateExamples.appointment.values} />
        )}
      </section>

      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
        <h3 className="font-semibold mb-3">How to Use</h3>
        <ul className="space-y-2 text-sm text-ink-600">
          <li>
            ✓ Go to <strong>Letters</strong> tab to generate and send letters to
            specific employees
          </li>
          <li>✓ Select an employee and choose the letter type</li>
          <li>✓ Employee details will auto-populate from their profile</li>
          <li>✓ Customize the letter content as needed</li>
          <li>✓ Preview before sending</li>
          <li>
            ✓ Save as draft or send directly to the employee's Documents
          </li>
        </ul>
      </section>
    </div>
  );
}
