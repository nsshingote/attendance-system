"use client";

/**
 * components/Settings/CompanySettings.tsx
 * Edit form for office times, grace period, weekly off, and sandwich method.
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
  sandwich_method_enabled: boolean;
  company_name: string;
  company_address: string;
  attendance_location_enabled: boolean;
  office_latitude: number | null;
  office_longitude: number | null;
  attendance_radius_meters: number;
  attendance_validation_mode: "ip_only" | "location_only" | "ip_or_location";
}

const formatCoordinate = (coordinate: number | null) => (
  coordinate === null ? "" : coordinate.toFixed(7)
);

export default function CompanySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings | null>(null);
  const [latitudeInput, setLatitudeInput] = useState("");
  const [longitudeInput, setLongitudeInput] = useState("");

  useEffect(() => {
    api
      .get<Settings>("/settings/")
      .then(({ data }) => {
        setSettings(data);
        setForm(data);
        setLatitudeInput(formatCoordinate(data.office_latitude));
        setLongitudeInput(formatCoordinate(data.office_longitude));
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!form) return;
    const latitude = latitudeInput === "" ? null : Number(latitudeInput);
    const longitude = longitudeInput === "" ? null : Number(longitudeInput);
    if (
      (latitude !== null && !Number.isFinite(latitude)) ||
      (longitude !== null && !Number.isFinite(longitude))
    ) {
      toast.error("Enter valid latitude and longitude values");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put<Settings>("/settings/", {
        ...form,
        office_latitude: latitude,
        office_longitude: longitude,
      });
      setSettings(data);
      setForm(data);
      setLatitudeInput(formatCoordinate(data.office_latitude));
      setLongitudeInput(formatCoordinate(data.office_longitude));
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
        <div className="border-t border-ink-100 pt-4">
          <h2 className="font-semibold text-ink-900">Attendance Location</h2>
          <p className="mt-1 text-xs text-ink-500">The backend recalculates distance from these coordinates. GPS readings above 100 metres accuracy are rejected.</p>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink-700">
            <input type="checkbox" checked={form.attendance_location_enabled} onChange={(e) => setForm({ ...form, attendance_location_enabled: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
            Enable location attendance
          </label>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="text-sm font-medium text-ink-700">Office latitude
              <input
                type="text"
                inputMode="decimal"
                value={latitudeInput}
                onChange={(e) => setLatitudeInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-ink-700">Office longitude
              <input
                type="text"
                inputMode="decimal"
                value={longitudeInput}
                onChange={(e) => setLongitudeInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="text-sm font-medium text-ink-700">Allowed radius (metres)
              <input type="number" min={1} max={10000} value={form.attendance_radius_meters} onChange={(e) => setForm({ ...form, attendance_radius_meters: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-ink-700">Validation method
              <select value={form.attendance_validation_mode} onChange={(e) => setForm({ ...form, attendance_validation_mode: e.target.value as Settings["attendance_validation_mode"] })} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
                <option value="ip_only">IP only</option>
                <option value="location_only">Location only</option>
                <option value="ip_or_location">IP or Location</option>
              </select>
            </label>
          </div>
        </div>
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

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
            <input
              type="checkbox"
              checked={form.sandwich_method_enabled}
              onChange={(e) => setForm({ ...form, sandwich_method_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-ink-300 text-brand-600"
            />
            Enable Sandwich Method
          </label>
          <p className="mt-1 text-xs text-ink-500">
            Count the configured weekly-off day as leave only when it falls between leave days. This applies to new requests and pending approvals; approved leave stays unchanged.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Company Name</label>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            placeholder="Your Company Name"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">Company Address</label>
          <textarea
            value={form.company_address}
            onChange={(e) => setForm({ ...form, company_address: e.target.value })}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
            rows={3}
            placeholder="Enter company address for salary slips and documents"
          />
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