"""
config.py
Central configuration for the Attendance Management System backend.
Reads settings from environment variables (.env file).

Variable names here match the user's actual .env file:
DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DATABASE_URL,
SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD,
UPLOAD_FOLDER
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from the repo root and backend-specific .env file.
# Backend-specific values should override root-level settings when both exist.
root_env_path = Path(__file__).resolve().parents[1] / ".env"
backend_env_path = Path(__file__).resolve().parent / ".env"
if root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path, override=False)
if backend_env_path.exists():
    # Do not override already-set environment variables so tests
    # can inject `DATABASE_URL` programmatically.
    load_dotenv(dotenv_path=backend_env_path, override=False)


class Settings:
    # Prevent unsafe development defaults from silently becoming production
    # credentials. Set APP_ENV=production in deployed environments.
    APP_ENV: str = os.getenv("APP_ENV", "development").lower()
    # ---- Database ----
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "3306")
    DB_USER: str = os.getenv("DB_USER", "root")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_NAME: str = os.getenv("DB_NAME", "attendance_system")

    # Use DATABASE_URL directly if provided (matches the user's .env),
    # otherwise build it from the individual DB_* parts above.
    SQLALCHEMY_DATABASE_URL: str = os.getenv("DATABASE_URL") or (
        f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

    # ---- JWT / Auth ----
    JWT_SECRET_KEY: str = os.getenv("SECRET_KEY", "change-this-secret-in-production")
    JWT_ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    REFRESH_COOKIE_SECURE: bool = os.getenv("REFRESH_COOKIE_SECURE", "true" if os.getenv("APP_ENV") == "production" else "false").lower() == "true"
    REFRESH_COOKIE_SAMESITE: str = os.getenv("REFRESH_COOKIE_SAMESITE", "lax").lower()

    # ---- CORS ----
    FRONTEND_ORIGINS: list[str] = [
        origin.strip().rstrip("/")
        for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").split(",")
        if origin.strip()
    ]

    # ---- Email (SMTP) ----
    # Accepts either naming convention (SMTP_* or EMAIL_*) so it doesn't
    # matter which one ends up in .env — whichever is set wins.
    SMTP_HOST: str = os.getenv("SMTP_HOST") or os.getenv("EMAIL_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT") or os.getenv("EMAIL_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER") or os.getenv("EMAIL_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD") or os.getenv("EMAIL_PASSWORD", "")
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME") or os.getenv("EMAIL_FROM_NAME", "Attendance System")

    # ---- File uploads ----
    UPLOAD_DIR: str = os.getenv("UPLOAD_FOLDER", "uploads")

    # ---- Company defaults (fallback if company_settings table empty) ----
    DEFAULT_OFFICE_START_TIME: str = os.getenv("DEFAULT_OFFICE_START_TIME", "10:00:00")
    DEFAULT_OFFICE_END_TIME: str = os.getenv("DEFAULT_OFFICE_END_TIME", "18:30:00")
    DEFAULT_LATE_GRACE_MINUTES: int = int(os.getenv("DEFAULT_LATE_GRACE_MINUTES", "20"))
    DEFAULT_WEEKLY_OFF_DAY: str = os.getenv("DEFAULT_WEEKLY_OFF_DAY", "Sunday")

    def __init__(self) -> None:
        if self.APP_ENV == "production" and self.JWT_SECRET_KEY == "change-this-secret-in-production":
            raise RuntimeError("SECRET_KEY must be set to a strong value when APP_ENV=production")
        if self.REFRESH_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
            raise RuntimeError("REFRESH_COOKIE_SAMESITE must be lax, strict, or none")
        if self.REFRESH_COOKIE_SAMESITE == "none" and not self.REFRESH_COOKIE_SECURE:
            raise RuntimeError("REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true")


settings = Settings()
