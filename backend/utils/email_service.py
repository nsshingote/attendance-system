"""
utils/email_service.py
Simple SMTP-based email sending for notifications
(leave requests, correction requests, device approvals, password resets).
"""

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List

from config import settings
from utils.logger import logger


def send_email(to_emails: List[str], subject: str, html_body: str, reply_to: str | None = None) -> bool:
    """Send an HTML email to one or more recipients. Returns True on success.

    `reply_to`, when given, sets the Reply-To header so the recipient's
    reply goes to that address (e.g. the employee) instead of the shared
    sending mailbox in EMAIL_USER.
    """
    if not to_emails:
        return False

    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning("Email credentials (EMAIL_USER / EMAIL_PASSWORD) not configured; skipping email send.")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    msg["To"] = ", ".join(to_emails)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, to_emails, msg.as_string())
        return True
    except Exception as exc:
        logger.error(f"Failed to send email: {exc}")
        return False


def send_leave_request_notification(
    to_emails: List[str], employee_name: str, employee_email: str | None, from_date, to_date, reason: str
):
    subject = f"Leave Request — {employee_name} ({from_date} to {to_date})"
    body = f"""
    <p style="font-size:15px;">
      <b>{employee_name}</b> has submitted a leave request.
      {"(" + employee_email + ")" if employee_email else ""}
    </p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#64748B;">From</td><td><b>{from_date}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748B;">To</td><td><b>{to_date}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748B;">Reason</td><td>{reason or '-'}</td></tr>
    </table>
    <p style="color:#64748B;font-size:12px;">Reply directly to this email to reach {employee_name}.</p>
    """
    return send_email(to_emails, subject, body, reply_to=employee_email)


def send_leave_decision_notification(to_email: str, employee_name: str, status: str, from_date, to_date):
    subject = f"Your Leave Request has been {status}"
    body = f"""
    <p>Hi {employee_name},</p>
    <p>Your leave request from <b>{from_date}</b> to <b>{to_date}</b> has been
    <b>{status}</b>.</p>
    """
    return send_email([to_email], subject, body)


def send_correction_decision_notification(to_email: str, employee_name: str, status: str):
    subject = f"Attendance Correction Request {status}"
    body = f"""
    <p>Hi {employee_name},</p>
    <p>Your attendance correction request has been <b>{status}</b>.</p>
    """
    return send_email([to_email], subject, body)


def send_wfh_decision_notification(to_email: str, employee_name: str, status: str, attendance_date, reason: str | None = None):
    subject = f"Your WFH request for {attendance_date} has been {status}"
    body = f"""
    <p>Hi {employee_name},</p>
    <p>Your WFH request for <b>{attendance_date}</b> has been <b>{status}</b>.</p>
    <p><b>Reason:</b> {reason or 'No reason provided'}</p>
    """
    return send_email([to_email], subject, body)


def send_feedback_submission_confirmation(to_email: str, employee_name: str, feedback_type: str, feedback_text: str):
    subject = "Thank you for your feedback"
    body = f"""
    <p>Hi {employee_name},</p>
    <p>Thank you for your feedback.</p>
    <p><b>Your submitted feedback:</b></p>
    <blockquote style="margin:12px 0;padding:12px 16px;border-left:4px solid #22c55e;background:#f0fdf4;">{feedback_text}</blockquote>
    <p>Your message has been submitted successfully and is saved in the system.</p>
    """
    return send_email([to_email], subject, body)


def send_new_feedback_notification(to_emails: List[str], employee_name: str, feedback_type: str, feedback_text: str):
    subject = "You have new feedbacks"
    body = f"""
    <p>Hi,</p>
    <p>You have new feedbacks to review in the website.</p>
    <p><b>{employee_name}</b> submitted a new {feedback_type} feedback.</p>
    <blockquote style="margin:12px 0;padding:12px 16px;border-left:4px solid #22c55e;background:#f0fdf4;">{feedback_text}</blockquote>
    <p>Please open the feedback page to review it.</p>
    """
    return send_email(to_emails, subject, body)


def send_password_reset_email(to_email: str, reset_link: str):
    subject = "Password Reset Request"
    body = f"""
    <p>You requested a password reset. Click the link below to reset your password:</p>
    <p><a href="{reset_link}">{reset_link}</a></p>
    <p>If you did not request this, please ignore this email.</p>
    """
    return send_email([to_email], subject, body)