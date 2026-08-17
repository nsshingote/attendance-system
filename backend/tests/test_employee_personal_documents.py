import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from database import Base, engine
from models import EmployeePersonalDocument, User


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def test_personal_document_model_exists():
    assert hasattr(User, "address_line_1")
    assert EmployeePersonalDocument.__tablename__ == "employee_personal_documents"
