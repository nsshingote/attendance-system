# Production deployment

This project runs the Next.js frontend, FastAPI backend, and MySQL together with Docker Compose.

1. Copy `.env.example` to `.env`, then replace every placeholder with production values. Generate a unique `SECRET_KEY`, database passwords, and set the two public URLs. `NEXT_PUBLIC_API_BASE_URL` is baked into the frontend during its image build, so rebuild the frontend whenever it changes.
2. Ensure the database port is not exposed publicly. The Compose file binds it to localhost only. Place the frontend and backend behind HTTPS (for example, a reverse proxy), and expose only the proxy ports to the internet.
3. Start or update the stack with `docker compose up -d --build`.
4. Check readiness with `docker compose ps`, then request `https://api.example.com/health`. Review startup logs with `docker compose logs --tail=100 backend frontend`.

The MySQL and upload volumes are named `mysql_data` and `uploads_data`. Back them up before host replacement or any destructive Docker cleanup. Keep `.env` private; it is intentionally ignored by Git and Docker build contexts.
