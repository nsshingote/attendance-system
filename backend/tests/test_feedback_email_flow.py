import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from unittest.mock import patch

from database import Base, engine, SessionLocal
from models import Feedback, User
from routers.feedback import create_feedback
from schemas import FeedbackCreate
from utils.email_service import send_feedback_submission_confirmation


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def get_db_session():
    return SessionLocal()


def create_user(email="employee@example.com"):
    db = get_db_session()
    user = User(
        name="Test Employee",
        mobile="9999999001",
        email=email,
        password_hash="hashed",
        role="user",
        department="Engineering",
        designation="Developer",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return db, user


def test_feedback_submission_confirmation_email_contains_submitted_feedback():
    with patch("utils.email_service.send_email", return_value=True) as mock_send_email:
        result = send_feedback_submission_confirmation(
            to_email="employee@example.com",
            employee_name="Test Employee",
            feedback_type="positive",
            feedback_text="The new dashboard is very helpful.",
        )

    assert result is True
    call_args = mock_send_email.call_args[0]
    subject = call_args[1]
    body = call_args[2]
    assert "Thank you for your feedback" in subject
    assert "The new dashboard is very helpful." in body


def test_employee_feedback_routes_only_send_user_confirmation_no_admin_notification():
    db, user = create_user()
    feedback_text = "I like the updated leave tracker."

    with patch("routers.feedback.send_feedback_submission_confirmation") as confirmation_mock:
        response = create_feedback(
            payload=FeedbackCreate(feedback_type="positive", description=feedback_text, is_anonymous=False),
            db=db,
            current_user=user,
        )

    assert response == {"message": "Feedback submitted"}
    confirmation_mock.assert_called_once_with(user.email, user.name, "positive", feedback_text)
    db.close()

    saved_feedback = db.query(Feedback).filter(Feedback.user_id == user.id).first()
    assert saved_feedback is not None
    assert saved_feedback.description == feedback_text
