"""Iteration 2: login lockout, editable branding (/api/settings), scheduled blasts (scheduler), cancel scheduled.
Requires mock firebase: python /app/tests/mockfb.py &  (127.0.0.1:9999)
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MOCK = "http://127.0.0.1:9999"


def login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p})


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


def mock_count():
    return requests.post(f"{MOCK}/__count").json()["sent"]


@pytest.fixture(scope="module")
def admin_tok():
    r = login("papiatma", "Freefire12@")
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def tclient(admin_tok):
    u = f"TEST_s_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/admin/clients", json={"username": u, "password": "pass1234"}, headers=hdr(admin_tok))
    assert r.status_code == 200
    tok = login(u, "pass1234").json()["token"]
    yield {"id": r.json()["id"], "username": u, "token": tok}
    requests.delete(f"{API}/admin/clients/{r.json()['id']}", headers=hdr(admin_tok))


# ---- login lockout ----
class TestLockout:
    def test_lockout_flow(self, admin_tok):
        u = f"TEST_lock_{uuid.uuid4().hex[:6]}"
        cid = requests.post(f"{API}/admin/clients", json={"username": u, "password": "lock123"}, headers=hdr(admin_tok)).json()["id"]
        try:
            for i in range(4):
                r = login(u, "wrong")
                assert r.status_code == 401, (i, r.text)
                assert "try bache" in r.json()["detail"]
                assert f"{4 - i} try bache" in r.json()["detail"]
            r = login(u, "wrong")
            assert r.status_code == 429, r.text
            assert "lock" in r.json()["detail"].lower()
            r = login(u, "wrong")
            assert r.status_code == 429 and "locked" in r.json()["detail"].lower()
            r = login(u, "lock123")
            assert r.status_code == 429, "correct pw while locked must still be 429"
        finally:
            requests.delete(f"{API}/admin/clients/{cid}", headers=hdr(admin_tok))

    def test_success_resets_counter(self, admin_tok):
        u = f"TEST_lock_{uuid.uuid4().hex[:6]}"
        cid = requests.post(f"{API}/admin/clients", json={"username": u, "password": "lock123"}, headers=hdr(admin_tok)).json()["id"]
        try:
            for _ in range(3):
                assert login(u, "bad").status_code == 401
            assert login(u, "lock123").status_code == 200
            r = login(u, "bad")
            assert r.status_code == 401 and "4 try bache" in r.json()["detail"]
        finally:
            requests.delete(f"{API}/admin/clients/{cid}", headers=hdr(admin_tok))

    def test_unknown_user_401(self):
        assert login(f"nouser_{uuid.uuid4().hex[:5]}", "x").status_code == 401


# ---- branding ----
class TestSettings:
    def test_get_public(self):
        r = requests.get(f"{API}/settings")
        assert r.status_code == 200
        d = r.json()
        for k in ("brand_name", "short_name", "tagline", "footer_text"):
            assert isinstance(d[k], str)
        assert "_id" not in d and "id" not in d

    def test_put_admin_and_restore(self, admin_tok):
        orig = requests.get(f"{API}/settings").json()
        new = {"brand_name": "TEST_Brand", "short_name": "TEST_Short", "tagline": "TEST_tag", "footer_text": "TEST_foot"}
        r = requests.put(f"{API}/settings", json=new, headers=hdr(admin_tok))
        assert r.status_code == 200 and r.json() == new
        assert requests.get(f"{API}/settings").json() == new
        r = requests.put(f"{API}/settings", json=orig, headers=hdr(admin_tok))
        assert r.status_code == 200
        assert requests.get(f"{API}/settings").json() == orig

    def test_put_forbidden_client_and_anon(self, tclient):
        body = {"brand_name": "x", "short_name": "x", "tagline": "x", "footer_text": "x"}
        assert requests.put(f"{API}/settings", json=body, headers=hdr(tclient["token"])).status_code == 403
        assert requests.put(f"{API}/settings", json=body).status_code == 401

    def test_put_validation(self, admin_tok):
        r = requests.put(f"{API}/settings", json={"brand_name": "x"}, headers=hdr(admin_tok))
        assert r.status_code == 422


# ---- scheduled blasts ----
class TestSchedule:
    def test_bad_schedule_400(self, tclient):
        t = tclient["token"]
        requests.post(f"{API}/firebases", json={"label": "TEST_m", "url": MOCK, "key": ""}, headers=hdr(t))
        r = requests.post(f"{API}/tasks", json={"leads": [{"to": "9876543210"}], "template": "x", "scheduled_at": "notadate"}, headers=hdr(t))
        assert r.status_code == 400

    def test_cancel_scheduled(self, tclient):
        t = tclient["token"]
        at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        r = requests.post(f"{API}/tasks", json={"leads": [{"to": "9876543210"}], "template": "c", "scheduled_at": at}, headers=hdr(t))
        assert r.status_code == 200 and r.json()["scheduled"] is True
        tid = r.json()["task_id"]
        hist = requests.get(f"{API}/tasks", headers=hdr(t)).json()
        assert any(h["id"] == tid and h["status"] == "scheduled" for h in hist)
        assert requests.post(f"{API}/tasks/{tid}/stop", headers=hdr(t)).status_code == 200
        hist = requests.get(f"{API}/tasks", headers=hdr(t)).json()
        assert [h["status"] for h in hist if h["id"] == tid] == ["stopped"]

    def test_scheduled_runs_at_due_time(self, tclient):
        t = tclient["token"]
        if not requests.get(f"{API}/firebases", headers=hdr(t)).json():
            requests.post(f"{API}/firebases", json={"label": "TEST_m", "url": MOCK, "key": ""}, headers=hdr(t))
        before = mock_count()
        at = (datetime.now(timezone.utc) + timedelta(seconds=40)).isoformat().replace("+00:00", "Z")
        leads = [{"to": f"98111111{i:02d}"} for i in range(3)]
        r = requests.post(f"{API}/tasks", json={"leads": leads, "template": "sched", "delayMs": 50, "scheduled_at": at}, headers=hdr(t))
        assert r.status_code == 200 and r.json()["scheduled"] is True, r.text
        tid = r.json()["task_id"]
        seen = set()
        end = time.time() + 100
        status = None
        while time.time() < end:
            h = [x for x in requests.get(f"{API}/tasks", headers=hdr(t)).json() if x["id"] == tid][0]
            status = h["status"]
            seen.add(status)
            if status in ("completed", "failed", "stopped"):
                break
            time.sleep(1)
        assert status == "completed", (status, seen)
        assert h["sent"] == 3
        assert mock_count() - before == 3
        time.sleep(1)
        assert requests.get(f"{API}/firebases", headers=hdr(t)).json() == []  # autoLogout default
