from datetime import date
from database import SessionLocal
from models import User
from routers.reports import get_user_daily_report

session = SessionLocal()
try:
    user = session.query(User).filter(User.id == 2).first()
    if not user:
        raise SystemExit('User not found')
    result = get_user_daily_report(date.today(), db=session, current_user=user)
    print(result)
    print('default_subtype_ids:', result.get('default_subtype_ids'))
    print('custom_rows:', result.get('custom_rows'))
    print('report_data len:', len(result.get('report_data', [])))
    for item in result.get('report_data', []):
        print(type(item), item.subtype_id, item.quantity, item.duration, item.description)
finally:
    session.close()
