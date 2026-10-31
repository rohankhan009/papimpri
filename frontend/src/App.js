import { useEffect, useState } from "react";
import "@/App.css";
import api, { setAuth, clearAuth, getToken, savedRole } from "@/api";
import AdminDashboard from "@/AdminDashboard";
import ClientPanel from "@/ClientPanel";

function App() {
  const [booting, setBooting] = useState(true);
  const [needsAdmin, setNeedsAdmin] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/setup/status");
        if (data.needs_admin) {
          setNeedsAdmin(true);
          setBooting(false);
          return;
        }
        if (getToken()) {
          try {
            const me = await api.get("/me");
            setRole(me.data.role);
          } catch {
            clearAuth();
          }
        }
      } catch {}
      setBooting(false);
    })();
  }, []);

  const onAuthed = (r) => setRole(r);
  const logout = () => {
    clearAuth();
    setRole(null);
  };

  if (booting) {
    return (
      <div className="lb-setup" data-testid="booting">
        <div className="lb-muted" style={{ fontSize: 14 }}>Loading…</div>
      </div>
    );
  }
  if (needsAdmin) return <AdminSetup onDone={(r) => { setNeedsAdmin(false); onAuthed(r); }} />;
  if (!role) return <Login onAuthed={onAuthed} />;
  if (role === "admin") return <AdminDashboard onLogout={logout} />;
  return <ClientPanel onLogout={logout} />;
}

/* ───── Admin first-run setup ───── */
function AdminSetup({ onDone }) {
  const [username, setUsername] = useState("papiatma");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    if (!username.trim() || password.length < 4) return setErr("Username aur password (min 4) daalein");
    setBusy(true);
    try {
      const { data } = await api.post("/setup/admin", { username, password });
      setAuth(data.token, data.role, data.username);
      onDone(data.role);
    } catch (e) {
      setErr(e.response?.data?.detail || "Setup fail");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell eyebrow="First-time setup" title="Create Admin" sub="Apna admin username aur password set karein. Ye account clients banayega.">
      <label className="lb-fl">Admin username</label>
      <input className="lb-input" data-testid="setup-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <label className="lb-fl">Password</label>
      <input className="lb-input" data-testid="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Strong password" />
      <button className="lb-cta" data-testid="setup-submit" onClick={submit} disabled={busy}>
        {busy ? "Creating…" : "Create Admin & Login"}
      </button>
      {err && <div className="lb-err" data-testid="setup-error">{err}</div>}
    </AuthShell>
  );
}

/* ───── Login ───── */
function Login({ onAuthed }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { username, password });
      setAuth(data.token, data.role, data.username);
      onAuthed(data.role);
    } catch (e) {
      setErr(e.response?.data?.detail || "Login fail");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell eyebrow="Lead Blast Panel" title={<><span className="lb-grad">SMS</span> Lead Blaster</>} sub="Login karein — admin ya client account se.">
      <label className="lb-fl">Username</label>
      <input className="lb-input" data-testid="login-username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label className="lb-fl">Password</label>
      <input className="lb-input" data-testid="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="lb-cta" data-testid="login-submit" onClick={submit} disabled={busy}>
        {busy ? "Logging in…" : "⚡ Login"}
      </button>
      {err && <div className="lb-err" data-testid="login-error">{err}</div>}
    </AuthShell>
  );
}

export function AuthShell({ eyebrow, title, sub, children }) {
  return (
    <div className="lb-setup" data-testid="auth-screen">
      <div className="lb-orb lb-o1" />
      <div className="lb-orb lb-o2" />
      <div className="lb-setup-card">
        <div className="lb-eyebrow">{eyebrow}</div>
        <h1 className="lb-h1">{title}</h1>
        <p className="lb-sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}

export default App;
