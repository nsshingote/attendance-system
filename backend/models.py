"""
models.py
SQLAlchemy ORM models — one class per table, matching database/schema.sql exactly.
"""

from sqlalchemy import (
    Column, Integer, String, Text, Date, DateTime, Time, TIMESTAMP,
    ForeignKey, Enum, SmallInteger, func, Boolean, DECIMAL, UniqueConstraint
)
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    mobile = Column(String(15), nullable=False, unique=True)
    email = Column(String(100), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum("superadmin", "admin", "user", name="user_role"), nullable=False, default="user")
    department = Column(String(100), nullable=False)
    designation = Column(String(100), nullable=False)
    status = Column(Enum("active", "inactive", name="user_status"), nullable=False, default="active")
    created_at = Column(TIMESTAMP, server_default=func.now())

    device_token = Column(String(255), nullable=True)
    device_name = Column(String(255), nullable=True)
    browser_name = Column(String(100), nullable=True)
    device_registered_at = Column(DateTime, nullable=True)
    last_login = Column(TIMESTAMP, nullable=True)

    annual_leave = Column(Integer, default=6)
    leave_encashed = Column(Integer, default=0)
    last_leave_accrual_date = Column(Date, nullable=True)
    paid_leave_available = Column(Integer, default=1)
    carried_leave = Column(Integer, default=0)

    # Relationships
    attendance_records = relationship("Attendance", back_populates="user", foreign_keys="Attendance.user_id")
    leave_requests = relationship("LeaveRequest", back_populates="user", foreign_keys="LeaveRequest.user_id")
    activity_logs = relationship("ActivityLog", back_populates="user")
    daily_reports = relationship("DailyReport", back_populates="user", foreign_keys="DailyReport.user_id")
    departments = relationship("UserDepartment", back_populates="user", foreign_keys="UserDepartment.user_id")


class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (
        UniqueConstraint("user_id", "department_id", name="uq_user_department"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    is_primary = Column(SmallInteger, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", back_populates="departments", foreign_keys=[user_id])
    department = relationship("Department", foreign_keys=[department_id])


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    check_in = Column(DateTime, nullable=True)
    check_out = Column(DateTime, nullable=True)
    status = Column(
        Enum("Present", "Late", "Half Day", "Absent", "Holiday", "WFH", "On Leave", name="attendance_status"),
        default="Present",
    )
    ip_address = Column(String(45), nullable=True)
    reason = Column(String(255), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_by = Column(Integer, nullable=True)
    manual_override = Column(Boolean, nullable=False, default=False)
    manual_override_by = Column(Integer, nullable=True)
    manual_override_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="attendance_records", foreign_keys=[user_id])
    corrections = relationship("AttendanceCorrection", back_populates="attendance")


class AttendanceCorrection(Base):
    __tablename__ = "attendance_corrections"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id"), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(String(255), nullable=True)
    old_check_in = Column(DateTime, nullable=True)
    new_check_in = Column(DateTime, nullable=True)
    old_check_out = Column(DateTime, nullable=True)
    new_check_out = Column(DateTime, nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected", name="correction_status"), default="Pending")
    created_at = Column(TIMESTAMP, server_default=func.now())

    attendance = relationship("Attendance", back_populates="corrections")
    requester = relationship("User", foreign_keys=[requested_by])

    @property
    def requester_name(self):
        return self.requester.name if self.requester else None


class CompanySettings(Base):
    __tablename__ = "company_settings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    office_start_time = Column(Time, nullable=False)
    office_end_time = Column(Time, nullable=False)
    late_grace_minutes = Column(Integer, nullable=False, default=20)
    weekly_off_day = Column(String(20), default="Sunday")
    created_at = Column(TIMESTAMP, server_default=func.now())


class DeviceRequest(Base):
    __tablename__ = "device_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_token = Column(String(255), nullable=True)
    device_name = Column(String(255), nullable=True)
    browser_name = Column(String(100), nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected", name="device_req_status"), default="Pending")
    requested_at = Column(TIMESTAMP, server_default=func.now())
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])


class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    holiday_date = Column(Date, nullable=False, unique=True)
    holiday_name = Column(String(100), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class LeaveType(Base):
    __tablename__ = "leave_types"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(50), nullable=False, unique=True)
    total_days = Column(Integer, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    leave_type_id = Column(Integer, ForeignKey("leave_types.id"), nullable=True)
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    total_days = Column(Integer, nullable=True)
    reason = Column(Text, nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected", name="leave_status"), default="Pending")
    leave_category = Column(
        Enum("Paid", "Carried", "Unpaid", "Privilege", "Emergency", "Sick", name="leave_category"),
        default="Unpaid",
    )
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    notify_emails = Column(Text, nullable=True)
    # Set only for the single-day leave created by an admin attendance override.
    # Keeping this link lets the override be changed or removed without touching
    # a normal employee leave request.
    manual_override_attendance_id = Column(
        Integer, ForeignKey("attendance.id", ondelete="CASCADE"), nullable=True, unique=True
    )

    user = relationship("User", back_populates="leave_requests", foreign_keys=[user_id])
    leave_type = relationship("LeaveType")
    approver = relationship("User", foreign_keys=[approved_by])
    notification_links = relationship("LeaveNotificationEmail", back_populates="leave_request")
    allocations = relationship(
        "LeaveRequestAllocation",
        back_populates="leave_request",
        cascade="all, delete-orphan",
        lazy="joined",
    )

    @property
    def allocation_summary(self):
        if not self.allocations:
            return self.leave_category
        categories = {alloc.leave_category for alloc in self.allocations}
        if len(categories) == 1:
            return categories.pop()
        return "Mixed"

    @property
    def user_name(self):
        """Employee name for leave-request lists; keep the user ID for internal use."""
        return self.user.name if self.user else None


class LeaveRequestAllocation(Base):
    __tablename__ = "leave_request_allocations"
    __table_args__ = (
        UniqueConstraint("leave_request_id", "allocation_date", name="uq_leave_request_allocation_date"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    leave_request_id = Column(Integer, ForeignKey("leave_requests.id"), nullable=False)
    allocation_date = Column(Date, nullable=False)
    leave_category = Column(
        Enum("Paid", "Carried", "Unpaid", "Privilege", "Emergency", "Sick", name="leave_category"),
        nullable=False,
    )

    leave_request = relationship("LeaveRequest", back_populates="allocations")


class NotificationEmail(Base):
    __tablename__ = "notification_emails"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=True)
    email = Column(String(150), nullable=True)
    is_active = Column(SmallInteger, default=1)


class LeaveNotificationEmail(Base):
    __tablename__ = "leave_notification_emails"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    leave_request_id = Column(Integer, ForeignKey("leave_requests.id"), nullable=True)
    notification_email_id = Column(Integer, ForeignKey("notification_emails.id"), nullable=True)

    leave_request = relationship("LeaveRequest", back_populates="notification_links")
    notification_email = relationship("NotificationEmail")


class OfficeIP(Base):
    __tablename__ = "office_ips"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ip_address = Column(String(45), nullable=False, unique=True)
    network_name = Column(String(100), nullable=True)
    status = Column(Enum("active", "inactive", name="office_ip_status"), default="active")
    created_at = Column(TIMESTAMP, server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(255), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])


class LeaveEncashmentRequest(Base):
    __tablename__ = "leave_encashment_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    days = Column(Integer, nullable=False)
    status = Column(Enum("Pending", "Approved", "Rejected", name="encashment_status"), default="Pending")
    requested_at = Column(TIMESTAMP, server_default=func.now())
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])

    @property
    def user_name(self):
        return self.user.name if self.user else None


class HalfDayRequest(Base):
    __tablename__ = "half_day_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    slot = Column(Enum("morning", "afternoon", name="half_day_slot"), nullable=False)
    reason = Column(String(255), nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected", name="half_day_status"), default="Pending")
    requested_at = Column(TIMESTAMP, server_default=func.now())
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])

    @property
    def user_name(self):
        return self.user.name if self.user else None

class WFHRequest(Base):
    __tablename__ = "wfh_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    reason = Column(String(255), nullable=True)
    status = Column(Enum("Pending", "Approved", "Rejected", name="wfh_status"), default="Pending")
    requested_at = Column(TIMESTAMP, server_default=func.now())
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])

    @property
    def user_name(self):
        return self.user.name if self.user else None


class WorkingSunday(Base):
    __tablename__ = "working_sundays"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    work_date = Column(Date, nullable=False)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    marker = relationship("User", foreign_keys=[marked_by])

class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    activity = Column(String(255), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", back_populates="activity_logs")


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    feedback_type = Column(Enum("positive", "negative", name="feedback_type"), nullable=False)
    description = Column(Text, nullable=False)
    is_anonymous = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    user = relationship("User", foreign_keys=[user_id])


# ============================================================
# REPORT SYSTEM MODELS (EXISTING)
# ============================================================

class ReportDepartment(Base):
    __tablename__ = "report_departments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    created_at = Column(TIMESTAMP, server_default=func.now())


class ReportType(Base):
    __tablename__ = "report_types"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    department_id = Column(Integer, ForeignKey("report_departments.id"), nullable=False)
    name = Column(String(100), nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    department = relationship("ReportDepartment", foreign_keys=[department_id])
    subtypes = relationship("ReportSubtype", back_populates="report_type")


class ReportSubtype(Base):
    __tablename__ = "report_subtypes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    type_id = Column(Integer, ForeignKey("report_types.id"), nullable=False)
    name = Column(String(100), nullable=False)
    has_quantity = Column(Boolean, default=True)
    has_duration = Column(Boolean, default=True)
    has_description = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

    report_type = relationship("ReportType", back_populates="subtypes")


class DailyReport(Base):
    __tablename__ = "daily_reports"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    department_id = Column(Integer, ForeignKey("report_departments.id"), nullable=False)
    type_id = Column(Integer, ForeignKey("report_types.id"), nullable=True)
    subtype_id = Column(Integer, ForeignKey("report_subtypes.id"), nullable=True)
    quantity = Column(Integer, nullable=True)
    duration = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    attachments = Column(Text, nullable=True)
    status = Column(Enum("draft", "submitted", name="report_status"), default="draft")
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="daily_reports")
    department = relationship("ReportDepartment", foreign_keys=[department_id])
    report_type = relationship("ReportType", foreign_keys=[type_id])
    report_subtype = relationship("ReportSubtype", foreign_keys=[subtype_id])


# ============================================================
# DYNAMIC REPORT SYSTEM - NEW MODELS
# ============================================================

class Department(Base):
    """Dynamic departments (admin can add/remove)"""
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    is_active = Column(SmallInteger, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class DynamicReportType(Base):
    """Report types (Document, Schedule, Leads, etc.) - Admin can add"""
    __tablename__ = "dynamic_report_types"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    name = Column(String(100), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(SmallInteger, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    department = relationship("Department", foreign_keys=[department_id])
    creator = relationship("User", foreign_keys=[created_by])
    subtypes = relationship("DynamicReportSubtype", back_populates="report_type")


class DynamicReportSubtype(Base):
    """Report subtypes (Quotation, Invoice, Report, etc.) - Admin can add"""
    __tablename__ = "dynamic_report_subtypes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    type_id = Column(Integer, ForeignKey("dynamic_report_types.id"), nullable=False)
    name = Column(String(100), nullable=False)
    has_quantity = Column(Boolean, default=True)
    has_duration = Column(Boolean, default=True)
    has_description = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(SmallInteger, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    report_type = relationship("DynamicReportType", back_populates="subtypes")
    creator = relationship("User", foreign_keys=[created_by])


class DynamicReportField(Base):
    """Report fields (Quantity, Duration, Budget, etc.) - Admin can add"""
    __tablename__ = "dynamic_report_fields"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    field_type = Column(
        Enum("text", "number", "date", "duration", "textarea", "dropdown", name="dynamic_field_type"),
        nullable=False
    )
    is_default = Column(SmallInteger, default=0)
    show_in_report = Column(SmallInteger, default=1)
    is_required = Column(SmallInteger, default=0)
    sort_order = Column(Integer, default=0)
    is_active = Column(SmallInteger, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class ReportDefaultRow(Base):
    """Default rows per department (admin sets which rows appear by default)"""
    __tablename__ = "report_default_rows"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    subtype_id = Column(Integer, ForeignKey("dynamic_report_subtypes.id"), nullable=False)
    is_default = Column(SmallInteger, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    department = relationship("Department", foreign_keys=[department_id])
    subtype = relationship("DynamicReportSubtype", foreign_keys=[subtype_id])
    creator = relationship("User", foreign_keys=[created_by])


class UserDailyRow(Base):
    """User-added custom rows per day"""
    __tablename__ = "user_daily_rows"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    subtype_id = Column(Integer, ForeignKey("dynamic_report_subtypes.id"), nullable=False)
    is_custom = Column(SmallInteger, default=1)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    subtype = relationship("DynamicReportSubtype", foreign_keys=[subtype_id])


class DailyReportData(Base):
    """Actual report data values per day"""
    __tablename__ = "daily_report_data"
    __table_args__ = (
        UniqueConstraint("user_id", "attendance_date", "department_id", "subtype_id", name="uq_daily_report_data"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    # Preserve submitted history when an obsolete department is removed.
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    department_name = Column(String(100), nullable=True)
    subtype_id = Column(Integer, ForeignKey("dynamic_report_subtypes.id"), nullable=True)
    quantity = Column(Integer, nullable=True)
    duration = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    custom_fields = Column(Text, nullable=True)  # JSON string for custom fields
    submitted_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    department = relationship("Department", foreign_keys=[department_id])
    subtype = relationship("DynamicReportSubtype", foreign_keys=[subtype_id])


class PastReportSubmissionRequest(Base):
    """Approval required before a user can add a report for a past date."""
    __tablename__ = "past_report_submission_requests"
    __table_args__ = (UniqueConstraint("user_id", "attendance_date", "request_type", name="uq_past_report_request"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=True)
    request_type = Column(Enum("Missing Report", "Edit Report", name="past_report_request_type"), nullable=False, default="Missing Report")
    status = Column(Enum("Pending", "Approved", "Rejected", "Submitted", "Completed", name="past_report_request_status"), default="Pending")
    requested_at = Column(TIMESTAMP, server_default=func.now())
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
