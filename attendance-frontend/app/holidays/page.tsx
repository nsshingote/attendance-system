"use client";

/**
 * app/holidays/page.tsx
 * Admin/SuperAdmin: add/delete holidays; employees see a read-only list.
 */

import { useEffect, useState, useCallback } from "react";
import { format, parseISO } from "date-fns";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import api, { getErrorMessage } from "@/lib/api";
import { isAdmin, getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Loading from "@/components/Common/Loading";
import Modal from "@/components/Common/Modal";

interface Holiday {
  id: number;
  holiday_date: string;
  holiday_name: string;
}

export default function HolidaysPage() {
  const session = getSession();
  const admin = isAdmin(session?.role);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Holiday[]>("/holidays/", { params: { year: new Date().getFullYear() } });
      setHolidays(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleAdd = async () => {
    if (!newDate || !newName) {
      toast.error("Please provide both a date and name");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/holidays/", { holiday_date: newDate, holiday_name: newName });
      toast.success("Holiday added");
      setModalOpen(false);
      setNewDate("");
      setNewName("");
      fetchHolidays();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (holiday: Holiday) => {
    if (!confirm(`Delete holiday "${holiday.holiday_name}"?`)) return;
    try {
      await api.delete(`/holidays/${holiday.id}`);
      toast.success("Holiday deleted");
      fetchHolidays();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Holidays</h1>
            <p className="text-sm text-ink-500">Company holiday calendar for {new Date().getFullYear()}</p>
          </div>
          {admin && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              <Plus size={16} />
              Add Holiday
            </button>
          )}
        </div>

        {loading ? (
          <Loading />
        ) : holidays.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white py-12 text-center">
            <p className="text-sm text-ink-500">No holidays added yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border border-ink-200 bg-white p-4 shadow-card">
                <div>
                  <p className="font-medium text-ink-900">{h.holiday_name}</p>
                  <p className="text-sm text-ink-500">{format(parseISO(h.holiday_date), "EEEE, dd MMM yyyy")}</p>
                </div>
                {admin && (
                  <button
                    onClick={() => handleDelete(h)}
                    className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete holiday"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Holiday"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={submitting}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add Holiday"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Date</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Holiday Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="E.g. Independence Day"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}