"""
schemas.py
Pydantic models used for request validation and response serialization.
"""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo
from typing import Optional, List

from pydantic import BaseModel, EmailStr, ConfigDict, field_validator


# =========================================================
# Shared config
# =========================================================
class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FeedbackCreate(BaseModel):
    feedback_type: str
    description: str
    is_anonymous: bool = False

    @field_validator("feedback_type")
    @classmethod
    def validate_feedback_type(cls, value: str) -> str:
        if value not in {"positive", "negative"}:
            raise ValueError("Feedback type must be positive or negative")
        return value

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Description is required")
        return value.strip()


# =========================================================
# Auth
# =========================================================
class LoginRequest(BaseModel):
    mobile: str
    password: str
    device_token: Optional[str] = None
    device_name: Optional[str] = None
    browser_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    name: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


# =========================================================
# Users
# =========================================================
class UserBase(BaseModel):
    name: str
    mobile: str
    email: Optional[EmailStr] = None
    department: str
    designation: str
    role: str = "user"
    status: str = "active"
    annual_leave: int = 6


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    annual_leave: Optional[int] = None


class UserOut(ORMBase):
    id: int
    name: str
    mobile: str
    email: Optional[EmailStr] = None
    role: str
    department: str
    designation: str
    status: str
    created_at: datetime
    annual_leave: int
    leave_encashed: int
    device_name: Optional[str] = None
    last_login: Optional[datetime] = None


# =========================================================
# Attendance
# =========================================================
class CheckInRequest(BaseModel):
    ip_address: Optional[str] = None
    reason: Optional[str] = None  # required by the API if check-in is after the late cutoff


class CheckOutRequest(BaseModel):
    ip_address: Optional[str] = None
    reason: Optional[str] = None  # required by the API if check-out is before the early cutoff


class AttendanceOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    status: str
    ip_address: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime
    has_report: Optional[bool] = None


class AttendanceManualUpdate(BaseModel):
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    status: Optional[str] = None


# =========================================================
# Attendance Corrections
# =========================================================

class CorrectionCreate(BaseModel):
    attendance_id: int
    reason: str
    new_check_in: Optional[str] = None  # Time string like "18:30"
    new_check_out: Optional[str] = None  # Time string like "18:30"
    user_id: Optional[int] = None


class CorrectionDecision(BaseModel):
    status: str  # "Approved" or "Rejected"


class CorrectionOut(ORMBase):
    id: int
    attendance_id: int
    requested_by: int
    requester_name: Optional[str] = None
    reason: Optional[str] = None
    old_check_in: Optional[datetime] = None
    new_check_in: Optional[datetime] = None
    old_check_out: Optional[datetime] = None
    new_check_out: Optional[datetime] = None
    status: str
    created_at: datetime

# =========================================================
# Leave
# =========================================================
class LeaveTypeOut(ORMBase):
    id: int
    name: str
    total_days: int


class LeaveRequestCreate(BaseModel):
    leave_type_id: Optional[int] = None
    from_date: date
    to_date: date
    reason: Optional[str] = None
    leave_category: Optional[str] = None
    notify_email_ids: Optional[List[int]] = None
    user_id: Optional[int] = None  # Admin/SuperAdmin only: submit on behalf of this employee instead of self


class LeaveDecision(BaseModel):
    status: str  # "Approved" or "Rejected"
    leave_category: Optional[str] = None  # Optional category override when approving


class LeaveCategoryOverride(BaseModel):
    leave_category: str  # admin can set this to "Privilege" (or any valid category)


class LeaveRequestOut(ORMBase):
    id: int
    user_id: int
    user_name: Optional[str] = None
    leave_type_id: Optional[int] = None
    from_date: date
    to_date: date
    total_days: Optional[int] = None
    reason: Optional[str] = None
    status: str
    leave_category: str
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None 
    created_at: datetime


class LeaveEncashmentCreate(BaseModel):
    days: int
    user_id: Optional[int] = None  # Admin only: encash for this user


class LeaveEncashmentDecision(BaseModel):
    status: str  # "Approved" or "Rejected"


class LeaveEncashmentOut(ORMBase):
    id: int
    user_id: int
    days: int
    status: str
    approved_by: Optional[int] = None
    requested_at: datetime
    approved_at: Optional[datetime] = None


# =========================================================
# Leave Balance Response (ADD THIS - was missing)
# =========================================================
class LeaveBalanceResponse(BaseModel):
    user_id: int
    user_name: str
    paid_leave_available_this_month: int
    carried_leave: int
    leave_encashed: int
    total_leave_balance: int


# =========================================================
# Half Day
# =========================================================
class HalfDaySlot(str):
    MORNING = "morning"     # 10:00 AM - 2:30 PM
    AFTERNOON = "afternoon"  # 2:30 PM - 6:30 PM


class HalfDayCreate(BaseModel):
    attendance_date: date
    slot: str  # "morning" or "afternoon"
    reason: Optional[str] = None


class HalfDayDecision(BaseModel):
    status: str  # "Approved" or "Rejected"


class HalfDayOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    slot: str
    reason: Optional[str] = None
    status: str
    approved_by: Optional[int] = None
    requested_at: datetime
    approved_at: Optional[datetime] = None


# =========================================================
# Work From Home
# =========================================================
class WFHCreate(BaseModel):
    attendance_date: date
    reason: Optional[str] = None

    @field_validator("attendance_date")
    def validate_attendance_date(cls, value: date) -> date:
        ist_today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        if value < ist_today:
            raise ValueError("attendance_date cannot be in the past")
        return value


class WFHDecision(BaseModel):
    status: str  # "Approved" or "Rejected"


class WFHOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    reason: Optional[str] = None
    status: str
    approved_by: Optional[int] = None
    requested_at: datetime
    approved_at: Optional[datetime] = None

# =========================================================
# Holidays
# =========================================================
class HolidayCreate(BaseModel):
    holiday_date: date
    holiday_name: str


class HolidayOut(ORMBase):
    id: int
    holiday_date: date
    holiday_name: str
    created_by: int
    created_at: datetime


# =========================================================
# Company Settings
# =========================================================
class CompanySettingsUpdate(BaseModel):
    office_start_time: time
    office_end_time: time
    late_grace_minutes: int
    weekly_off_day: str


class CompanySettingsOut(ORMBase):
    id: int
    office_start_time: time
    office_end_time: time
    late_grace_minutes: int
    weekly_off_day: str


# =========================================================
# Device Requests
# =========================================================
class DeviceRequestCreate(BaseModel):
    device_token: str
    device_name: str
    browser_name: str


class DeviceRequestDecision(BaseModel):
    status: str  # "Approved" or "Rejected"


class DeviceRequestOut(ORMBase):
    id: int
    user_id: int
    device_token: Optional[str] = None
    device_name: Optional[str] = None
    browser_name: Optional[str] = None
    status: str
    requested_at: datetime
    approved_by: Optional[int] = None


# =========================================================
# Notification Emails
# =========================================================
class NotificationEmailCreate(BaseModel):
    name: str
    email: EmailStr
    is_active: bool = True


class NotificationEmailOut(ORMBase):
    id: int
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    is_active: bool


# =========================================================
# Office IPs
# =========================================================
class OfficeIPCreate(BaseModel):
    ip_address: str
    network_name: Optional[str] = None
    status: str = "active"


class OfficeIPOut(ORMBase):
    id: int
    ip_address: str
    network_name: Optional[str] = None
    status: str
    created_at: datetime


# =========================================================
# Activity Logs
# =========================================================
class ActivityLogOut(ORMBase):
    id: int
    user_id: int
    activity: str
    created_at: datetime


# =========================================================
# Dashboard / Reports
# =========================================================
class DashboardSummary(BaseModel):
    total_employees: int
    present_today: int
    late_today: int
    half_day_today: int
    absent_today: int
    on_leave_today: int
    pending_corrections: int
    pending_leaves: int
    pending_device_requests: int


# =========================================================
# Admin Dashboard Stats
# =========================================================
class TodayAttendanceOut(BaseModel):
    user_id: int
    user_name: str
    department: str
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    status: str
    reason: Optional[str] = None
    report: Optional[str] = None
    has_report: Optional[bool] = None


class AdminDashboardStats(BaseModel):
    total_employees: int
    present_today: int
    absent_today: int
    half_day_today: int
    late_today: int
    wfh_today: int
    holiday_today: int
    pending_leave_requests: int
    pending_corrections: int
    pending_device_requests: int
    monthly_leave_used: int
    today_attendance: List[TodayAttendanceOut]

    class Config:
     from_attributes = True
# =========================================================
# Employee Dashboard Stats
# =========================================================
class EmployeeDashboardStats(BaseModel):
    user_id: int
    user_name: str
    today_status: str
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    pending_leave_requests: int
    pending_corrections: int


# =========================================================
# Attendance History / Calendar
# =========================================================
class AttendanceHistoryResponse(BaseModel):
    records: List[AttendanceOut]
    summary: dict


class AttendanceCalendarDay(BaseModel):
    date: date
    status: Optional[str] = None
    check_in: Optional[datetime] = None
    check_out: Optional[datetime] = None
    hours_worked: Optional[float] = None


class AttendanceCalendarResponse(BaseModel):
    user_id: int
    user_name: str
    month: int
    year: int
    days: List[AttendanceCalendarDay]


class MonthlySummaryResponse(BaseModel):
    user_id: int
    user_name: str
    month: int
    year: int
    total_days: int
    working_days: int
    present: int
    absent: int
    half_day: int
    late: int
    holiday: int

# =========================================================
# REPORT SYSTEM SCHEMAS
# =========================================================

# Report Department
class ReportDepartmentOut(ORMBase):
    id: int
    name: str
    created_at: datetime


# Report Type
class ReportTypeOut(ORMBase):
    id: int
    department_id: int
    name: str
    sort_order: int
    created_at: datetime


# Report Subtype
class ReportSubtypeOut(ORMBase):
    id: int
    type_id: int
    name: str
    has_quantity: bool
    has_duration: bool
    has_description: bool
    sort_order: int
    created_at: datetime


# Report Type with Subtypes (for frontend hierarchy)
class ReportTypeWithSubtypes(ReportTypeOut):
    subtypes: List[ReportSubtypeOut]


# Report Department with Types (for frontend hierarchy)
class ReportDepartmentWithTypes(ReportDepartmentOut):
    types: List[ReportTypeWithSubtypes]


# Create Report Request
class ReportCreate(BaseModel):
    attendance_date: date
    department_id: int
    type_id: Optional[int] = None
    subtype_id: Optional[int] = None
    quantity: Optional[int] = None
    duration: Optional[str] = None
    description: Optional[str] = None

# Report Out
class ReportOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    department_id: int
    type_id: Optional[int] = None
    subtype_id: Optional[int] = None
    quantity: Optional[int] = None
    duration: Optional[float] = None
    description: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# Report with User Info
class ReportWithUserOut(ReportOut):
    user_name: str
    user_department: str
    department_name: str
    type_name: Optional[str] = None
    subtype_name: Optional[str] = None


# Check if Report Exists for a Date
class ReportStatusResponse(BaseModel):
    has_report: bool
    report_id: Optional[int] = None
    status: Optional[str] = None


# ============================================================
# DYNAMIC REPORT SYSTEM SCHEMAS
# ============================================================

# Department Schemas
class DepartmentBase(BaseModel):
    name: str
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentOut(ORMBase):
    id: int
    name: str
    is_active: bool
    created_by: int
    created_at: datetime


class UserDepartmentBase(BaseModel):
    department_id: int
    is_primary: bool = False


class UserDepartmentCreate(UserDepartmentBase):
    pass


class UserDepartmentOut(ORMBase):
    id: int
    user_id: int
    department_id: int
    is_primary: bool
    created_at: datetime


# Dynamic Report Type Schemas
class DynamicReportTypeBase(BaseModel):
    department_id: int
    name: str
    sort_order: int = 0
    is_active: bool = True


class DynamicReportTypeCreate(DynamicReportTypeBase):
    pass


class DynamicReportTypeOut(ORMBase):
    id: int
    department_id: int
    name: str
    sort_order: int
    is_active: bool
    created_by: int
    created_at: datetime
    subtypes: List["DynamicReportSubtypeOut"] = []


# Dynamic Report Subtype Schemas
class DynamicReportSubtypeBase(BaseModel):
    type_id: int
    name: str
    has_quantity: bool = True
    has_duration: bool = True
    has_description: bool = False
    sort_order: int = 0
    is_active: bool = True


class DynamicReportSubtypeCreate(DynamicReportSubtypeBase):
    pass


class DynamicReportSubtypeOut(ORMBase):
    id: int
    type_id: int
    name: str
    has_quantity: bool
    has_duration: bool
    has_description: bool
    sort_order: int
    is_active: bool
    created_by: int
    created_at: datetime


# Dynamic Report Field Schemas
class DynamicReportFieldBase(BaseModel):
    name: str
    field_type: str
    is_default: bool = False
    show_in_report: bool = True
    is_required: bool = False
    sort_order: int = 0
    is_active: bool = True


class DynamicReportFieldCreate(DynamicReportFieldBase):
    pass


class DynamicReportFieldOut(ORMBase):
    id: int
    name: str
    field_type: str
    is_default: bool
    show_in_report: bool
    is_required: bool
    sort_order: int
    is_active: bool
    created_by: int
    created_at: datetime


# Report Default Row Schemas
class ReportDefaultRowBase(BaseModel):
    department_id: int
    subtype_id: int
    is_default: bool = True


class ReportDefaultRowCreate(ReportDefaultRowBase):
    pass


class ReportDefaultRowOut(ORMBase):
    id: int
    department_id: int
    subtype_id: int
    is_default: bool
    created_by: int
    created_at: datetime


# User Daily Row Schemas
class UserDailyRowBase(BaseModel):
    attendance_date: date
    subtype_id: int
    is_custom: bool = True


class UserDailyRowCreate(UserDailyRowBase):
    pass


class UserDailyRowOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    subtype_id: int
    is_custom: bool
    created_at: datetime

# Daily Report Data Schemas
class DailyReportDataBase(BaseModel):
    attendance_date: date
    subtype_id: Optional[int] = None
    department_id: Optional[int] = None
    quantity: Optional[int] = None
    duration: Optional[str] = None
    description: Optional[str] = None
    custom_fields: Optional[str] = None
    
    @field_validator('attendance_date', mode='before')
    @classmethod
    def validate_attendance_date(cls, v):
        """Convert string date to date object"""
        if isinstance(v, str):
            try:
                return datetime.strptime(v, '%Y-%m-%d').date()
            except ValueError:
                raise ValueError(f'Invalid date format: {v}. Expected YYYY-MM-DD')
        return v
    
    @field_validator('subtype_id', mode='before')
    @classmethod
    def validate_subtype_id(cls, v):
        if v is None or v == "" or v == "null":
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            return None
    
    @field_validator('quantity', mode='before')
    @classmethod
    def validate_quantity(cls, v):
        if v is None or v == "" or v == "null":
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            return None

    @field_validator('department_id', mode='before')
    @classmethod
    def validate_department_id(cls, v):
        if v is None or v == "" or v == "null":
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            raise ValueError("Department ID must be a valid integer.")

    @field_validator('duration', mode='before')
    @classmethod
    def validate_duration(cls, v):
        if v is None or v == "" or v == "null":
            return None
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("Duration must be a valid number.")
        try:
            # Accept numeric values and numeric strings only
            float(v)
        except (ValueError, TypeError):
            raise ValueError("Duration must be a valid number.")
        return str(v)

class DailyReportDataCreate(DailyReportDataBase):
    pass


class DailyReportDataOut(ORMBase):
    id: int
    user_id: int
    attendance_date: date
    department_id: int
    subtype_id: Optional[int] = None
    quantity: Optional[int] = None
    duration: Optional[str] = None
    description: Optional[str] = None
    custom_fields: Optional[str] = None
    submitted_at: datetime
    updated_at: Optional[datetime] = None


# Complete Report Structure for Frontend
class ReportStructureResponse(BaseModel):
    departments: List[DepartmentOut]
    types: List[DynamicReportTypeOut]
    subtypes: List[DynamicReportSubtypeOut]
    fields: List[DynamicReportFieldOut]
    default_rows: List[ReportDefaultRowOut]


# User's Daily Report Response
class UserDailyReportResponse(BaseModel):
    date: date
    department_id: int
    department_name: str
    assigned_departments: List[dict] = []
    default_subtype_ids: List[int] = []
    custom_subtype_ids: List[int] = []
    custom_rows: List[UserDailyRowOut] = []
    report_data: List[DailyReportDataOut] = []
    all_subtypes: List[DynamicReportSubtypeOut] = []
    all_subtypes: List[DynamicReportSubtypeOut]
