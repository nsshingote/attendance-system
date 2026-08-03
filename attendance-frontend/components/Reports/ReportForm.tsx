

"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";

interface ReportFormProps {
  userId?: number;
  attendanceDate?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

interface ReportSubtypeOption {
  id: number;
  name: string;
  type_id: number;
  has_quantity: boolean;
  has_duration: boolean;
  has_description: boolean;
  is_active: boolean;
}

const normalizeDepartmentName = (value?: string | null) => {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const findMatchingDepartment = (userDepartment: string | null | undefined, departments: any[]) => {
  const normalizedUserDept = normalizeDepartmentName(userDepartment);
  if (!normalizedUserDept) return null;

  const exactMatch = departments.find((dept: any) => normalizeDepartmentName(dept.name) === normalizedUserDept);
  if (exactMatch) return exactMatch;

  const partialMatch = departments.find((dept: any) => {
    const normalizedDeptName = normalizeDepartmentName(dept.name);
    return normalizedDeptName.includes(normalizedUserDept) || normalizedUserDept.includes(normalizedDeptName);
  });

  if (partialMatch) return partialMatch;
  return departments.length === 1 ? departments[0] : null;
};

// Helper function to get local date string (not UTC)
const getLocalDateString = (d: Date = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function ReportForm({ userId, attendanceDate, onSuccess, onCancel }: ReportFormProps) {
  const session = getSession();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Use local date string, not UTC
  const [selectedDate, setSelectedDate] = useState(attendanceDate || getLocalDateString());
  const [rows, setRows] = useState<any[]>([]);
  const [reportData, setReportData] = useState<Record<number, any>>({});
  
  const [showAddRow, setShowAddRow] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [selectedSubtypeId, setSelectedSubtypeId] = useState<number | null>(null);
  const [newRowValues, setNewRowValues] = useState({ quantity: "", duration: "", description: "" });
  const [plainDescription, setPlainDescription] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [historyReports, setHistoryReports] = useState<any[]>([]);
  
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<number | null>(null);
  const [allTypes, setAllTypes] = useState<any[]>([]);
  const [allSubtypesList, setAllSubtypesList] = useState<any[]>([]);
  const selectedDeptId = selectedDept !== null ? Number(selectedDept) : null;

  // ============================================================
  // LOAD ALL DATA
  // ============================================================
  const loadAllData = async () => {
    try {
      setLoading(true);
      const targetUserId = userId || session?.userId || 0;
      if (!targetUserId) return;
      
      const [deptRes, typeRes, subtypeRes, userRes] = await Promise.all([
        api.get("/reports/departments"),
        api.get("/reports/types"),
        api.get("/reports/subtypes"),
        api.get(`/users/${targetUserId}`)
      ]);
      
      setDepartments(deptRes.data);
      setAllTypes(typeRes.data);
      setAllSubtypesList(subtypeRes.data);

      const matchedDept = findMatchingDepartment(userRes.data.department, deptRes.data);
      if (matchedDept) {
        setSelectedDept(matchedDept.id);
      }
      
      await loadDailyReport();
      await loadHistory();
      
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // LOAD DAILY REPORT
  // ============================================================
  const loadDailyReport = async () => {
    try {
      const targetUserId = userId || session?.userId || 0;
      if (!targetUserId) return;
      
      const res = await api.get(`/reports/user-report?date=${selectedDate}`);
      
      if (res.data) {
        if (res.data.department_id !== undefined && res.data.department_id !== null) {
          setSelectedDept(Number(res.data.department_id));
        }

        const defaultIds = res.data.default_subtype_ids || [];
        const customRows = res.data.custom_rows || [];
        const reportDataRes = res.data.report_data || [];
        
        const allRows: any[] = [];
        
        defaultIds.forEach((id: number) => {
          allRows.push({
            subtype_id: id,
            is_custom: false,
            is_default: true
          });
        });
        
        customRows.forEach((row: any) => {
          const exists = allRows.some(r => r.subtype_id === row.subtype_id);
          if (!exists) {
            allRows.push({
              subtype_id: row.subtype_id,
              is_custom: true,
              is_default: false,
              row_id: row.id
            });
          }
        });
        
        setRows([...allRows]);
        
        const dataMap: Record<number, any> = {};
        reportDataRes.forEach((item: any) => {
          dataMap[item.subtype_id] = item;
        });
        setReportData(dataMap);
      }
    } catch (error) {
      console.error("Failed to load daily report:", error);
    }
  };

  // ============================================================
  // LOAD HISTORY (Past Reports)
  // ============================================================
  const loadHistory = async () => {
    try {
      const res = await api.get("/reports/history?days=30");
      setHistoryReports(res.data || []);
    } catch (error) {
      console.error("Failed to load history:", error);
    }
  };

  // ============================================================
  // ADD ROW
  // ============================================================
  const handleAddRow = async () => {
    if (!selectedSubtypeId) {
      toast.error("Please select a subtype");
      return;
    }

    const subtypeConfig = allSubtypesList.find((s: any) => s.id === selectedSubtypeId);

    try {
      const response = await api.post("/reports/user-row", {
        attendance_date: selectedDate,
        subtype_id: Number(selectedSubtypeId)
      });

      const quantity = subtypeConfig?.has_quantity
        ? (newRowValues.quantity !== "" ? Number(newRowValues.quantity) : null)
        : null;
      const duration = subtypeConfig?.has_duration
        ? (newRowValues.duration !== "" ? newRowValues.duration : null)
        : null;
      const description = session?.role !== "superadmin"
        ? (newRowValues.description.trim() || null)
        : null;

      setReportData((prev: any) => ({
        ...prev,
        [selectedSubtypeId]: {
          ...prev[selectedSubtypeId],
          subtype_id: selectedSubtypeId,
          quantity,
          duration,
          description,
        },
      }));

      setRows((prev: any[]) => [
        ...prev,
        {
          subtype_id: selectedSubtypeId,
          is_custom: true,
          is_default: false,
          row_id: response?.data?.row_id,
        },
      ]);

      toast.success("Row added successfully");
      setShowAddRow(false);
      setSelectedTypeId(null);
      setSelectedSubtypeId(null);
      setNewRowValues({ quantity: "", duration: "", description: "" });
      await loadHistory();
    } catch (error: any) {
      if (error?.response?.data?.detail === "Row already exists for this date") {
        toast("Row already exists, refreshing...");
        await loadDailyReport();
      } else {
        toast.error(getErrorMessage(error));
      }
    }
  };

  // ============================================================
  // REMOVE ROW
  // ============================================================
  const handleRemoveRow = async (rowId: number) => {
    try {
      await api.delete(`/reports/user-row/${rowId}`);
      toast.success("Row removed successfully");
      await loadDailyReport();
      await loadHistory();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // ============================================================
  // EDIT REPORT - Load data for editing (within 7 days)
  // ============================================================
  const handleEditReport = async (date: string) => {
    try {
      setSelectedDate(date);
      setShowHistory(false);
      
      // Load the report data for this date
      await loadDailyReport();
      
      // Find the report for this date and populate the description
      const reportForDate = historyReports.find(r => r.attendance_date === date);
      if (reportForDate) {
        // Check if it's HR/IT (no subtype_id)
        if (reportForDate.subtype_id === null || reportForDate.subtype_id === undefined) {
          // For HR/IT - set the description
          //setHrDescription(reportForDate.description || "");
        } else {
          // For B2B/B2C - populate the reportData
          setReportData((prev: any) => ({
            ...prev,
            [reportForDate.subtype_id]: {
              ...prev[reportForDate.subtype_id],
              subtype_id: reportForDate.subtype_id,
              quantity: reportForDate.quantity || null,
              duration: reportForDate.duration || null,
              description: reportForDate.description || null
            }
          }));
        }
      }
      
      toast.success(`Editing report for ${new Date(date).toLocaleDateString()}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // ============================================================
  // GET TYPES AND SUBTYPES
  // ============================================================
  const getTypesForDept = (deptId: number | null) => {
    if (deptId === null) return [];
    const id = Number(deptId);
    return allTypes.filter((t: any) => t.department_id === id && t.is_active);
  };

  const getSubtypesForDept = (deptId: number | null) => {
    if (deptId === null) return [];
    const deptTypes = getTypesForDept(deptId).map((t: any) => t.id);
    return allSubtypesList.filter((s: any) => deptTypes.includes(s.type_id) && s.is_active);
  };

  const getSubtypesForType = (typeId: number) => {
    return allSubtypesList.filter((s: any) => s.type_id === typeId && s.is_active);
  };

  const getSubtypeConfig = (subtypeId: number | null) => {
    if (!subtypeId) return null;
    return allSubtypesList.find((s: any) => s.id === subtypeId) as ReportSubtypeOption | undefined;
  };

  const getSubtypeName = (id: number) => {
    const s = allSubtypesList.find((x: any) => x.id === id);
    return s?.name || "Unknown";
  };

  const getTypeName = (subtypeId: number) => {
    const s = allSubtypesList.find((x: any) => x.id === subtypeId);
    if (!s) return "Unknown";
    const t = allTypes.find((x: any) => x.id === s.type_id);
    return t?.name || "Unknown";
  };

  // ============================================================
  // SUBMIT REPORT - Clear form after submit
  // ============================================================
  const handleSubmit = async () => {
    if (!selectedDept) {
      toast.error("No department selected");
      return;
    }

    const hasDynamicStructure = getSubtypesForDept(selectedDept).length > 0;

    if (!hasDynamicStructure) {
      if (!plainDescription.trim()) {
        toast.error("Please enter a description");
        return;
      }

      setSubmitting(true);
      try {
        await api.post("/reports/report-data", {
          attendance_date: selectedDate,
          subtype_id: null,
          quantity: null,
          duration: null,
          description: plainDescription.trim(),
          custom_fields: null,
        });

        toast.success("Report submitted successfully!");
        setPlainDescription("");
        await loadHistory();
        onSuccess();
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const hasData = Object.values(reportData).some((d: any) =>
      d.quantity !== null && d.quantity !== undefined && d.quantity !== "" ||
      d.duration !== null && d.duration !== undefined && d.duration !== "" ||
      d.description !== null && d.description !== undefined && d.description !== ""
    );

    if (!hasData) {
      toast.error("Please fill in at least one entry");
      return;
    }

    setSubmitting(true);
    try {
      for (const data of Object.values(reportData)) {
        if (data.subtype_id) {
          const quantity = (data.quantity !== undefined && data.quantity !== null && data.quantity !== '')
            ? Number(data.quantity)
            : null;
          
          const duration = (data.duration !== undefined && data.duration !== null && data.duration !== '')
            ? String(data.duration)
            : null;
          
          await api.post("/reports/report-data", {
            attendance_date: selectedDate,
            subtype_id: Number(data.subtype_id),
            quantity: quantity,
            duration: duration,
            description: data.description || null,
            custom_fields: null
          });
        }
      }
      
      toast.success("Report submitted successfully!");
      
      const clearedData: Record<number, any> = {};
      Object.keys(reportData).forEach((key) => {
        clearedData[Number(key)] = {
          ...reportData[Number(key)],
          quantity: null,
          duration: null,
          description: null
        };
      });
      setReportData(clearedData);
      
      await loadHistory();
      onSuccess();
      
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // RENDER ROW (table row)
  // ============================================================
  const renderRow = (row: any) => {
    const data = reportData[row.subtype_id] || {};
    const subtypeName = getSubtypeName(row.subtype_id);
    const typeName = getTypeName(row.subtype_id);
    const subtypeConfig = getSubtypeConfig(row.subtype_id);

    return (
      <tr key={row.subtype_id} className="hover:bg-ink-50/60 border-t border-ink-100">
        <td className="px-3 py-2 text-sm text-ink-700 whitespace-nowrap align-top">{typeName}</td>
        <td className="px-3 py-2 text-sm text-ink-700 whitespace-nowrap align-top">
          {subtypeName}
          {row.is_default && <span className="ml-1 text-xs text-ink-400">(Default)</span>}
        </td>
        <td className="px-3 py-2 align-top">
          {subtypeConfig?.has_quantity ? (
            <input
              type="number"
              min="0"
              value={data.quantity ?? ""}
              onChange={(e) => {
                setReportData((prev: any) => ({
                  ...prev,
                  [row.subtype_id]: {
                    ...prev[row.subtype_id],
                    subtype_id: row.subtype_id,
                    quantity: e.target.value ? parseInt(e.target.value, 10) : null,
                    duration: prev[row.subtype_id]?.duration || null,
                    description: prev[row.subtype_id]?.description || null
                  }
                }));
              }}
              placeholder="Qty"
              className="w-20 rounded border border-ink-200 px-2 py-1 text-sm"
            />
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          {subtypeConfig?.has_duration ? (
            <input
              type="text"
              value={data.duration ?? ""}
              onChange={(e) => {
                setReportData((prev: any) => ({
                  ...prev,
                  [row.subtype_id]: {
                    ...prev[row.subtype_id],
                    subtype_id: row.subtype_id,
                    quantity: prev[row.subtype_id]?.quantity || null,
                    duration: e.target.value || null,
                    description: prev[row.subtype_id]?.description || null
                  }
                }));
              }}
              placeholder="Duration"
              className="w-28 rounded border border-ink-200 px-2 py-1 text-sm"
            />
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-top min-w-200px">
          {session?.role !== "superadmin" ? (
            <textarea
              value={data.description || ""}
              onChange={(e) => {
                setReportData((prev: any) => ({
                  ...prev,
                  [row.subtype_id]: {
                    ...prev[row.subtype_id],
                    subtype_id: row.subtype_id,
                    quantity: prev[row.subtype_id]?.quantity || null,
                    duration: prev[row.subtype_id]?.duration || null,
                    description: e.target.value || null
                  }
                }));
              }}
              rows={1}
              placeholder="Additional note"
              className="w-full rounded border border-ink-200 px-2 py-1 text-sm"
            />
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-top text-right">
          {row.is_custom && row.row_id && (
            <button
              onClick={() => handleRemoveRow(row.row_id)}
              className="px-2 text-sm text-red-500 hover:text-red-700"
              aria-label="Remove row"
            >
              ✕
            </button>
          )}
        </td>
      </tr>
    );
  };

  // ============================================================
  // RENDER HISTORY TABLE
  // ============================================================
  const renderHistory = () => {
  if (historyReports.length === 0) {
    return <p className="text-center py-8 text-ink-500">No past reports found.</p>;
  }

  const isWithin7Days = (date: string) => {
    const reportDate = new Date(date);
    const today = new Date();
    const diffTime = today.getTime() - reportDate.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);
    return diffDays <= 7;
  };

  const hasDynamicStructureForHistory =
    selectedDeptId !== null
      ? getSubtypesForDept(selectedDeptId).length > 0
      : false;

  const groupedHistory = historyReports.reduce((acc: any[], report: any) => {
    const existing = acc.find((entry) => entry.date === report.attendance_date);
    if (existing) {
      existing.items.push(report);
    } else {
      acc.push({ date: report.attendance_date, items: [report] });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-4">
      {groupedHistory.map((group: any) => (
        <div
          key={group.date}
          className="rounded-lg border border-ink-200 bg-white"
        >
          <div className="border-b border-ink-100 bg-ink-50 px-4 py-2 text-sm font-semibold text-ink-700">
            {new Date(group.date).toLocaleDateString()}
          </div>

          {/* Horizontal Scroll */}
          <div className="overflow-x-auto">
            <table className="min-w-900px w-full text-left text-sm">
              <thead className="bg-white">
                <tr>
                  {hasDynamicStructureForHistory && (
                    <>
                      <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                        Type
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                        Subtype
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                        Qty
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                        Duration
                      </th>
                      <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                        Description
                      </th>
                    </>
                  )}

                  {!hasDynamicStructureForHistory && (
                    <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                      Description
                    </th>
                  )}

                  <th className="px-4 py-2 text-xs font-medium text-ink-500 uppercase whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-ink-100">
                {group.items.map((report: any) => {
                  const canEdit = isWithin7Days(report.attendance_date);

                  return (
                    <tr key={report.id} className="hover:bg-ink-50/60">
                      {hasDynamicStructureForHistory ? (
                        <>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {getTypeName(report.subtype_id)}
                          </td>

                          <td className="px-4 py-2 whitespace-nowrap">
                            {getSubtypeName(report.subtype_id)}
                          </td>

                          <td className="px-4 py-2 whitespace-nowrap">
                            {report.quantity || "—"}
                          </td>

                          <td className="px-4 py-2 whitespace-nowrap">
                            {report.duration || "—"}
                          </td>

                          <td className="px-4 py-2 min-w-300px">
                            {report.description || "—"}
                          </td>
                        </>
                      ) : (
                        <td className="px-4 py-2 min-w-300px">
                          {report.description || "—"}
                        </td>
                      )}

                      <td className="px-4 py-2 whitespace-nowrap">
                        {canEdit ? (
                          <button
                            onClick={() =>
                              handleEditReport(report.attendance_date)
                            }
                            className="text-sm font-medium text-brand-600 hover:text-brand-700"
                          >
                            ✏️ Edit
                          </button>
                        ) : (
                          <span className="text-sm text-ink-400">
                            🔒 Expired
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

  // ============================================================
  // INITIAL LOAD
  // ============================================================
  useEffect(() => {
    loadAllData();
  }, []);

  // ============================================================
  // REFRESH WHEN DATE CHANGES
  // ============================================================
  useEffect(() => {
    if (!loading) {
      loadDailyReport();
    }
  }, [selectedDate]);

  if (loading) {
    return <div className="text-center py-8 text-ink-500">Loading your report...</div>;
  }

  const hasDynamicStructure = rows.some((row: any) => row.subtype_id) ||
    (selectedDeptId !== null ? getSubtypesForDept(selectedDeptId).length > 0 : false);

  // ============================================================
  // HISTORY VIEW
  // ============================================================
  if (showHistory) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-900">My Past Reports</h3>
          <button
            onClick={() => setShowHistory(false)}
            className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            ← Back to Today's Report
          </button>
        </div>
        {renderHistory()}
      </div>
    );
  }
  
  // ============================================================
  // HR/IT VIEW
  // ============================================================
  if (!hasDynamicStructure) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
            />
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="mt-6 rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
          >
            📄 View Past Reports
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Description</label>
          <textarea
            value={plainDescription}
            onChange={(e) => setPlainDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
            placeholder="Enter your daily report details..."
          />
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-ink-200">
          <button onClick={onCancel} className="rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // B2B/B2C VIEW
  // ============================================================
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm"
          />
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="mt-6 rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          📄 View Past Reports
        </button>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">Department</label>
        <select
          value={selectedDept || ""}
          disabled={true}
          className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm bg-ink-50 text-ink-600 cursor-not-allowed"
        >
          <option value="">Select Department</option>
          {departments.map((dept: any) => (
            <option key={dept.id} value={dept.id}>{dept.name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-400">Department is locked</p>
      </div>

      <button
        onClick={() => setShowAddRow(true)}
        className="flex items-center gap-2 rounded-lg border border-dashed border-ink-300 px-4 py-2 text-sm text-ink-600 hover:border-brand-400"
      >
        <span className="text-lg">+</span> Add Row
      </button>

      <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-500 text-center py-8">No rows added yet. Click "Add Row" to add entries.</p>
        ) : (
          <table className="w-full min-w-650px text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-[10px] uppercase tracking-wide text-ink-500">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Subtype</th>
                <th className="px-3 py-2 font-medium">Quantity</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Additional Note</th>
                <th className="px-3 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => renderRow(row))}
            </tbody>
          </table>
        )}
      </div>

      {showAddRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-ink-900 mb-4">Add Row</h3>
            
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Type</label>
                <select
                  value={selectedTypeId || ""}
                  onChange={(e) => {
                    setSelectedTypeId(Number(e.target.value));
                    setSelectedSubtypeId(null);
                  }}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <option value="">Select Type</option>
                  {getTypesForDept(selectedDept || 0).map((type: any) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Subtype</label>
                <select
                  value={selectedSubtypeId || ""}
                  onChange={(e) => setSelectedSubtypeId(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  disabled={!selectedTypeId}
                >
                  <option value="">Select Subtype</option>
                  {(selectedTypeId ? getSubtypesForType(selectedTypeId) : []).map((subtype: any) => (
                    <option key={subtype.id} value={subtype.id}>{subtype.name}</option>
                  ))}
                </select>
              </div>

              {selectedSubtypeId && (() => {
                const selectedSubtypeConfig = getSubtypeConfig(selectedSubtypeId);
                return (
                  <>
                    {selectedSubtypeConfig?.has_quantity ? (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-ink-700">Quantity</label>
                        <input
                          type="number"
                          min="0"
                          value={newRowValues.quantity}
                          onChange={(e) => setNewRowValues((prev) => ({ ...prev, quantity: e.target.value }))}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                          placeholder="Enter quantity"
                        />
                      </div>
                    ) : null}

                    {selectedSubtypeConfig?.has_duration ? (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-ink-700">Duration</label>
                        <input
                          type="text"
                          value={newRowValues.duration}
                          onChange={(e) => setNewRowValues((prev) => ({ ...prev, duration: e.target.value }))}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                          placeholder="Enter duration"
                        />
                      </div>
                    ) : null}

                    {session?.role !== "superadmin" ? (
                      <div className="col-span-full space-y-2">
                        <label className="mb-1 block text-sm font-medium text-ink-700">Additional Note</label>
                        <textarea
                          value={newRowValues.description}
                          onChange={(e) => setNewRowValues((prev) => ({ ...prev, description: e.target.value }))}
                          rows={3}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                          placeholder="Add an additional note (optional)"
                        />
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddRow(false);
                  setSelectedTypeId(null);
                  setSelectedSubtypeId(null);
                }}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRow}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                Add Row
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-ink-200">
        <button onClick={onCancel} className="rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !selectedDept}
          className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit Report"}
        </button>
      </div>
    </div>
  );
}