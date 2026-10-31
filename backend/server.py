from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import uuid
import time
from collections import deque
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("leadblast")

now_iso = lambda: datetime.now(timezone.utc).isoformat()

# ───────────────────────── auth helpers ─────────────────────────
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def make_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "role": user["role"],
        "username": user["username"],
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not signed in")
    token = authorization[7:]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = await db.users.find_one({"id": claims["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

async def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user

async def require_client(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "client":
        raise HTTPException(status_code=403, detail="Clients only")
    return user

# ───────────────────────── models ─────────────────────────
class LoginIn(BaseModel):
    username: str
    password: str

class AdminSetupIn(BaseModel):
    username: str
    password: str

class ClientIn(BaseModel):
    username: str
    password: str

class PasswordIn(BaseModel):
    password: str

class FirebaseIn(BaseModel):
    label: str
    url: str
    key: str = ""

class Lead(BaseModel):
    to: str
    variable: str = ""

class TaskIn(BaseModel):
    leads: List[Lead]
    template: str
    sim: int = 1
    cap: int = 80
    distribute: str = "spread"   # spread | one
    speed: str = "turbo"          # turbo | safe
    delayMs: int = 400
    maxParallel: int = 0          # 0 = all
    deviceKeys: Optional[List[str]] = None  # None = all online
    autoLogout: bool = True

# ───────────────────────── firebase (server-side) ─────────────────────────
def fb_url(base: str, key: str, path: str) -> str:
    base = base.rstrip("/")
    auth = f"?auth={key}" if key else ""
    return f"{base}/{path}.json{auth}"

async def fb_get(http: httpx.AsyncClient, base, key, path):
    r = await http.get(fb_url(base, key, path), timeout=20)
    r.raise_for_status()
    return r.json()

async def fb_put(http: httpx.AsyncClient, base, key, path, data):
    r = await http.put(fb_url(base, key, path), json=data, timeout=20)
    r.raise_for_status()
    return r.json()

def parse_devices(clients):
    out = []
    if not isinstance(clients, dict):
        return out
    for did, d in clients.items():
        d = d if isinstance(d, dict) else {}
        status = d.get("status", d.get("online"))
        online = status is True or str(status).lower() in ("online", "on")
        out.append({
            "id": did,
            "name": d.get("name") or d.get("model") or did,
            "online": online,
            "battery": d.get("battery", d.get("batt")),
        })
    return out

async def normalize_number(n: str) -> str:
    return "".join(ch for ch in str(n) if ch.isdigit() or ch == "+")

# ───────────────────────── task engine ─────────────────────────
# In-memory registry for live progress. Mongo holds the durable snapshot.
RUNNING = {}  # task_id -> {stop, sent, failed, done, total, log(deque), finished}

async def _flusher(task_id: str):
    while True:
        st = RUNNING.get(task_id)
        if not st:
            return
        await db.tasks.update_one({"id": task_id}, {"$set": {
            "sent": st["sent"], "failed": st["failed"], "done": st["done"],
            "log": list(st["log"]), "updated_at": now_iso(),
        }})
        if st["finished"]:
            return
        await asyncio.sleep(1)

def build_queues(devices, leads, distribute, cap):
    cap = max(1, int(cap))
    queues = {d["key"]: {"device": d, "leads": []} for d in devices}
    if distribute == "one":
        di, count = 0, 0
        for lead in leads:
            if di >= len(devices):
                break
            queues[devices[di]["key"]]["leads"].append(lead)
            count += 1
            if count >= cap:
                di += 1
                count = 0
    else:
        used = {}
        di, placed = 0, 0
        capacity = len(devices) * cap
        for lead in leads:
            if placed >= capacity:
                break
            for _ in range(len(devices)):
                d = devices[di % len(devices)]
                di += 1
                if used.get(d["key"], 0) < cap:
                    used[d["key"]] = used.get(d["key"], 0) + 1
                    queues[d["key"]]["leads"].append(lead)
                    placed += 1
                    break
    return [g for g in queues.values() if g["leads"]]

async def run_task(task_id: str, user_id: str, cfg: dict, groups: list, conn_map: dict):
    st = RUNNING[task_id]
    asyncio.create_task(_flusher(task_id))
    safe = cfg["speed"] == "safe"
    delay = max(0, int(cfg.get("delayMs", 400))) / 1000.0
    pool = cfg.get("maxParallel") or len(groups)
    pool = min(pool, len(groups)) or 1
    sem = asyncio.Semaphore(pool)
    status = "completed"

    try:
        async with httpx.AsyncClient() as http:
            async def send_one(dev, lead):
                msg = cfg["template"].replace("{{v}}", lead.get("variable", "") or "") if "{{v}}" in cfg["template"] else cfg["template"]
                conn = conn_map[dev["connId"]]
                payload = {"from": int(cfg.get("sim", 1)) or 1, "to": lead["to"], "message": msg, "isSended": False}
                await fb_put(http, conn["url"], conn["key"], f"clients/{dev['id']}/webhookEvent/sendSms", payload)
                if safe:
                    deadline = time.time() + 15
                    while time.time() < deadline:
                        await asyncio.sleep(0.7)
                        try:
                            node = await fb_get(http, conn["url"], conn["key"], f"clients/{dev['id']}/webhookEvent/sendSms")
                            if not node or node.get("isSended") in (True, "true"):
                                return True
                        except Exception:
                            pass
                    return False
                elif delay:
                    await asyncio.sleep(delay)
                return True

            async def run_device(group):
                async with sem:
                    dev = group["device"]
                    for lead in group["leads"]:
                        if st["stop"]:
                            return
                        try:
                            ok = await send_one(dev, lead)
                            if ok:
                                st["sent"] += 1
                                st["log"].appendleft({"type": "ok", "text": f"✓ {dev['name']} → {lead['to']}", "t": now_iso()})
                            else:
                                st["failed"] += 1
                                st["log"].appendleft({"type": "err", "text": f"⌛ {dev['name']} → {lead['to']} (timeout)", "t": now_iso()})
                        except Exception as e:
                            st["failed"] += 1
                            st["log"].appendleft({"type": "err", "text": f"✗ {dev['name']} → {lead['to']} ({str(e)[:60]})", "t": now_iso()})
                        st["done"] += 1

            await asyncio.gather(*[run_device(g) for g in groups])
        if st["stop"]:
            status = "stopped"
    except Exception as e:
        status = "failed"
        logger.exception("run_task crashed: %s", e)
        st["log"].appendleft({"type": "err", "text": f"Task error: {str(e)[:80]}", "t": now_iso()})
    finally:
        st["finished"] = True
        st["log"].appendleft({"type": "info", "text": {"stopped": "⏹ Roka gaya.", "failed": "⚠ Task fail hua."}.get(status, "✅ Blast complete."), "t": now_iso()})
        await db.tasks.update_one({"id": task_id}, {"$set": {
            "status": status, "sent": st["sent"], "failed": st["failed"], "done": st["done"],
            "log": list(st["log"]), "finished_at": now_iso(), "updated_at": now_iso(),
        }})
        if cfg.get("autoLogout") and status == "completed":
            await db.firebases.delete_many({"user_id": user_id})
            await db.tasks.update_one({"id": task_id}, {"$set": {"auto_logged_out": True}})

        async def cleanup():
            await asyncio.sleep(10)
            RUNNING.pop(task_id, None)
        asyncio.create_task(cleanup())

# ───────────────────────── routes: setup + auth ─────────────────────────
@api_router.get("/")
async def root():
    return {"message": "Lead Blast API"}

@api_router.get("/setup/status")
async def setup_status():
    has_admin = await db.users.count_documents({"role": "admin"}) > 0
    return {"needs_admin": not has_admin}

@api_router.post("/setup/admin")
async def setup_admin(body: AdminSetupIn):
    if await db.users.count_documents({"role": "admin"}) > 0:
        raise HTTPException(status_code=409, detail="Admin already exists")
    if len(body.password) < 4 or not body.username.strip():
        raise HTTPException(status_code=400, detail="Username/password required")
    user = {"id": str(uuid.uuid4()), "username": body.username.strip(), "role": "admin",
            "password_hash": hash_pw(body.password), "created_at": now_iso(), "created_by": None}
    await db.users.insert_one(user)
    return {"token": make_token(user), "role": "admin", "username": user["username"]}

@api_router.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"username": body.username.strip()})
    if not user or not verify_pw(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Galat username ya password")
    return {"token": make_token(user), "role": user["role"], "username": user["username"]}

@api_router.get("/me")
async def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "username": user["username"], "role": user["role"]}

# ───────────────────────── routes: admin ─────────────────────────
@api_router.get("/admin/clients")
async def list_clients(admin: dict = Depends(require_admin)):
    clients = await db.users.find({"role": "client"}, {"_id": 0, "password_hash": 0}).to_list(1000)
    for c in clients:
        c["firebase_count"] = await db.firebases.count_documents({"user_id": c["id"]})
        running = await db.tasks.find_one({"user_id": c["id"], "status": "running"}, {"_id": 0})
        c["active_task"] = bool(running)
    return clients

@api_router.post("/admin/clients")
async def create_client(body: ClientIn, admin: dict = Depends(require_admin)):
    uname = body.username.strip()
    if not uname or len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Username aur password (min 4) chahiye")
    if await db.users.find_one({"username": uname}):
        raise HTTPException(status_code=409, detail="Username already exists")
    user = {"id": str(uuid.uuid4()), "username": uname, "role": "client",
            "password_hash": hash_pw(body.password), "created_at": now_iso(), "created_by": admin["id"]}
    await db.users.insert_one(user)
    return {"id": user["id"], "username": uname}

@api_router.post("/admin/clients/{client_id}/password")
async def reset_password(client_id: str, body: PasswordIn, admin: dict = Depends(require_admin)):
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password min 4 chars")
    res = await db.users.update_one({"id": client_id, "role": "client"}, {"$set": {"password_hash": hash_pw(body.password)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"ok": True}

@api_router.delete("/admin/clients/{client_id}")
async def delete_client(client_id: str, admin: dict = Depends(require_admin)):
    # stop any running background task for this client
    running = await db.tasks.find({"user_id": client_id, "status": "running"}, {"_id": 0, "id": 1}).to_list(50)
    for t in running:
        st = RUNNING.get(t["id"])
        if st:
            st["stop"] = True
    await db.users.delete_one({"id": client_id, "role": "client"})
    await db.firebases.delete_many({"user_id": client_id})
    await db.tasks.delete_many({"user_id": client_id})
    return {"ok": True}

# ───────────────────────── routes: firebases (client) ─────────────────────────
@api_router.get("/firebases")
async def list_firebases(user: dict = Depends(require_client)):
    fbs = await db.firebases.find({"user_id": user["id"]}, {"_id": 0, "key": 0}).to_list(200)
    for f in fbs:
        f["has_key"] = True  # key stored server-side, not exposed
    return fbs

@api_router.post("/firebases")
async def add_firebase(body: FirebaseIn, user: dict = Depends(require_client)):
    base = body.url.strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    if await db.firebases.find_one({"user_id": user["id"], "url": base}):
        raise HTTPException(status_code=409, detail="Ye Firebase pehle se add hai")
    # validate connection
    try:
        async with httpx.AsyncClient() as http:
            await fb_get(http, base, body.key, "clients")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connect nahi hua: {str(e)[:80]}")
    fb = {"id": str(uuid.uuid4()), "user_id": user["id"], "label": body.label.strip() or "Firebase",
          "url": base, "key": body.key, "created_at": now_iso()}
    await db.firebases.insert_one(fb)
    return {"id": fb["id"], "label": fb["label"], "url": fb["url"], "created_at": fb["created_at"], "has_key": bool(body.key)}

@api_router.delete("/firebases/{fb_id}")
async def delete_firebase(fb_id: str, user: dict = Depends(require_client)):
    await db.firebases.delete_one({"id": fb_id, "user_id": user["id"]})
    return {"ok": True}

@api_router.delete("/firebases")
async def delete_all_firebases(user: dict = Depends(require_client)):
    res = await db.firebases.delete_many({"user_id": user["id"]})
    return {"ok": True, "removed": res.deleted_count}

@api_router.get("/devices")
async def get_devices(user: dict = Depends(require_client)):
    fbs = await db.firebases.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    all_devs, errs = [], []
    async with httpx.AsyncClient() as http:
        results = await asyncio.gather(
            *[fb_get(http, f["url"], f["key"], "clients") for f in fbs], return_exceptions=True
        )
    for f, res in zip(fbs, results):
        if isinstance(res, Exception):
            errs.append(f["label"])
            continue
        for d in parse_devices(res):
            all_devs.append({**d, "key": f["id"] + ":" + d["id"], "connId": f["id"], "connLabel": f["label"]})
    return {"devices": all_devs, "errors": errs}

# ───────────────────────── routes: tasks (client) ─────────────────────────
@api_router.post("/tasks")
async def start_task(body: TaskIn, user: dict = Depends(require_client)):
    if await db.tasks.find_one({"user_id": user["id"], "status": "running"}):
        raise HTTPException(status_code=409, detail="Ek task pehle se chal raha hai")

    fbs = await db.firebases.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    if not fbs:
        raise HTTPException(status_code=400, detail="Koi Firebase add nahi hai")
    conn_map = {f["id"]: {"url": f["url"], "key": f["key"], "label": f["label"]} for f in fbs}

    # fetch live devices
    async with httpx.AsyncClient() as http:
        results = await asyncio.gather(*[fb_get(http, f["url"], f["key"], "clients") for f in fbs], return_exceptions=True)
    devices = []
    for f, res in zip(fbs, results):
        if isinstance(res, Exception):
            continue
        for d in parse_devices(res):
            if d["online"]:
                devices.append({**d, "key": f["id"] + ":" + d["id"], "connId": f["id"], "connLabel": f["label"]})
    if body.deviceKeys:
        allow = set(body.deviceKeys)
        devices = [d for d in devices if d["key"] in allow]
    if not devices:
        raise HTTPException(status_code=400, detail="Koi online device nahi hai")

    leads = [{"to": l.to, "variable": l.variable} for l in body.leads if l.to]
    if not leads:
        raise HTTPException(status_code=400, detail="Koi valid lead nahi")
    if not body.template.strip():
        raise HTTPException(status_code=400, detail="Message body khali hai")

    groups = build_queues(devices, leads, body.distribute, body.cap)
    total = sum(len(g["leads"]) for g in groups)

    cfg = {"template": body.template, "sim": body.sim, "speed": body.speed,
           "delayMs": body.delayMs, "maxParallel": body.maxParallel, "autoLogout": body.autoLogout}

    task_id = str(uuid.uuid4())
    doc = {"id": task_id, "user_id": user["id"], "status": "running", "total": total,
           "sent": 0, "failed": 0, "done": 0, "devices": len(groups), "log": [],
           "config": {**cfg, "distribute": body.distribute, "cap": body.cap},
           "created_at": now_iso(), "updated_at": now_iso(), "finished_at": None}
    await db.tasks.insert_one({k: v for k, v in doc.items()})

    RUNNING[task_id] = {"stop": False, "sent": 0, "failed": 0, "done": 0, "total": total,
                        "log": deque(maxlen=120), "finished": False}
    asyncio.create_task(run_task(task_id, user["id"], cfg, groups, conn_map))
    return {"task_id": task_id, "total": total, "devices": len(groups)}

def _merge_live(doc):
    st = RUNNING.get(doc["id"])
    if st:
        doc = {**doc, "sent": st["sent"], "failed": st["failed"], "done": st["done"], "log": list(st["log"])}
    return doc

@api_router.get("/tasks/current")
async def current_task(user: dict = Depends(require_client)):
    doc = await db.tasks.find_one({"user_id": user["id"], "status": "running"}, {"_id": 0})
    if not doc:
        doc = await db.tasks.find_one({"user_id": user["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        return {"task": None}
    return {"task": _merge_live(doc)}

@api_router.get("/tasks")
async def task_history(user: dict = Depends(require_client)):
    docs = await db.tasks.find({"user_id": user["id"]}, {"_id": 0, "log": 0}).sort("created_at", -1).to_list(50)
    return docs

@api_router.post("/tasks/{task_id}/stop")
async def stop_task(task_id: str, user: dict = Depends(require_client)):
    doc = await db.tasks.find_one({"id": task_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Task not found")
    st = RUNNING.get(task_id)
    if st:
        st["stop"] = True
    else:
        await db.tasks.update_one({"id": task_id}, {"$set": {"status": "stopped", "finished_at": now_iso()}})
    return {"ok": True}

# mark interrupted tasks (server restart) as stopped
@app.on_event("startup")
async def mark_interrupted():
    await db.tasks.update_many({"status": "running"}, {"$set": {"status": "interrupted", "finished_at": now_iso()}})

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
