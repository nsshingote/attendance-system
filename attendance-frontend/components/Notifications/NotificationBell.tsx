"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  fetchNotifications,
  isSafeNotificationRoute,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "@/lib/notifications";
import { NotificationRealtime } from "@/lib/notificationRealtime";

function mergeNotifications(items: NotificationItem[]): NotificationItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const knownNotificationIds = useRef(new Set<number>());

  const refresh = useCallback(async () => {
    try {
      const data = await fetchNotifications(0, 20);
      data.items.forEach((item) => knownNotificationIds.current.add(item.id));
      setItems((current) => mergeNotifications([...data.items, ...current]).slice(0, 50));
      setUnreadCount(data.unread_count);
    } catch {
      // The rest of the authenticated shell must remain usable if notifications fail.
    }
  }, []);

  useEffect(() => {
    const refreshTimer = setTimeout(() => { refresh(); }, 0);
    const realtime = new NotificationRealtime({
      onEvent: (event) => {
        if (event.type === "notification") {
          const isNewNotification = !knownNotificationIds.current.has(event.notification.id);
          knownNotificationIds.current.add(event.notification.id);
          setItems((current) => mergeNotifications([event.notification, ...current]).slice(0, 50));
          if (isNewNotification && !event.notification.is_read) {
            setUnreadCount((count) => count + 1);
          }
        }
      },
      onDisconnect: refresh,
    });
    realtime.start();
    return () => {
      clearTimeout(refreshTimer);
      realtime.stop();
    };
  }, [refresh]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (open && containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const handleRead = async (item: NotificationItem) => {
    if (!item.is_read) {
      try {
        const updated = await markNotificationRead(item.id);
        knownNotificationIds.current.add(item.id);
        setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch {
        toast.error("Unable to mark notification as read");
        return;
      }
    }
    if (isSafeNotificationRoute(item.route)) {
      setOpen(false);
      router.push(item.route);
    }
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      toast.error("Unable to mark notifications as read");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-50"
        aria-label="Notifications"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="font-semibold text-ink-900">Notifications</p>
            <button type="button" onClick={handleReadAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500">No notifications yet.</p>
            ) : items.slice(0, 10).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRead(item)}
                className={`block w-full border-b border-ink-100 px-4 py-3 text-left hover:bg-ink-50 ${item.is_read ? "bg-white" : "bg-brand-50"}`}
              >
                <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                <p className="mt-1 text-xs text-ink-600">{item.message}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); router.push("/notifications"); }} className="w-full px-4 py-3 text-center text-sm font-semibold text-brand-600 hover:bg-ink-50">
            View notification history
          </button>
        </div>
      )}
    </div>
  );
}
