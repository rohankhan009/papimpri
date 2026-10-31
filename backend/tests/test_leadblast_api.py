"""Lead Blaster API regression tests (auth, admin client CRUD, firebases, devices, background tasks, auto-logout, isolation).
Requires mock firebase: python /app/tests/mockfb.py &  (127.0.0.1:9999)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MOCK = "http://127.0.0.1:9999"


def login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
    return r


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


def mock_count():
    return requests.post(f"{MOCK}/__count").json()["sent"]


def wait_task(tok, status_not="running", timeout=60):
    end = time.time() + timeout
    t = None
    while time.time() < end:
        t = requests.get(f"{API}/tasks/current", headers=hdr(tok)).json()["task"]
        if t and t["status"] != status_not:
            return t
        time.sleep(1)
    return t


@pytest.fixture(scope="module")
def admin_tok():
    r = login("papiatma", "Freefire12@")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"
    return r.json()["token"]


@pytest.fixture(scope="module")
def clients(admin_tok):
    """Create two TEST_ clients, cleanup after."""
    made = []
    for _ in range(2):
        u = f"TEST_c_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/admin/clients", json={"username": u, "password": "pass1234"}, headers=hdr(admin_tok))
        assert r.status_code == 200, r.text
        tok = login(u, "pass1234").json()["token"]
        made.append({"id": r.json()["id"], "username": u, "token": tok})
    yield made
    for c in made:
        requests.delete(f"{API}/admin/clients/{c['id']}", headers=hdr(admin_tok))


# ---- setup / auth ----
class TestAuth:
    def test_setup_status(self):
        r = requests.get(f"{API}/setup/status")
        assert r.status_code == 200 and r.json()["needs_admin"] is False

    def test_setup_admin_again_409(self):
        r = requests.post(f"{API}/setup/admin", json={"username": "x", "password": "xxxxx"})
        assert r.status_code == 409

    def test_login_bad(self):
        assert login("papiatma", "wrong").status_code == 401

    def test_me_no_token(self):
        assert requests.get(f"{API}/me").status_code == 401

    def test_raju_login(self):
        r = login("raju", "raju123")
        assert r.status_code == 200 and r.json()["role"] == "client"
        me = requests.get(f"{API}/me", headers=hdr(r.json()["token"])).json()
        assert me["username"] == "raju"


# ---- admin ----
class TestAdmin:
    def test_admin_forbidden_client_endpoints(self, admin_tok):
        assert requests.get(f"{API}/firebases", headers=hdr(admin_tok)).status_code == 403
        r = requests.post(f"{API}/tasks", json={"leads": [{"to": "9876543210"}], "template": "hi"}, headers=hdr(admin_tok))
        assert r.status_code == 403

    def test_client_forbidden_admin_endpoints(self, clients):
        assert requests.get(f"{API}/admin/clients", headers=hdr(clients[0]["token"])).status_code == 403

    def test_create_duplicate_and_list(self, admin_tok, clients):
        r = requests.post(f"{API}/admin/clients", json={"username": clients[0]["username"], "password": "abcd"}, headers=hdr(admin_tok))
        assert r.status_code == 409
        r = requests.post(f"{API}/admin/clients", json={"username": "TEST_short", "password": "ab"}, headers=hdr(admin_tok))
        assert r.status_code == 400
        lst = requests.get(f"{API}/admin/clients", headers=hdr(admin_tok)).json()
        names = [c["username"] for c in lst]
        assert clients[0]["username"] in names
        assert all("password_hash" not in c and "_id" not in c for c in lst)

    def test_reset_password_and_delete(self, admin_tok):
        u = f"TEST_r_{uuid.uuid4().hex[:6]}"
        cid = requests.post(f"{API}/admin/clients", json={"username": u, "password": "old1"}, headers=hdr(admin_tok)).json()["id"]
        r = requests.post(f"{API}/admin/clients/{cid}/password", json={"password": "new1"}, headers=hdr(admin_tok))
        assert r.status_code == 200
        assert login(u, "old1").status_code == 401
        assert login(u, "new1").status_code == 200
        assert requests.post(f"{API}/admin/clients/nope/password", json={"password": "new1"}, headers=hdr(admin_tok)).status_code == 404
        assert requests.delete(f"{API}/admin/clients/{cid}", headers=hdr(admin_tok)).status_code == 200
        assert login(u, "new1").status_code == 401


# ---- firebases / devices / isolation ----
class TestFirebases:
    def test_add_invalid(self, clients):
        r = requests.post(f"{API}/firebases", json={"label": "bad", "url": "http://127.0.0.1:1", "key": ""}, headers=hdr(clients[0]["token"]))
        assert r.status_code == 400

    def test_add_multi_devices_remove_all_isolation(self, clients):
        a, b = clients
        for i in range(2):
            r = requests.post(f"{API}/firebases", json={"label": f"TEST_fb{i}", "url": MOCK, "key": ""}, headers=hdr(a["token"]))
            assert r.status_code == 200, r.text
            assert "_id" not in r.json()
        fbs = requests.get(f"{API}/firebases", headers=hdr(a["token"])).json()
        assert len(fbs) == 2
        devs = requests.get(f"{API}/devices", headers=hdr(a["token"])).json()["devices"]
        online = sorted({d["name"] for d in devs if d["online"]})
        offline = {d["name"] for d in devs if not d["online"]}
        assert online == ["Galaxy-A05", "Vivo-Y17"]
        assert offline == {"Redmi-12"}
        # isolation
        assert requests.get(f"{API}/firebases", headers=hdr(b["token"])).json() == []
        assert requests.get(f"{API}/devices", headers=hdr(b["token"])).json()["devices"] == []
        # b can't delete a's firebase
        requests.delete(f"{API}/firebases/{fbs[0]['id']}", headers=hdr(b["token"]))
        assert len(requests.get(f"{API}/firebases", headers=hdr(a["token"])).json()) == 2
        # single remove
        requests.delete(f"{API}/firebases/{fbs[0]['id']}", headers=hdr(a["token"]))
        assert len(requests.get(f"{API}/firebases", headers=hdr(a["token"])).json()) == 1
        r = requests.delete(f"{API}/firebases", headers=hdr(a["token"]))
        assert r.json()["removed"] == 1
        assert requests.get(f"{API}/firebases", headers=hdr(a["token"])).json() == []


# ---- tasks ----
class TestTasks:
    def test_no_firebase_400(self, clients):
        r = requests.post(f"{API}/tasks", json={"leads": [{"to": "9876543210"}], "template": "hi"}, headers=hdr(clients[1]["token"]))
        assert r.status_code == 400

    def test_turbo_blast_complete_autologout(self, clients):
        a = clients[0]
        requests.post(f"{API}/firebases", json={"label": "TEST_m", "url": MOCK, "key": ""}, headers=hdr(a["token"]))
        before = mock_count()
        leads = [{"to": f"98765432{i:02d}", "variable": f"V{i}"} for i in range(4)]
        r = requests.post(f"{API}/tasks", json={"leads": leads, "template": "Hi {{v}} code 4821", "speed": "turbo", "delayMs": 50}, headers=hdr(a["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 4 and r.json()["devices"] == 2
        t = wait_task(a["token"])
        assert t["status"] == "completed", t
        assert t["sent"] == 4 and t["failed"] == 0
        assert mock_count() - before == 4
        time.sleep(1)
        assert requests.get(f"{API}/firebases", headers=hdr(a["token"])).json() == []
        # isolation of tasks
        tb = requests.get(f"{API}/tasks/current", headers=hdr(clients[1]["token"])).json()["task"]
        assert tb is None
        assert requests.get(f"{API}/tasks", headers=hdr(clients[1]["token"])).json() == []
        # b cannot stop a's task
        assert requests.post(f"{API}/tasks/{t['id']}/stop", headers=hdr(clients[1]["token"])).status_code == 404

    def test_background_persist_relogin_409_and_autologout_off(self, clients):
        a = clients[0]
        requests.post(f"{API}/firebases", json={"label": "TEST_m", "url": MOCK, "key": ""}, headers=hdr(a["token"]))
        leads = [{"to": f"91234567{i:02d}", "variable": str(i)} for i in range(16)]
        r = requests.post(f"{API}/tasks", json={"leads": leads, "template": "safe {{v}}", "speed": "safe", "autoLogout": False}, headers=hdr(a["token"]))
        assert r.status_code == 200, r.text
        tid = r.json()["task_id"]
        # second start -> 409
        r2 = requests.post(f"{API}/tasks", json={"leads": leads, "template": "x"}, headers=hdr(a["token"]))
        assert r2.status_code == 409
        time.sleep(2)
        # "logout" and re-login -> new token
        new_tok = login(a["username"], "pass1234").json()["token"]
        t = requests.get(f"{API}/tasks/current", headers=hdr(new_tok)).json()["task"]
        assert t["id"] == tid and t["status"] == "running" and 0 < t["done"] < 16, t
        t = wait_task(new_tok)
        assert t["status"] == "completed" and t["sent"] == 16
        time.sleep(1)
        # autoLogout False -> firebase still there
        assert len(requests.get(f"{API}/firebases", headers=hdr(new_tok)).json()) == 1
        hist = requests.get(f"{API}/tasks", headers=hdr(new_tok)).json()
        assert len(hist) == 2 and "log" not in hist[0]

    def test_stop_task(self, clients):
        a = clients[0]
        leads = [{"to": f"91234500{i:02d}"} for i in range(20)]
        r = requests.post(f"{API}/tasks", json={"leads": leads, "template": "stop", "speed": "safe"}, headers=hdr(a["token"]))
        assert r.status_code == 200
        time.sleep(1.5)
        requests.post(f"{API}/tasks/{r.json()['task_id']}/stop", headers=hdr(a["token"]))
        t = wait_task(a["token"], timeout=20)
        assert t["status"] == "stopped" and t["done"] < 20
        # stop does not auto-logout
        assert len(requests.get(f"{API}/firebases", headers=hdr(a["token"])).json()) == 1
        requests.delete(f"{API}/firebases", headers=hdr(a["token"]))

    def test_cap_and_one_distribution(self, clients):
        a = clients[0]
        requests.post(f"{API}/firebases", json={"label": "TEST_m", "url": MOCK, "key": ""}, headers=hdr(a["token"]))
        leads = [{"to": f"90000000{i:02d}"} for i in range(10)]
        r = requests.post(f"{API}/tasks", json={"leads": leads, "template": "c", "cap": 3, "distribute": "one", "delayMs": 0}, headers=hdr(a["token"]))
        assert r.status_code == 200
        assert r.json()["total"] == 6 and r.json()["devices"] == 2
        t = wait_task(a["token"])
        assert t["status"] == "completed" and t["sent"] == 6
