"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Download, Eye, FileText, Paperclip, Pencil, Save, Trash2, Upload, X } from "lucide-react";
import Image from "next/image";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import api, { getErrorMessage } from "@/lib/api";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { hasPermission, usePermissions } from "@/lib/permissions";

type Employee = { id: number; name: string; role: string; role_key?: string; designation: string };
type Attachment = {
  id: number;
  note_id: number;
  original_filename: string;
  content_type: string;
  file_size: number;
  uploaded_at: string;
};
type Note = { id: number; positive_note?: string; negative_note?: string; created_at: string; attachments?: Attachment[] };
type SelectedFile = { file: File; previewUrl?: string };
type AttachmentPreview = { filename: string; contentType: string; url: string };

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".rtf", ".txt", ".csv",
]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ATTACHMENT_ACCEPT = Array.from(ACCEPTED_EXTENSIONS).join(",");

export default function KundliPage() {
  const session = getSession();
  const { permissions } = usePermissions();
  const superAdmin = isSuperAdmin(session?.role);
  const canView = superAdmin || hasPermission(permissions, "kundli.team_view");
  const canCreate = superAdmin || hasPermission(permissions, "kundli.create");
  const canEdit = superAdmin || hasPermission(permissions, "kundli.edit");
  const canDelete = superAdmin || hasPermission(permissions, "kundli.delete");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const selectedFilesRef = useRef<SelectedFile[]>([]);
  const uploadIdempotencyKeyRef = useRef<string | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pendingAttachmentNoteId, setPendingAttachmentNoteId] = useState<number | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canWrite = canCreate || (editingId !== null && canEdit);

  useEffect(() => {
    if (!canView) return;
    api.get("/users/")
      .then(({ data }) => {
        const list = data.filter((item: Employee) => (item.role_key || item.role) !== "superadmin");
        setEmployees(list);
        if (list[0]) setEmployeeId(String(list[0].id));
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [canView]);

  useEffect(() => {
    if (!employeeId || !canView) return;
    api.get(`/employee-documents/kundli/${employeeId}`)
      .then(({ data }) => setNotes(data))
      .catch((e) => toast.error(getErrorMessage(e)));
  }, [employeeId, canView]);

  useEffect(() => () => {
    selectedFilesRef.current.forEach((selected) => {
      if (selected.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    });
  }, []);
  useEffect(() => () => {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview.url);
  }, [attachmentPreview]);

  const formatBytes = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileType = (filename: string, contentType?: string) => (
    contentType || filename.split(".").pop()?.toUpperCase() || "File"
  );

  const isImageFile = (file: File) => (
    file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(`.${file.name.split(".").pop()?.toLowerCase() || ""}`)
  );

  const clearSelectedFiles = () => {
    selectedFilesRef.current.forEach((selected) => {
      if (selected.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    });
    selectedFilesRef.current = [];
    setSelectedFiles([]);
    uploadIdempotencyKeyRef.current = null;
    setUploadPending(false);
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    const accepted: SelectedFile[] = [];
    for (const file of incoming) {
      const extension = `.${file.name.split(".").pop()?.toLowerCase() || ""}`;
      if (!ACCEPTED_EXTENSIONS.has(extension)) {
        toast.error(`${file.name}: unsupported file format`);
      } else if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: file must be 20 MB or smaller`);
      } else {
        accepted.push({
          file,
          previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
        });
      }
    }
    if (accepted.length) {
      if (!uploadIdempotencyKeyRef.current) {
        uploadIdempotencyKeyRef.current = crypto.randomUUID();
      }
      setSelectedFiles((current) => {
        const next = [...current, ...accepted];
        selectedFilesRef.current = next;
        return next;
      });
    }
    event.target.value = "";
  };

  const uploadSelectedFiles = async (noteId: number) => {
    const formData = new FormData();
    selectedFiles.forEach(({ file }) => formData.append("files", file));
    const idempotencyKey = uploadIdempotencyKeyRef.current || crypto.randomUUID();
    uploadIdempotencyKeyRef.current = idempotencyKey;
    setUploadPending(true);
    setUploadProgress(0);
    const { data } = await api.post(
      `/employee-documents/kundli/${noteId}/attachments`,
      formData,
      {
        headers: { "Idempotency-Key": idempotencyKey },
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded * 100) / event.total));
        },
      },
    );
    setNotes((current) => current.map((note) => (
      note.id === noteId ? { ...note, attachments: [...(note.attachments || []), ...data] } : note
    )));
    clearSelectedFiles();
    setPendingAttachmentNoteId(null);
    setUploadProgress(null);
  };

  const refreshAttachments = async (noteId: number) => {
    const { data } = await api.get(`/employee-documents/kundli/${noteId}/attachments`);
    setNotes((current) => current.map((note) => (
      note.id === noteId ? { ...note, attachments: data } : note
    )));
  };

  const downloadAttachment = async (noteId: number, attachment: Attachment) => {
    try {
      const { data } = await api.get(
        `/employee-documents/kundli/${noteId}/attachments/${attachment.id}/download`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.original_filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const previewAttachment = async (noteId: number, attachment: Attachment) => {
    try {
      const { data } = await api.get(
        `/employee-documents/kundli/${noteId}/attachments/${attachment.id}/preview`,
        { responseType: "blob" },
      );
      setAttachmentPreview({
        filename: attachment.original_filename,
        contentType: attachment.content_type,
        url: URL.createObjectURL(data),
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const removeAttachment = async (noteId: number, attachment: Attachment) => {
    if (!window.confirm(`Remove "${attachment.original_filename}" from this note?`)) return;
    try {
      await api.delete(`/employee-documents/kundli/${noteId}/attachments/${attachment.id}`);
      await refreshAttachments(noteId);
      toast.success("Attachment removed");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const employee = employees.find((item) => String(item.id) === employeeId);

  const save = async () => {
    if (pendingAttachmentNoteId !== null) {
      if (!selectedFiles.length) return toast.error("Select files to upload");
      setSaving(true);
      try {
        await uploadSelectedFiles(pendingAttachmentNoteId);
        toast.success("Attachments uploaded");
      } catch (error) {
        setUploadProgress(null);
        toast.error(getErrorMessage(error));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!positive.trim() && !negative.trim()) return toast.error("Write a positive or negative note");
    if (!employeeId) return toast.error("Select an employee");
    setSaving(true);
    let savedNote: Note | null = null;
    const wasCreating = editingId === null;
    try {
      const payload = { employee_id: Number(employeeId), positive_note: positive, negative_note: negative };
      const { data } = editingId ? await api.put(`/employee-documents/kundli/${editingId}`, payload) : await api.post("/employee-documents/kundli", payload);
      const updatedNote: Note = { ...data, attachments: data.attachments || [] };
      savedNote = updatedNote;
      setNotes((current) => editingId
        ? current.map((note) => (note.id === editingId ? { ...note, ...updatedNote } : note))
        : [updatedNote, ...current]);
      if (selectedFiles.length) {
        try {
          await uploadSelectedFiles(data.id);
        } catch (error) {
          if (wasCreating) {
            setPendingAttachmentNoteId(data.id);
            setPositive("");
            setNegative("");
            setEditingId(null);
          }
          toast.error(`Note saved, but attachments could not be uploaded: ${getErrorMessage(error)}`);
          return;
        }
      }
      setPositive("");
      setNegative("");
      setEditingId(null);
      clearSelectedFiles();
      toast.success("Kundli note saved");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      if (savedNote && uploadProgress !== null) setUploadProgress(null);
      setSaving(false);
    }
  };

  return (
    <AppShell requiredPermission="kundli.team_view">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Kundli</h1>
          <p className="text-sm text-ink-500">Private positive and negative notes about employees</p>
        </div>

        <label className="block max-w-sm text-sm font-medium">
          Select Employee
          <select value={employeeId} disabled={saving} onChange={(e) => { setEmployeeId(e.target.value); setPositive(""); setNegative(""); setEditingId(null); clearSelectedFiles(); setPendingAttachmentNoteId(null); }} className="mt-1 block w-full rounded-lg border-ink-200 disabled:opacity-50">
            {!canView && <option value="">No permission</option>}
            {canView && <option value="">Select employee</option>}
            {employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        {employee && (
          <section className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-6">
            <div className="mb-5">
              <h2 className="font-semibold">{employee.name}</h2>
              <p className="text-sm text-ink-500">{employee.designation}</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
              <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-ink-200 touch-auto">
                <table className="w-full `min-w-216` text-sm">
                  <thead className="bg-ink-50 text-left text-ink-600">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Positive Note</th>
                      <th className="px-4 py-3">Negative Note</th>
                      <th className="px-4 py-3">Attachments</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.length ? notes.map((note) => (
                      <tr key={note.id} className="border-t border-ink-100 align-top">
                        <td className="whitespace-nowrap px-4 py-3">{new Date(note.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                        <td className="max-w-xs wrap-break-words px-4 py-3 text-ink-700">{note.positive_note || "—"}</td>
                        <td className="max-w-xs wrap-break-words px-4 py-3 text-ink-700">{note.negative_note || "—"}</td>
                        <td className="min-w-52 px-4 py-3">
                          <div className="space-y-2">
                            {(note.attachments || []).map((attachment) => {
                              const previewable = attachment.content_type.startsWith("image/") || attachment.content_type === "application/pdf";
                              return (
                                <div key={attachment.id} className="flex items-center gap-2 text-xs">
                                  <FileText size={14} className="shrink-0 text-ink-500" />
                                  <span className="min-w-0 flex-1 break-all" title={attachment.original_filename}>
                                    {attachment.original_filename} <span className="text-ink-500">({fileType(attachment.original_filename, attachment.content_type)}, {formatBytes(attachment.file_size)})</span>
                                  </span>
                                  {previewable && <button aria-label={`Preview ${attachment.original_filename}`} onClick={() => previewAttachment(note.id, attachment)} className="text-brand-700"><Eye size={15} /></button>}
                                  <button aria-label={`Download ${attachment.original_filename}`} onClick={() => downloadAttachment(note.id, attachment)} className="text-brand-700"><Download size={15} /></button>
                                  {canEdit && <button aria-label={`Remove ${attachment.original_filename}`} onClick={() => removeAttachment(note.id, attachment)} className="text-red-600"><X size={15} /></button>}
                                </div>
                              );
                            })}
                            {!note.attachments?.length && <span className="text-xs text-ink-500">No attachments</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {canEdit && <button onClick={() => { setEditingId(note.id); setPendingAttachmentNoteId(null); clearSelectedFiles(); setPositive(note.positive_note || ""); setNegative(note.negative_note || ""); }} className="inline-flex items-center gap-1 text-brand-700"><Pencil size={14} /> Edit</button>}
                            {canDelete && <button onClick={async () => { if (!window.confirm("Delete this Kundli note?")) return; try { await api.delete(`/employee-documents/kundli/${note.id}`); setNotes(notes.filter((item) => item.id !== note.id)); toast.success("Kundli note deleted"); } catch (e) { toast.error(getErrorMessage(e)); } }} className="inline-flex items-center gap-1 text-red-600"><Trash2 size={14} /> Delete</button>}
                          </div>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-500">No notes saved for this employee.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-ink-200 p-4">
                <h3 className="font-semibold">Write Note</h3>
                <label className="mt-4 block text-sm font-medium text-emerald-700">
                  Positive Note
                  <textarea value={positive} onChange={(e) => setPositive(e.target.value)} maxLength={500} disabled={saving} placeholder="Write message here..." className="mt-1 block min-h-28 w-full rounded-lg border-ink-200 text-ink-900 disabled:opacity-50" />
                </label>
                <label className="mt-4 block text-sm font-medium text-red-700">
                  Negative Note
                  <textarea value={negative} onChange={(e) => setNegative(e.target.value)} maxLength={500} disabled={saving} placeholder="Write message here..." className="mt-1 block min-h-28 w-full rounded-lg border-ink-200 text-ink-900 disabled:opacity-50" />
                </label>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" disabled={saving || uploadPending} onChange={handleFileSelection} />
                <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} multiple className="hidden" disabled={saving || uploadPending} onChange={handleFileSelection} />
                {canWrite && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={saving || uploadPending} className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 disabled:opacity-50">
                        <Paperclip size={15} /> Take photo
                      </button>
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={saving || uploadPending} className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 disabled:opacity-50">
                        <Upload size={15} /> Choose files
                      </button>
                    </div>
                    {pendingAttachmentNoteId !== null && <p className="text-sm text-amber-700">The note is saved. Retry the attachment upload; repeating this request is safe.</p>}
                    {selectedFiles.length > 0 && (
                      <div className="space-y-2 rounded-lg border border-ink-200 p-3">
                        <p className="text-xs font-medium text-ink-600">Selected files</p>
                        {selectedFiles.map(({ file, previewUrl }, index) => (
                          <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="flex items-center gap-3 text-xs">
                            {previewUrl && <Image src={previewUrl} alt={`Preview of ${file.name}`} width={48} height={48} unoptimized className="h-12 w-12 rounded object-cover" />}
                            <span className="min-w-0 flex-1 break-all">{file.name} <span className="text-ink-500">({fileType(file.name, file.type)}, {formatBytes(file.size)})</span></span>
                            <button type="button" aria-label={`Remove selected ${file.name}`} onClick={() => setSelectedFiles((current) => {
                              const removed = current[index];
                              if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                              const next = current.filter((_, fileIndex) => fileIndex !== index);
                              selectedFilesRef.current = next;
                              return next;
                            })} disabled={saving || uploadPending} className="text-red-600 disabled:opacity-50"><X size={16} /></button>
                          </div>
                        ))}
                        <p className="text-xs text-ink-500">Maximum 20 MB per file. Images and PDFs can be previewed.</p>
                      </div>
                    )}
                    {uploadProgress !== null && <p role="status" className="text-sm text-ink-600">Uploading attachments: {uploadProgress}%</p>}
                    <button onClick={save} disabled={saving || (!canCreate && !(editingId !== null && canEdit))} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                      <Save size={16} /> {saving ? "Saving..." : pendingAttachmentNoteId !== null ? "Retry attachment upload" : editingId !== null ? "Save Changes" : "Save Note"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      {attachmentPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Preview ${attachmentPreview.filename}`}>
          <div className="flex max-h-full w-full max-w-5xl flex-col rounded-xl bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="min-w-0 break-all text-sm font-medium">{attachmentPreview.filename}</p>
              <button onClick={() => setAttachmentPreview(null)} aria-label="Close preview" className="shrink-0 rounded p-1 text-ink-600 hover:bg-ink-100"><X size={20} /></button>
            </div>
            {attachmentPreview.contentType === "application/pdf"
              ? <iframe title={attachmentPreview.filename} src={attachmentPreview.url} className="h-[75vh] w-full" />
              : <Image src={attachmentPreview.url} alt={attachmentPreview.filename} width={1600} height={1200} unoptimized className="max-h-[75vh] max-w-full self-center object-contain" />}
          </div>
        </div>
      )}
    </AppShell>
  );
}
