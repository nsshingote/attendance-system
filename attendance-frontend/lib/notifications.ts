import api from "@/lib/api";

export interface NotificationItem {
  id: number;
  recipient_user_id: number;
  actor_user_id: number | null;
  notification_type: string;
  title: string;
  message: string;
  route: string | null;
  entity_type: string | null;
  entity_id: number | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  items: NotificationItem[];
  total: number;
  unread_count: number;
}

export async function fetchNotifications(offset = 0, limit = 20): Promise<NotificationList> {
  const response = await api.get<NotificationList>("/notifications", { params: { offset, limit } });
  return response.data;
}

export async function markNotificationRead(id: number): Promise<NotificationItem> {
  const response = await api.patch<NotificationItem>(`/notifications/${id}/read`);
  return response.data;
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await api.patch<{ updated: number }>("/notifications/read-all");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notifications:read-all"));
  }
  return response.data.updated;
}

export function isSafeNotificationRoute(route: string | null): route is string {
  return Boolean(route && route.startsWith("/") && !route.startsWith("//") && !route.includes("://"));
}

export function getNotificationRoute(item: Pick<NotificationItem, "route" | "notification_type">): string | null {
  if (isSafeNotificationRoute(item.route)) return item.route;
  const prefix = item.notification_type.split(".", 1)[0];
  const fallbackRoutes: Record<string, string> = {
    leave: "/leave",
    wfh: "/attendance",
    half_day: "/attendance",
    attendance_correction: "/corrections",
    profile_edit: "/requests",
    employee_document: "/employee-documents",
    salary_slip: "/employee-documents",
    device: "/device-requests",
    report: "/admin-reports",
    feedback: "/feedback",
  };
  return fallbackRoutes[prefix] ?? null;
}
