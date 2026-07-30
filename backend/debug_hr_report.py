from config import settings
from database import SessionLocal
from models import Department, DynamicReportType, DynamicReportSubtype, ReportDefaultRow, User
from sqlalchemy import select

session = SessionLocal()
try:
    print('DB URL:', settings.SQLALCHEMY_DATABASE_URL)
    print('\n--- Departments ---')
    depts = session.execute(select(Department)).scalars().all()
    for d in depts:
        print(d.id, repr(d.name), d.is_active)

    print('\n--- Dynamic Types ---')
    types = session.execute(select(DynamicReportType)).scalars().all()
    for t in types:
        print(t.id, t.department_id, repr(t.name), t.is_active)

    print('\n--- Dynamic Subtypes ---')
    subs = session.execute(select(DynamicReportSubtype)).scalars().all()
    for s in subs:
        print(s.id, s.type_id, repr(s.name), s.has_quantity, s.has_duration, s.has_description, s.is_active)

    print('\n--- Default Rows ---')
    rows = session.execute(select(ReportDefaultRow)).scalars().all()
    for r in rows:
        print(r.id, r.department_id, r.subtype_id, r.is_default)

    print('\n--- Users ---')
    users = session.execute(select(User)).scalars().all()
    for u in users[:50]:
        print(u.id, repr(u.name), repr(u.department), u.role)

    hr_dept = next((d for d in depts if (d.name or '').strip().lower() == 'hr'), None)
    print('\nHR dept', hr_dept.id if hr_dept else None)
    if hr_dept:
        print('HR types', [t.id for t in types if t.department_id == hr_dept.id])
        print('HR subs', [s.id for s in subs if any(t.id == s.type_id for t in types if t.department_id == hr_dept.id)])
        print('HR default subs', [r.subtype_id for r in rows if r.department_id == hr_dept.id])
finally:
    session.close()
