"use client";

/**
 * components/Reports/ReportForm.tsx
 * Daily Report submission form with pre-built forms for each department.
 * - B2B: Shows Document (Quotation/Invoice/Report) + Schedule (Schedule Confirmation/Calendar Update)
 * - B2C: Shows Document (Quotation/Invoice/Report) + Schedule (Schedule Confirmation/Calendar Update) + Leads (Lead Update/Follow-up)
 * - HR: Shows only description textarea
 * - IT: Shows only description textarea
 * 
 * Duration is a text field so users can enter "1hr 12min", "45min", etc.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";

interface ReportFormProps {
  attendanceDate?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

// Pre-defined form structure for each department
const DEPARTMENTS = [
  { id: 1, name: "B2B" },
  { id: 2, name: "B2C" },
  { id: 3, name: "HR" },
  { id: 4, name: "IT" },
];

// Pre-defined types and subtypes for B2B
const B2B_TYPES = [
  {
    id: 1,
    name: "Document",
    subtypes: [
      { id: 1, name: "Quotation" },
      { id: 2, name: "Invoice" },
      { id: 3, name: "Report" },
    ]
  },
  {
    id: 2,
    name: "Schedule",
    subtypes: [
      { id: 4, name: "Schedule Confirmation" },
      { id: 5, name: "Calendar Update" },
    ]
  }
];

// Pre-defined types and subtypes for B2C
const B2C_TYPES = [
  {
    id: 3,
    name: "Document",
    subtypes: [
      { id: 6, name: "Quotation" },
      { id: 7, name: "Invoice" },
      { id: 8, name: "Report" },
    ]
  },
  {
    id: 4,
    name: "Schedule",
    subtypes: [
      { id: 9, name: "Schedule Confirmation" },
      { id: 10, name: "Calendar Update" },
    ]
  },
  {
    id: 5,
    name: "Leads",
    subtypes: [
      { id: 11, name: "Lead Update" },
      { id: 12, name: "Follow-up" },
    ]
  }
];

// Get subtypes for a department
const getSubtypesForDepartment = (deptName: string) => {
  if (deptName === "B2B") {
    return B2B_TYPES;
  } else if (deptName === "B2C") {
    return B2C_TYPES;
  }
  return [];
};

export default function ReportForm({ attendanceDate, onSuccess, onCancel }: ReportFormProps) {
  const session = getSession();
  const [selectedDept, setSelectedDept] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [reportData, setReportData] = useState<Record<string, any>>({});

  const today = attendanceDate || new Date().toISOString().slice(0, 10);
  const selectedDeptName = DEPARTMENTS.find(d => d.id === selectedDept)?.name || "";

  // Get the types for the selected department
  const types = getSubtypesForDepartment(selectedDeptName);

  // Handle input change for a specific field
  const handleFieldChange = (field: string, value: any) => {
    setReportData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Reset form when department changes
  const handleDepartmentChange = (deptId: number | "") => {
    setSelectedDept(deptId);
    setReportData({});
  };

  const handleSubmit = async () => {
    if (!selectedDept) {
      toast.error("Please select a department");
      return;
    }

    const deptName = DEPARTMENTS.find(d => d.id === selectedDept)?.name;

    // For HR/IT, description is required
    if (deptName === "HR" || deptName === "IT") {
      if (!reportData.description?.trim()) {
        toast.error("Please enter a description");
        return;
      }
    }

    // For B2B/B2C, validate that at least one entry has data
    if (deptName === "B2B" || deptName === "B2C") {
      let hasData = false;
      const entries: any[] = [];

      // Check all types and subtypes for data
      for (const type of types) {
        for (const subtype of type.subtypes) {
          const key = `${type.name}-${subtype.name}`;
          const quantity = reportData[`${key}-quantity`];
          const duration = reportData[`${key}-duration`];
          
          if (quantity || duration) {
            hasData = true;
            entries.push({
              type_id: type.id,
              subtype_id: subtype.id,
              type_name: type.name,
              subtype_name: subtype.name,
              quantity: quantity || 0,
              duration: duration || "",
            });
          }
        }
      }

      if (!hasData) {
        toast.error("Please fill in at least one entry");
        return;
      }

      // Submit each entry
      setSubmitting(true);
      try {
        for (const entry of entries) {
          const payload = {
            user_id: session?.userId,
            attendance_date: today,
            department_id: selectedDept,
            type_id: entry.type_id,
            subtype_id: entry.subtype_id,
            quantity: entry.quantity,
            duration: entry.duration,
          };
          await api.post("/reports/submit", payload);
        }
        toast.success(`Submitted ${entries.length} report(s) successfully!`);
        onSuccess();
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // For HR/IT - single submission
    setSubmitting(true);
    try {
      const payload = {
        user_id: session?.userId,
        attendance_date: today,
        department_id: selectedDept,
        description: reportData.description,
      };
      await api.post("/reports/submit", payload);
      toast.success("Report submitted successfully!");
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const renderB2BForm = () => (
    <div className="space-y-6">
      {B2B_TYPES.map((type) => (
        <div key={type.id} className="space-y-3">
          <h4 className="font-semibold text-ink-800 border-b border-ink-200 pb-2">{type.name}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {type.subtypes.map((subtype) => {
              const key = `${type.name}-${subtype.name}`;
              return (
                <div key={subtype.id} className="rounded-lg border border-ink-200 p-4">
                  <p className="font-medium text-sm text-ink-700 mb-2">{subtype.name}</p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-ink-500">Quantity</label>
                      <input
                        type="number"
                        min="0"
                        value={reportData[`${key}-quantity`] || ""}
                        onChange={(e) => handleFieldChange(`${key}-quantity`, e.target.value)}
                        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
                        placeholder="Enter quantity"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-ink-500">Duration</label>
                      <input
                        type="text"
                        value={reportData[`${key}-duration`] || ""}
                        onChange={(e) => handleFieldChange(`${key}-duration`, e.target.value)}
                        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
                        placeholder="e.g. 1hr 12min"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const renderB2CForm = () => (
    <div className="space-y-6">
      {B2C_TYPES.map((type) => (
        <div key={type.id} className="space-y-3">
          <h4 className="font-semibold text-ink-800 border-b border-ink-200 pb-2">{type.name}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {type.subtypes.map((subtype) => {
              const key = `${type.name}-${subtype.name}`;
              return (
                <div key={subtype.id} className="rounded-lg border border-ink-200 p-4">
                  <p className="font-medium text-sm text-ink-700 mb-2">{subtype.name}</p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-ink-500">Quantity</label>
                      <input
                        type="number"
                        min="0"
                        value={reportData[`${key}-quantity`] || ""}
                        onChange={(e) => handleFieldChange(`${key}-quantity`, e.target.value)}
                        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
                        placeholder="Enter quantity"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-ink-500">Duration</label>
                      <input
                        type="text"
                        value={reportData[`${key}-duration`] || ""}
                        onChange={(e) => handleFieldChange(`${key}-duration`, e.target.value)}
                        className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm"
                        placeholder="e.g. 1hr 12min"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const renderHRForm = () => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-700">Description</label>
      <textarea
        value={reportData.description || ""}
        onChange={(e) => handleFieldChange("description", e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
        placeholder="Enter your daily report details..."
      />
    </div>
  );

  const renderITForm = () => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-700">Description</label>
      <textarea
        value={reportData.description || ""}
        onChange={(e) => handleFieldChange("description", e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
        placeholder="Enter your daily report details..."
      />
    </div>
  );

  const renderForm = () => {
    if (selectedDeptName === "B2B") return renderB2BForm();
    if (selectedDeptName === "B2C") return renderB2CForm();
    if (selectedDeptName === "HR") return renderHRForm();
    if (selectedDeptName === "IT") return renderITForm();
    return null;
  };

  return (
    <div className="space-y-5">
      {/* Date */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
        <input
          type="date"
          value={today}
          disabled
          className="w-full rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm text-ink-500"
        />
      </div>

      {/* Department */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Department</label>
        <select
          value={selectedDept}
          onChange={(e) => handleDepartmentChange(e.target.value ? Number(e.target.value) : "")}
          className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
        >
          <option value="">Select Department</option>
          {DEPARTMENTS.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>

      {/* Dynamic Form based on selected department */}
      {selectedDept && renderForm()}

      {/* Buttons */}
      <div className="flex justify-end gap-2 pt-4 border-t border-ink-200">
        <button
          onClick={onCancel}
          className="rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !selectedDept}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting..." : "Submit Report"}
        </button>
      </div>
    </div>
  );
}