from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.users as users_router
from auth import get_current_user
from database import get_db


class FakeDatabase:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1


@pytest.fixture
def profile_photo_app(monkeypatch, tmp_path):
    monkeypatch.setattr(users_router, "PROFILE_UPLOAD_DIR", tmp_path)
    database = FakeDatabase()
    app = FastAPI()
    app.include_router(users_router.router, prefix="/users")
    app.dependency_overrides[get_db] = lambda: database
    app.state.test_database = database
    yield app
    app.dependency_overrides.clear()


def authenticate_as(app, user_id):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id)


def test_remove_profile_photo_deletes_only_authenticated_users_photo(profile_photo_app, tmp_path):
    authenticate_as(profile_photo_app, 11)
    own_photo = tmp_path / "11.jpg"
    another_users_photo = tmp_path / "12.jpg"
    own_photo.write_bytes(b"own image")
    another_users_photo.write_bytes(b"other image")

    response = TestClient(profile_photo_app).delete("/users/me/profile-photo")

    assert response.status_code == 200
    assert response.json() == {"message": "Profile image removed"}
    assert not own_photo.exists()
    assert another_users_photo.read_bytes() == b"other image"
    assert profile_photo_app.state.test_database.commits == 1


def test_remove_profile_photo_succeeds_when_no_photo_exists(profile_photo_app, tmp_path):
    authenticate_as(profile_photo_app, 11)

    response = TestClient(profile_photo_app).delete("/users/me/profile-photo")

    assert response.status_code == 200
    assert response.json() == {"message": "Profile image removed"}
    assert list(tmp_path.iterdir()) == []
    assert profile_photo_app.state.test_database.commits == 0


def test_user_cannot_remove_another_users_profile_photo(profile_photo_app, tmp_path):
    authenticate_as(profile_photo_app, 11)
    another_users_photo = tmp_path / "12.jpg"
    another_users_photo.write_bytes(b"other image")

    response = TestClient(profile_photo_app).delete("/users/me/profile-photo")

    assert response.status_code == 200
    assert another_users_photo.read_bytes() == b"other image"
    assert profile_photo_app.state.test_database.commits == 0


def test_remove_profile_photo_requires_authentication(profile_photo_app, tmp_path):
    photo = tmp_path / "11.jpg"
    photo.write_bytes(b"private user's image")

    response = TestClient(profile_photo_app).delete("/users/me/profile-photo")

    assert response.status_code == 401
    assert photo.read_bytes() == b"private user's image"

