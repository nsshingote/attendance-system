"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import AppShell from "@/components/AppShell";
import {
  fetchNotifications,
  isSafeNotificationRoute,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "@/lib/notifications";

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(0, 100);
      setItems(data.items);
      setTotal(data.total);
    } catch {
      toast.error("Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadTimer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(loadTimer);
  }, [load]);

  const read = async (item: NotificationItem) => {
    try {
      const updated = item.is_read ? item : await markNotificationRead(item.id);
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      if (isSafeNotificationRoute(item.route)) router.push(item.route);
    } catch {
      toast.error("Unable to mark notification as read");
    }
  };

  const readAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true, read_at: new Date().toISOString() })));
    } catch {
      toast.error("Unable to mark notifications as read");
    }
  };

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">Notification history</h1>
            <p className="mt-1 text-sm text-ink-500">{total} notification{total === 1 ? "" : "s"}</p>
          </div>
          <button type="button" onClick={readAll} className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">
            Mark all as read
          </button>
        </div>
        {loading ? (
          <div className="rounded-xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">Loading notifications...</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">No notifications yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={() => read(item)} className={`block w-full border-b border-ink-100 px-5 py-4 text-left last:border-b-0 hover:bg-ink-50 ${item.is_read ? "" : "bg-brand-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink-900">{item.title}</p>
                    <p className="mt-1 text-sm text-ink-600">{item.message}</p>
                  </div>
                  {!item.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                </div>
                <p className="mt-2 text-xs text-ink-400">{new Date(item.created_at).toLocaleString()}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
