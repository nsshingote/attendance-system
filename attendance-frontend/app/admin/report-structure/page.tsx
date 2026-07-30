"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";

interface Department {
  id: number;
  name: string;
  is_active: boolean;
}

interface ReportType {
  id: number;
  name: string;
  department_id: number;
  sort_order: number;
  is_active: boolean;
}

interface ReportSubtype {
  id: number;
  name: string;
  type_id: number;
  has_quantity: boolean;
  has_duration: boolean;
  has_description: boolean;
  sort_order: number;
  is_active: boolean;
}

interface DefaultRow {
  id: number;
  department_id: number;
  subtype_id: number;
  is_default: boolean;
}

export default function ReportStructurePage() {
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allTypes, setAllTypes] = useState<ReportType[]>([]);
  const [allSubtypes, setAllSubtypes] = useState<ReportSubtype[]>([]);
  const [defaultRows, setDefaultRows] = useState<DefaultRow[]>([]);
  const [selectedDept, setSelectedDept] = useState<number | null>(null);
  const [selectedDefaults, setSelectedDefaults] = useState<number[]>([]);
  const [showAddType, setShowAddType] = useState(false);
  const [showAddSubtype, setShowAddSubtype] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newSubtypeName, setNewSubtypeName] = useState("");
  const [newSubtypeTypeId, setNewSubtypeTypeId] = useState<number | null>(null);
  const [newSubtypeHasQuantity, setNewSubtypeHasQuantity] = useState(true);
  const [newSubtypeHasDuration, setNewSubtypeHasDuration] = useState(true);
  const [newSubtypeHasDescription, setNewSubtypeHasDescription] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [deptRes, typeRes, subtypeRes] = await Promise.all([
        api.get("/reports/departments"),
        api.get("/reports/types"),
        api.get("/reports/subtypes"),
      ]);

      setDepartments(deptRes.data);
      setAllTypes(typeRes.data);
      setAllSubtypes(subtypeRes.data);
      setDefaultRows([]);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const getSubtypesForDepartment = (deptId: number) => {
    const types = allTypes.filter(t => t.department_id === deptId && t.is_active);
    const typeIds = types.map(t => t.id);
    return allSubtypes.filter(s => typeIds.includes(s.type_id) && s.is_active);
  };

  const handleDepartmentChange = async (deptId: number) => {
    setSelectedDept(deptId);
    try {
      const defaultRes = await api.get("/reports/default-rows", {
        params: { department_id: deptId }
      });
      setDefaultRows(defaultRes.data);
      const existingDefaults = defaultRes.data
        .filter((r: DefaultRow) => r.is_default === true)
        .map((r: DefaultRow) => r.subtype_id);
      setSelectedDefaults(existingDefaults);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleAddType = async () => {
    if (!selectedDept || !newTypeName.trim()) {
      toast.error("Please select a department and enter a type name");
      return;
    }

    try {
      await api.post("/reports/admin/types", {
        department_id: selectedDept,
        name: newTypeName.trim(),
        sort_order: 0,
        is_active: true,
      });
      toast.success("Type added successfully");
      setNewTypeName("");
      setShowAddType(false);
      await fetchData();
      if (selectedDept) {
        await handleDepartmentChange(selectedDept);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleAddSubtype = async () => {
    if (!newSubtypeTypeId || !newSubtypeName.trim()) {
      toast.error("Please select a type and enter a subtype name");
      return;
    }

    try {
      await api.post("/reports/admin/subtypes", {
        type_id: newSubtypeTypeId,
        name: newSubtypeName.trim(),
        has_quantity: newSubtypeHasQuantity,
        has_duration: newSubtypeHasDuration,
        has_description: newSubtypeHasDescription,
        sort_order: 0,
        is_active: true,
      });
      toast.success("Subtype added successfully");
      setNewSubtypeName("");
      setNewSubtypeTypeId(null);
      setNewSubtypeHasQuantity(true);
      setNewSubtypeHasDuration(true);
      setNewSubtypeHasDescription(false);
      setShowAddSubtype(false);
      await fetchData();
      if (selectedDept) {
        await handleDepartmentChange(selectedDept);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const toggleDefault = (subtypeId: number) => {
    setSelectedDefaults(prev =>
      prev.includes(subtypeId)
        ? prev.filter(id => id !== subtypeId)
        : [...prev, subtypeId]
    );
  };

  const saveDefaults = async () => {
    if (!selectedDept) {
      toast.error("Please select a department");
      return;
    }

    try {
      await api.post("/reports/admin/default-rows", {
        department_id: selectedDept,
        subtype_ids: selectedDefaults,
      });
      toast.success("Default rows saved successfully!");
      
      // Refresh default rows
      const defaultRes = await api.get("/reports/default-rows", {
        params: { department_id: selectedDept }
      });
      setDefaultRows(defaultRes.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (loading) return <Loading fullScreen />;

  const subtypes = selectedDept ? getSubtypesForDepartment(selectedDept) : [];
  const selectedDeptName = departments.find(d => d.id === selectedDept)?.name || "";

  return (
    <AppShell allowedRoles={["admin", "superadmin"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Report Structure</h1>
          <p className="text-sm text-ink-500">
            Select which report rows appear by default for each department.
          </p>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-card">
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-700">Select Department</label>
            <select
              value={selectedDept || ""}
              onChange={(e) => handleDepartmentChange(Number(e.target.value))}
              className="mt-1 w-full max-w-xs rounded-lg border border-ink-200 px-3 py-2 text-sm"
            >
              <option value="">Select Department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>

          {selectedDept && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-ink-700">
                    Default Rows for {selectedDeptName}
                  </h3>
                  <p className="text-xs text-ink-400">
                    Check the rows that should appear automatically for users in this department.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowAddType(true)}
                    className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                  >
                    + Add Type
                  </button>
                  <button
                    onClick={() => setShowAddSubtype(true)}
                    className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                    disabled={allTypes.filter((t) => t.department_id === selectedDept).length === 0}
                  >
                    + Add Subtype
                  </button>
                </div>
              </div>

              {subtypes.length === 0 ? (
                <p className="text-sm text-ink-500">No subtypes available for this department.</p>
              ) : (
                <div className="space-y-3">
                  {subtypes.map((subtype) => {
                    const type = allTypes.find(t => t.id === subtype.type_id);
                    const isChecked = selectedDefaults.includes(subtype.id);
                    return (
                      <label
                        key={subtype.id}
                        className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${
                          isChecked
                            ? "border-brand-400 bg-brand-50"
                            : "border-ink-200 hover:bg-ink-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleDefault(subtype.id)}
                          className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-sm text-ink-700">
                          {type?.name} → {subtype.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex justify-between flex-wrap gap-2">
                <div className="text-xs text-ink-500">
                  Tip: Admins can add new types and subtypes for a department, then choose which subtypes become default rows.
                </div>
                <button
                  onClick={saveDefaults}
                  className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
                >
                  Save Defaults
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-ink-900">Add New Type</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Type Name</label>
                <input
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  placeholder="Enter type name"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowAddType(false)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddType}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                Save Type
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSubtype && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-ink-900">Add New Subtype</h3>
            <div className="grid gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Type</label>
                <select
                  value={newSubtypeTypeId || ""}
                  onChange={(e) => setNewSubtypeTypeId(Number(e.target.value))}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                >
                  <option value="">Select Type</option>
                  {allTypes
                    .filter((type) => type.department_id === selectedDept)
                    .map((type) => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Subtype Name</label>
                <input
                  value={newSubtypeName}
                  onChange={(e) => setNewSubtypeName(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
                  placeholder="Enter subtype name"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newSubtypeHasQuantity}
                    onChange={(e) => setNewSubtypeHasQuantity(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  Quantity
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newSubtypeHasDuration}
                    onChange={(e) => setNewSubtypeHasDuration(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  Duration
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newSubtypeHasDescription}
                    onChange={(e) => setNewSubtypeHasDescription(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  Description
                </label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowAddSubtype(false)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubtype}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                Save Subtype
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}