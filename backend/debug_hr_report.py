from config import settings
from database import SessionLocal
from models import Department, DynamicReportType, DynamicReportSubtype, ReportDefaultRow, User
from sqlalchemy import select

def main():
    session = SessionLocal()
    try:
        depts = session.execute(select(Department)).scalars().all()
        types = session.execute(select(DynamicReportType)).scalars().all()
        subs = session.execute(select(DynamicReportSubtype)).scalars().all()
        rows = session.execute(select(ReportDefaultRow)).scalars().all()

        # Print summary counts for quick diagnostics when run manually.
        print(f"Departments: {len(depts)} | Types: {len(types)} | Subtypes: {len(subs)} | DefaultRows: {len(rows)}")
    finally:
        session.close()


if __name__ == "__main__":
    main()
