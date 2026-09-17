"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import toast from "react-hot-toast";
import { createPortal } from "react-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getNotificationRoute,
  NotificationItem,
} from "@/lib/notifications";
import { NotificationRealtime } from "@/lib/notificationRealtime";

function mergeNotifications(items: NotificationItem[]): NotificationItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const knownNotificationIds = useRef(new Set<number>());
  const suppressRefreshUntil = useRef(0);

  const refresh = useCallback(async () => {
    if (Date.now() < suppressRefreshUntil.current) return;
    try {
      const data = await fetchNotifications(0, 20);
      const unreadItems = data.items.filter((item) => !item.is_read);
      unreadItems.forEach((item) => knownNotificationIds.current.add(item.id));
      setItems((current) => mergeNotifications([...unreadItems, ...current.filter((item) => !item.is_read)]).slice(0, 50));
      setUnreadCount(data.unread_count);
    } catch {
      // The rest of the authenticated shell must remain usable if notifications fail.
    }
  }, []);

  useEffect(() => {
    const refreshTimer = setTimeout(() => { refresh(); }, 0);
    const refreshOnFocus = () => refresh();
    const pollingTimer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refreshOnFocus);
    const realtime = new NotificationRealtime({
      onEvent: (event) => {
        if (event.type === "notification") {
          const isNewNotification = !knownNotificationIds.current.has(event.notification.id);
          knownNotificationIds.current.add(event.notification.id);
          if (event.notification.is_read) return;
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
      clearInterval(pollingTimer);
      window.removeEventListener("focus", refreshOnFocus);
      realtime.stop();
    };
  }, [refresh]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      // The menu is rendered in a portal, so it is not a descendant of the
      // bell container. Treat it as part of the notification control too;
      // otherwise a pointer down on a menu button closes and unmounts the menu
      // before the button's click can run (particularly on Safari/iOS).
      if (
        open
        && !containerRef.current?.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    const clearReadNotifications = () => {
      setItems([]);
      setUnreadCount(0);
    };
    window.addEventListener("notifications:read-all", clearReadNotifications);
    return () => window.removeEventListener("notifications:read-all", clearReadNotifications);
  }, []);

  const handleRead = async (item: NotificationItem) => {
    if (!item.is_read) {
      try {
        const updated = await markNotificationRead(item.id);
        knownNotificationIds.current.add(item.id);
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setUnreadCount((count) => Math.max(0, count - 1));
      } catch {
        toast.error("Unable to mark notification as read");
        return;
      }
    }
    const route = getNotificationRoute(item);
    if (route) {
      setOpen(false);
      window.location.assign(route);
    }
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      suppressRefreshUntil.current = Date.now() + 2000;
      setItems([]);
      setUnreadCount(0);
      setOpen(false);
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
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl"
          style={{
            top: "4.25rem",
            left: "0.5rem",
            right: "0.5rem",
            width: "auto",
            maxWidth: "24rem",
            marginLeft: "auto",
          }}
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="min-w-0 font-semibold text-ink-900">Notifications</p>
            <button type="button" onClick={handleReadAll} className="shrink-0 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500">No unread notifications.</p>
            ) : items.slice(0, 10).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRead(item)}
                className={`block w-full border-b border-ink-100 px-4 py-3 text-left hover:bg-ink-50 ${item.is_read ? "bg-white" : "bg-brand-50"}`}
                style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
              >
                <p className="text-sm font-semibold leading-5 text-ink-900" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-ink-600" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.message}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); window.location.assign("/notifications"); }} className="w-full px-4 py-3 text-center text-sm font-semibold text-brand-600 hover:bg-ink-50">
            View notification history
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
