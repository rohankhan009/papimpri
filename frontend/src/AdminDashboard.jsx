import { useEffect, useState } from "react";
import api, { savedUser } from "@/api";

export default function AdminDashboard({ onLogout }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/clients");
      setClients(data);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr("");
    if (!username.trim() || password.length < 4) return setErr("Username aur password (min 4) daalein");
    setBusy(true);
    try {
      await api.post("/admin/clients", { username, password });
      setUsername(""); setPassword("");
      load();
    } catch (e) {
      setErr(e.response?.data?.detail || "Create fail");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, uname) => {
    if (!window.confirm(`Delete client "${uname}"? Uske firebases aur tasks bhi delete honge.`)) return;
    await api.delete(`/admin/clients/${id}`);
    load();
  };

  const doReset = async () => {
    if (resetPw.length < 4) return;
    await api.post(`/admin/clients/${resetFor.id}/password`, { password: resetPw });
    setResetFor(null); setResetPw("");
    load();
  };

  return (
    <div className="lb-panel" data-testid="admin-dashboard">
      <div className="lb-topbar">
        <div className="lb-logo"><span className="lb-grad">Admin</span> Panel</div>
        <div className="lb-pills">
          <span className="lb-pill lb-pfb">{savedUser()}</span>
          <span className="lb-pill lb-pt" data-testid="client-count">{clients.length} clients</span>
        </div>
        <button className="lb-tbtn" data-testid="refresh-clients" onClick={load}>↻ Refresh</button>
        <button className="lb-tbtn lb-danger" data-testid="admin-logout" onClick={onLogout}>Logout</button>
      </div>

      <div className="lb-grid">
        <section className="lb-card" data-testid="create-client-card">
          <div className="lb-card-h"><span>➕ Create Client</span></div>
          <label className="lb-fl">Client username</label>
          <input className="lb-input" data-testid="new-client-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. raju" />
          <label className="lb-fl">Password</label>
          <input className="lb-input" data-testid="new-client-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 chars" />
          <button className="lb-cta" data-testid="create-client-btn" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create Client"}
          </button>
          {err && <div className="lb-err" data-testid="create-client-error">{err}</div>}
          <p className="lb-hint" style={{ marginTop: 14 }}>Client in credentials se login panel par login karega aur apne Firebase add karke blast chalayega.</p>
        </section>

        <section className="lb-card" data-testid="clients-card">
          <div className="lb-card-h"><span>👥 Clients</span><span className="lb-count">{clients.length}</span></div>
          {loading ? (
            <div className="lb-muted">Loading…</div>
          ) : clients.length === 0 ? (
            <div className="lb-muted" data-testid="no-clients">Abhi koi client nahi hai.</div>
          ) : (
            <div className="lb-devlist" data-testid="clients-list" style={{ maxHeight: 420 }}>
              {clients.map((c) => (
                <div key={c.id} className="lb-client-row" data-testid={`client-${c.username}`}>
                  <div className="lb-client-main">
                    <span className="lb-devname">{c.username}</span>
                    <span className="lb-client-meta">{c.firebase_count} firebase{c.active_task ? " · 🟢 task running" : ""}</span>
                  </div>
                  <button className="lb-minibtn" style={{ margin: 0 }} data-testid={`reset-${c.username}`} onClick={() => setResetFor(c)}>Reset pw</button>
                  <button className="lb-xbtn" data-testid={`delete-${c.username}`} onClick={() => remove(c.id, c.username)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {resetFor && (
        <div className="lb-modal" data-testid="reset-modal" onClick={() => setResetFor(null)}>
          <div className="lb-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lb-card-h"><span>Reset password — {resetFor.username}</span></div>
            <input className="lb-input" data-testid="reset-password-input" type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="New password (min 4)" />
            <button className="lb-cta" data-testid="reset-password-submit" onClick={doReset}>Update password</button>
          </div>
        </div>
      )}
    </div>
  );
}
