"""
main.py
FastAPI application entrypoint. Wires up CORS, static file serving, and all routers.
"""

import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from config import settings
from database import Base, engine

# Routers
from routers import (
    login,
    users,
    attendance,
    leave,
    attendance_correction,
    holidays,
    company_settings,
    dashboard,
    reports,
    device_requests,
    notifications_emails,
    office_ips,
    activity_logs,
    password_reset,
    feedback,
    employee_documents,
    resources,
)

# Create tables if they don't exist yet (safe no-op if schema.sql already applied)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Employee Attendance Management System",
    description="API for the Attendance, Leave, and Employee Management System",
    version="1.0.0",
)



# ---------------------------------------------------------
# CORS
# ---------------------------------------------------------
# Explicitly allow settings.FRONTEND_ORIGIN (from .env) plus the common
# local-dev addresses, and a regex fallback matching ANY localhost port.
# This makes local development resilient to .env formatting mismatches
# (trailing slashes, wrong port if Next.js picks a different one, etc.)
# — a frequent source of confusing "CORS blocked" / "network error"
# symptoms that are otherwise hard to diagnose from the browser alone.

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.FRONTEND_ORIGINS,
    allow_origin_regex=(r"http://(localhost|127\.0\.0\.1):\d+" if settings.APP_ENV != "production" else None),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cors_headers_for_error_response(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if not origin:
        return {}

    if origin in settings.FRONTEND_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }

    if settings.APP_ENV != "production" and re.match(r"^http://(localhost|127\.0\.0\.1):\d+$", origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }

    return {}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    response_headers = dict(exc.headers or {})
    response_headers.update(_cors_headers_for_error_response(request))
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=response_headers,
    )


# ---------------------------------------------------------
# CORS-safe error responses
# ---------------------------------------------------------
# By default, error responses (401 Not authenticated, 403, 404, etc.)
# don't always get the CORS headers attached the same way successful
# responses do. When that happens, the browser reports it to the
# frontend as a generic "CORS error" with no status code or body visible
# at all — hiding the real error and making it look like a CORS
# misconfiguration when the actual problem (e.g. a missing/expired auth
# token) is something else entirely. This handler guarantees every error
# response — no matter what raised it — carries the correct CORS headers,
# so the browser shows the real status code and message instead.
# ---------------------------------------------------------
# Global error handler (temporary debugging)
# ---------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log internal exception details server-side and return a generic message
    try:
        from utils.logger import logger
        logger.exception("Unhandled exception: %s", exc)
    except Exception:
        pass
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=_cors_headers_for_error_response(request),
    )


# ---------------------------------------------------------
# Static files (uploaded profile pics, correction attachments, etc.)
# ---------------------------------------------------------
upload_dir = Path(settings.UPLOAD_DIR)
upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")

# ---------------------------------------------------------
# Routers
# ---------------------------------------------------------
app.include_router(login.router, prefix="/auth", tags=["Authentication"])
app.include_router(password_reset.router, prefix="/auth", tags=["Password Reset"])
app.include_router(feedback.router, prefix="/feedback", tags=["Feedback"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(attendance.router, prefix="/attendance", tags=["Attendance"])
app.include_router(attendance_correction.router, prefix="/corrections", tags=["Attendance Corrections"])
app.include_router(leave.router, prefix="/leave", tags=["Leave"])
app.include_router(holidays.router, prefix="/holidays", tags=["Holidays"])
app.include_router(company_settings.router, prefix="/settings", tags=["Company Settings"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
app.include_router(reports.router, prefix="/reports", tags=["Reports"])
app.include_router(device_requests.router, prefix="/device-requests", tags=["Device Requests"])
app.include_router(notifications_emails.router, prefix="/notification-emails", tags=["Notification Emails"])
app.include_router(office_ips.router, prefix="/office-ips", tags=["Office IPs"])
app.include_router(activity_logs.router, prefix="/activity-logs", tags=["Activity Logs"])
app.include_router(employee_documents.router, prefix="/employee-documents", tags=["Employee Documents"])
app.include_router(resources.router, prefix="/resources", tags=["Resources"])


@app.get("/")
def root():
    return {"status": "ok", "message": "Attendance Management System API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
