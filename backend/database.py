"""
database.py
SQLAlchemy engine, session factory, and declarative base.
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from config import settings

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,   # avoids "MySQL server has gone away" errors
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session and closes it afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()