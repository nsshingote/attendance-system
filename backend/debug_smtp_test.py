"""Temporary diagnostic for the application SMTP delivery path."""

import argparse

from utils.email_service import send_email


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a simple application SMTP test email.")
    parser.add_argument("recipient", help="Gmail address that should receive the test email")
    args = parser.parse_args()

    sent = send_email(
        [args.recipient],
        "Attendance SMTP Test",
        "This is a test email sent from the attendance application.",
    )
    print("SMTP test accepted by the configured SMTP server." if sent else "SMTP test failed.")
    return 0 if sent else 1


if __name__ == "__main__":
    raise SystemExit(main())
