# Production deployment

This project runs the Next.js frontend, FastAPI backend, and MySQL together with Docker Compose.

1. Copy `.env.example` to `.env`, then replace every placeholder with production values. Generate a unique `SECRET_KEY`, database passwords, and set the two public URLs. `NEXT_PUBLIC_API_BASE_URL` is baked into the frontend during its image build, so rebuild the frontend whenever it changes.
2. Ensure the database port is not exposed publicly. The Compose file binds it to localhost only. Place the frontend and backend behind HTTPS (for example, a reverse proxy), and expose only the proxy ports to the internet.
3. Start or update the stack with `docker compose up -d --build`.
4. Check readiness with `docker compose ps`, then request `https://api.example.com/health`. Review startup logs with `docker compose logs --tail=100 backend frontend`.

For an existing MySQL volume, apply every SQL file in `database/migrations/` that
has not already been applied. In particular, the notification table migration
(`2026_09_16_add_notifications.sql`) is required before approving requests,
because approval persists an in-app notification in that table.

For Nginx, proxy the notification WebSocket path to the backend with upgrade
headers. The backend accepts both `/notifications/ws` and
`/api/notifications/ws`:

```nginx
location /api/notifications/ws {
    proxy_pass http://127.0.0.1:8000/notifications/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
}
```

For attendance IP validation, every HTTP proxy location that forwards
attendance requests must preserve the original client address:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
```

The backend trusts forwarded addresses only from private/loopback proxy
addresses by default, including Docker bridge networks. If the proxy reaches
the backend from a different address range, set `TRUSTED_PROXY_IPS` in `.env`
to a comma-separated list of trusted IPs or CIDR ranges, then recreate the
backend container. Do not configure this as a public/unrestricted range.

The MySQL and upload volumes are named `mysql_data` and `uploads_data`. Back them up before host replacement or any destructive Docker cleanup. Keep `.env` private; it is intentionally ignored by Git and Docker build contexts.
