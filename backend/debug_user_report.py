from datetime import date
from database import SessionLocal
from models import User
from routers.reports import get_user_daily_report

def main():
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.id == 2).first()
        if not user:
            raise SystemExit('User not found')
        result = get_user_daily_report(date.today(), db=session, current_user=user)
        print('Report summary:', {k: v for k, v in result.items() if k in ('attendance_date', 'default_subtype_ids', 'custom_rows')})
    finally:
        session.close()


if __name__ == "__main__":
    main()
