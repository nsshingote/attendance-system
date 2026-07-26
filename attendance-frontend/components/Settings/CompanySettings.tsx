"use client";

/**
 * components/Settings/CompanySettings.tsx
 * Edit form for office start/end time, grace period, and weekly off day.
 * GET/PUT /settings/.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api, { getErrorMessage } from "@/lib/api";
import Loading from "@/components/Common/Loading";
import OfficeTime from "./OfficeTime";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Settings {
  office_start_time: string;
  office_end_time: string;
  late_grace_minutes: number;
  weekly_off_day: string;
}

export default function CompanySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    api
      .get<Settings>("/settings/")
      .then(({ data }) => {
        setSettings(data);
        setForm(data);
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const { data } = await api.put<Settings>("/settings/", form);
      setSettings(data);
      toast.success("Company settings updated");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (!form) return null;

  return (
    <div className="space-y-6">
      {settings && (
        <OfficeTime
          startTime={settings.office_start_time}
          endTime={settings.office_end_time}
          graceMinutes={settings.late_grace_minutes}
          weeklyOffDay={settings.weekly_off_day}
        />
      )}

      <div className="max-w-lg space-y-4 rounded-xl border border-ink-200 bg-white p-6 shadow-card">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Office Start Time</label>
            <input
              type="time"
              value={form.office_start_time.slice(0, 5)}
              onChange={(e) => setForm({ ...form, office_start_time: `${e.target.value}:00` })}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Office End Time</label>
            <input
              type="time"
              value={form.office_end_time.slice(0, 5)}
              onChange={(e) => setForm({ ...form, office_end_time: `${e.target.value}:00` })}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Late Grace Period (minutes)</label>
          <input
            type="number"
            min={0}
            value={form.late_grace_minutes}
            onChange={(e) => setForm({ ...form, late_grace_minutes: Number(e.target.value) })}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Weekly Off Day</label>
          <select
            value={form.weekly_off_day}
            onChange={(e) => setForm({ ...form, weekly_off_day: e.target.value })}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}