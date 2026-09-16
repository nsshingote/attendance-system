import { getToken } from "@/lib/auth";
import { NotificationItem } from "@/lib/notifications";

export type NotificationRealtimeEvent =
  | { type: "ready" }
  | { type: "notification"; notification: NotificationItem };

interface NotificationRealtimeOptions {
  onEvent: (event: NotificationRealtimeEvent) => void;
  onDisconnect?: () => void;
}

export class NotificationRealtime {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  constructor(private readonly options: NotificationRealtimeOptions) {}

  start(): void {
    if (this.socket || this.reconnectTimer) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped || this.socket || typeof window === "undefined") return;
    const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
    const baseUrl = window.location.protocol === "https:" && configuredUrl.startsWith("http://")
      ? `${window.location.origin}/api`
      : configuredUrl;
    const websocketUrl = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/notifications/ws";
    const socket = new WebSocket(websocketUrl);
    this.socket = socket;

    socket.onopen = () => {
      const token = getToken();
      if (!token) {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "auth", access_token: token }));
      this.reconnectDelay = 1000;
    };
    socket.onmessage = (event) => {
      try {
        this.options.onEvent(JSON.parse(event.data) as NotificationRealtimeEvent);
      } catch {
        // Ignore malformed server messages; persisted notifications remain authoritative.
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.options.onDisconnect?.();
      if (!this.stopped && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    };
    socket.onerror = () => socket.close();
  }
}
