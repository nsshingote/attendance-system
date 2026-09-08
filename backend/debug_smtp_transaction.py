"""Temporary diagnostic for SMTP envelope and transaction responses."""

import argparse
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect SMTP responses without logging message content.")
    parser.add_argument("recipient", help="Gmail address that should receive the diagnostic")
    args = parser.parse_args()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Attendance SMTP Transaction Diagnostic"
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    msg["To"] = args.recipient
    msg.attach(MIMEText("SMTP transaction diagnostic message.", "plain"))

    envelope_sender = settings.SMTP_USER
    print(f"Envelope MAIL FROM: {envelope_sender}")
    print(f"Header From: {msg['From']}")
    print("Generated headers:")
    for name, value in msg.items():
        print(f"  {name}: {value}")

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        code, response = server.ehlo()
        print(f"EHLO: {code} {response.decode(errors='replace')}")

        code, response = server.starttls()
        print(f"STARTTLS: {code} {response.decode(errors='replace')}")
        server.ehlo()

        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        print("AUTH: completed")

        code, response = server.mail(envelope_sender)
        print(f"MAIL FROM: {code} {response.decode(errors='replace')}")
        code, response = server.rcpt(args.recipient)
        print(f"RCPT TO: {code} {response.decode(errors='replace')}")
        code, response = server.data(msg.as_bytes())
        print(f"DATA/final response: {code} {response.decode(errors='replace')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
