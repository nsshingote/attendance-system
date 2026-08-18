"use client";

import { useEffect, useState } from "react";
import { Upload, Trash2, Edit2, Download, Eye, X, FileText } from "lucide-react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Modal from "@/components/Common/Modal";
import EmployeeMultiSelect from "@/components/Common/EmployeeMultiSelect";

interface Resource {
  id: number;
  name: string;
  description: string | null;
  file_name: string;
  visibility_type: string;
  created_by: number;
  created_at: string;
  updated_at: string | null;
  department_ids?: number[];
  employee_ids?: number[];
}

interface Department {
  id: number;
  name: string;
  is_active: number;
}

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string;
  role: string;
}

export default function ResourcesPage() {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "superadmin";

  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingResource, setViewingResource] = useState<Resource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    visibility_type: "all_employees" as "all_employees" | "departments" | "specific_employees",
    selected_departments: [] as number[],
    selected_employees: [] as number[],
    file: null as File | null,
  });

  useEffect(() => {
    loadResources();
    if (isAdmin) {
      loadDepartments();
      loadEmployees();
    }
  }, [isAdmin]);

  const loadResources = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/resources");
      setResources(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const { data } = await api.get("/users/departments/");
      setDepartments(data);
    } catch (error) {
      console.error("Error loading departments:", error);
    }
  };

  const loadEmployees = async () => {
    try {
      const { data } = await api.get("/users/");
      const empList = data.filter((u: Employee) => u.role === "user");
      setEmployees(empList);
    } catch (error) {
      console.error("Error loading employees:", error);
    }
  };

  const handleUploadClick = () => {
    resetForm();
    setEditingResource(null);
    setShowUploadModal(true);
  };

  const handleEditClick = (resource: Resource) => {
    setEditingResource(resource);
    setFormData({
      name: resource.name,
      description: resource.description || "",
      visibility_type: resource.visibility_type as any,
      selected_departments: resource.department_ids || [],
      selected_employees: resource.employee_ids || [],
      file: null,
    });
    setShowEditModal(true);
  };

  const isSupportedPreview = (fileName: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const supportedExtensions = ["pdf", "jpg", "jpeg", "png", "gif", "webp", "txt", "csv"];
    return supportedExtensions.includes(ext);
  };

  const handleViewClick = async (resource: Resource) => {
    setViewingResource(resource);
    setPreviewUrl(null);
    try {
      const response = await api.get(`/resources/${resource.id}/view`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      setPreviewUrl(blobUrl);
    } catch (error) {
      toast.error("Unable to load preview: " + getErrorMessage(error));
    }
    setShowViewModal(true);
  };

  const handleViewModalClose = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setShowViewModal(false);
    setViewingResource(null);
    setPreviewUrl(null);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      visibility_type: "all_employees",
      selected_departments: [],
      selected_employees: [],
      file: null,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData((prev) => ({ ...prev, file }));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      return toast.error("Resource name is required");
    }

    if (!formData.file && !editingResource) {
      return toast.error("Please select a file");
    }

    if (
      formData.visibility_type === "departments" &&
      formData.selected_departments.length === 0
    ) {
      return toast.error("Please select at least one department");
    }

    if (
      formData.visibility_type === "specific_employees" &&
      formData.selected_employees.length === 0
    ) {
      return toast.error("Please select at least one employee");
    }

    try {
      const formDataObj = new FormData();
      formDataObj.append("name", formData.name);
      formDataObj.append("description", formData.description);
      formDataObj.append("visibility_type", formData.visibility_type);

      if (formData.visibility_type === "departments") {
        formDataObj.append("department_ids", JSON.stringify(formData.selected_departments));
      } else if (formData.visibility_type === "specific_employees") {
        formDataObj.append("employee_ids", JSON.stringify(formData.selected_employees));
      }

      if (formData.file) {
        formDataObj.append("file", formData.file);
      }

      if (editingResource) {
        await api.put(`/resources/${editingResource.id}`, formDataObj, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        toast.success("Resource updated successfully");
        setShowEditModal(false);
      } else {
        await api.post("/resources", formDataObj, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        toast.success("Resource uploaded successfully");
        setShowUploadModal(false);
      }

      resetForm();
      loadResources();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDelete = async (resourceId: number) => {
    if (!window.confirm("Are you sure you want to delete this resource?")) {
      return;
    }

    try {
      await api.delete(`/resources/${resourceId}`);
      toast.success("Resource deleted successfully");
      loadResources();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleDownload = async (resourceId: number, fileName: string) => {
    try {
      const response = await api.get(`/resources/${resourceId}/download`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const getVisibilityLabel = (resource: Resource) => {
    if (resource.visibility_type === "all_employees") {
      return "All Employees";
    } else if (resource.visibility_type === "departments") {
      return `${resource.department_ids?.length || 0} Department(s)`;
    } else {
      return `${resource.employee_ids?.length || 0} Employee(s)`;
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-hidden flex flex-col bg-ink-50">
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-ink-200 bg-white px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Resources</h1>
            <p className="text-sm text-ink-600 mt-1">
              {isAdmin
                ? "Manage company resources and documents"
                : "View resources available to you"}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={handleUploadClick}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
            >
              <Upload size={18} />
              Upload Resource
            </button>
          )}
        </div>

        {/* Resources Table */}
        <div className="p-6">
          {loading ? (
            <div className="text-center py-12">
              <p className="text-ink-600">Loading resources...</p>
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={48} className="mx-auto text-ink-300 mb-4" />
              <p className="text-ink-600 font-medium">No resources available</p>
              {isAdmin && (
                <p className="text-sm text-ink-500 mt-2">
                  Upload your first resource to get started
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto bg-white rounded-lg border border-ink-200">
              <table className="w-full">
                <thead className="bg-ink-50 border-b border-ink-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-ink-900">
                      Resource Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-ink-900">
                      Description
                    </th>
                    {isAdmin && (
                      <th className="px-6 py-3 text-left text-sm font-semibold text-ink-900">
                        Visibility
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-sm font-semibold text-ink-900">
                      Uploaded
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-ink-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resources.map((resource) => (
                    <tr
                      key={resource.id}
                      className="border-b border-ink-200 hover:bg-ink-50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-ink-900">
                        {resource.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-ink-600">
                        {resource.description
                          ? resource.description.substring(0, 50) + (resource.description.length > 50 ? "..." : "")
                          : "—"}
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 text-sm text-ink-600">
                          {getVisibilityLabel(resource)}
                        </td>
                      )}
                      <td className="px-6 py-4 text-sm text-ink-600">
                        {new Date(resource.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDownload(resource.id, resource.file_name)}
                            className="p-2 text-ink-600 hover:bg-ink-200 rounded transition-colors"
                            title="Download"
                          >
                            <Download size={16} />
                          </button>
                          <button
                            onClick={() => handleViewClick(resource)}
                            className="p-2 text-ink-600 hover:bg-ink-200 rounded transition-colors"
                            title="View Details"
                          >
                            <Eye size={16} />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => handleEditClick(resource)}
                                className="p-2 text-ink-600 hover:bg-ink-200 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDelete(resource.id)}
                                className="p-2 text-red-600 hover:bg-red-100 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title={editingResource ? "Edit Resource" : "Upload New Resource"}
      >
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-900 mb-1">
              Resource Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Employee Handbook"
              className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Optional description"
              rows={3}
              className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-1">
              Who can see this resource? *
            </label>
            <select
              value={formData.visibility_type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  visibility_type: e.target.value as any,
                  selected_departments: [],
                  selected_employees: [],
                }))
              }
              className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all_employees">All Employees</option>
              <option value="departments">Specific Departments</option>
              <option value="specific_employees">Specific Employees</option>
            </select>
          </div>

          {formData.visibility_type === "departments" && (
            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Select Departments *
              </label>
              <div className="space-y-2">
                {departments.map((dept) => (
                  <label
                    key={dept.id}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={formData.selected_departments.includes(dept.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData((prev) => ({
                            ...prev,
                            selected_departments: [...prev.selected_departments, dept.id],
                          }));
                        } else {
                          setFormData((prev) => ({
                            ...prev,
                            selected_departments: prev.selected_departments.filter(
                              (id) => id !== dept.id
                            ),
                          }));
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-ink-700">{dept.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {formData.visibility_type === "specific_employees" && (
            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Select Employees *
              </label>
              <EmployeeMultiSelect
                employees={employees}
                value={formData.selected_employees}
                onChange={(selectedIds: number[]) =>
                  setFormData((prev) => ({
                    ...prev,
                    selected_employees: selectedIds,
                  }))
                }
              />
            </div>
          )}

          {!editingResource && (
            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Upload File *
              </label>
              <input
                type="file"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.zip"
                required={!editingResource}
              />
              <p className="text-xs text-ink-600 mt-1">
                Accepted: PDF, Word, Excel, PowerPoint, Text, Images, ZIP (Max 50MB)
              </p>
            </div>
          )}

          {editingResource && (
            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Update File (Optional)
              </label>
              <input
                type="file"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.zip"
              />
              <p className="text-xs text-ink-600 mt-1">
                Leave blank to keep the existing file
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowUploadModal(false)}
              className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
            >
              {editingResource ? "Update Resource" : "Upload Resource"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      {editingResource && (
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title="Edit Resource"
        >
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Resource Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Who can see this resource? *
              </label>
              <select
                value={formData.visibility_type}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    visibility_type: e.target.value as any,
                  }))
                }
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="all_employees">All Employees</option>
                <option value="departments">Specific Departments</option>
                <option value="specific_employees">Specific Employees</option>
              </select>
            </div>

            {formData.visibility_type === "departments" && (
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">
                  Select Departments *
                </label>
                <div className="space-y-2">
                  {departments.map((dept) => (
                    <label
                      key={dept.id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.selected_departments.includes(dept.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData((prev) => ({
                              ...prev,
                              selected_departments: [...prev.selected_departments, dept.id],
                            }));
                          } else {
                            setFormData((prev) => ({
                              ...prev,
                              selected_departments: prev.selected_departments.filter(
                                (id) => id !== dept.id
                              ),
                            }));
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-ink-700">{dept.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {formData.visibility_type === "specific_employees" && (
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">
                  Select Employees *
                </label>
                <EmployeeMultiSelect
                  employees={employees}
                  value={formData.selected_employees}
                  onChange={(selectedIds: number[]) =>
                    setFormData((prev) => ({
                      ...prev,
                      selected_employees: selectedIds,
                    }))
                  }
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ink-900 mb-1">
                Update File (Optional)
              </label>
              <input
                type="file"
                onChange={handleFileChange}
                className="w-full px-3 py-2 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.zip"
              />
              <p className="text-xs text-ink-600 mt-1">
                Leave blank to keep the existing file: {editingResource.file_name}
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                Update Resource
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* View Details Modal */}
      {viewingResource && (
        <Modal
          isOpen={showViewModal}
          onClose={handleViewModalClose}
          title="Resource Details"
          size="lg"
        >
          <div className="space-y-4">
            {isSupportedPreview(viewingResource.file_name) && previewUrl && (
              <div className="border border-ink-200 rounded-lg overflow-hidden bg-ink-50">
                {viewingResource.file_name.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    src={previewUrl}
                    className="w-full h-96 border-0"
                    title="PDF Preview"
                  />
                ) : /\.(jpg|jpeg|png|gif|webp)$/i.test(viewingResource.file_name) ? (
                  <img
                    src={previewUrl}
                    alt={viewingResource.name}
                    className="max-w-full h-auto mx-auto"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    className="w-full h-96 border-0"
                    title="File Preview"
                  />
                )}
              </div>
            )}
            {!previewUrl && isSupportedPreview(viewingResource.file_name) && (
              <div className="text-center py-8 text-ink-500">Loading preview...</div>
            )}

            <div>
              <label className="text-sm font-medium text-ink-900">Name</label>
              <p className="text-sm text-ink-600 mt-1">{viewingResource.name}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-ink-900">File Name</label>
              <p className="text-sm text-ink-600 mt-1">{viewingResource.file_name}</p>
            </div>

            {viewingResource.description && (
              <div>
                <label className="text-sm font-medium text-ink-900">Description</label>
                <p className="text-sm text-ink-600 mt-1">{viewingResource.description}</p>
              </div>
            )}

            {isAdmin && (
              <div>
                <label className="text-sm font-medium text-ink-900">Visibility</label>
                <p className="text-sm text-ink-600 mt-1">
                  {getVisibilityLabel(viewingResource)}
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-ink-900">Uploaded</label>
              <p className="text-sm text-ink-600 mt-1">
                {new Date(viewingResource.created_at).toLocaleString()}
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <button
                onClick={() => handleDownload(viewingResource.id, viewingResource.file_name)}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                Download
              </button>
              <button
                onClick={() => setShowViewModal(false)}
                className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
    </AppShell>
  );
}
