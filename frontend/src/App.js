import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "@/App.css";
import { normalizeUrl, fbGet, parseDevices, sendSmsCommand, waitForAck } from "@/firebase";
import { parseCsvFile, parseXlsxFile, parsePasted, digits } from "@/leads";

const LS_CONNS = "lb_fb_conns";
const LS_URL = "lb_fb_url"; // legacy single-connection keys (migrated)
const LS_KEY = "lb_fb_key";

const uid = () => Math.random().toString(36).slice(2, 9);

function loadConns() {
  try {
    const raw = localStorage.getItem(LS_CONNS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // migrate legacy single connection
  const u = localStorage.getItem(LS_URL);
  if (u) return [{ id: uid(), label: "Firebase 1", url: u, key: localStorage.getItem(LS_KEY) || "" }];
  return [];
}

function App() {
  const [connected, setConnected] = useState(false);
  const [conns, setConns] = useState([]);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const saved = loadConns();
    setConns(saved);
    if (saved.length > 0) {
      Promise.allSettled(saved.map((c) => fbGet(normalizeUrl(c.url), c.key, "clients")))
        .then((r) => {
          if (r.some((x) => x.status === "fulfilled")) setConnected(true);
        })
        .finally(() => setBooting(false));
    } else setBooting(false);
  }, []);

  const saveAndEnter = (list) => {
    const norm = list.map((c) => ({ ...c, url: normalizeUrl(c.url) }));
    localStorage.setItem(LS_CONNS, JSON.stringify(norm));
    localStorage.removeItem(LS_URL);
    localStorage.removeItem(LS_KEY);
    setConns(norm);
    setConnected(true);
  };

  const logoutAll = () => {
    localStorage.removeItem(LS_CONNS);
    localStorage.removeItem(LS_URL);
    localStorage.removeItem(LS_KEY);
    setConns([]);
    setConnected(false);
  };

  if (booting) {
    return (
      <div className="lb-setup" data-testid="booting">
        <div className="lb-muted" style={{ fontSize: 14 }}>Connecting…</div>
      </div>
    );
  }
  if (!connected) return <Setup initial={conns} onConnected={saveAndEnter} />;
  return <Panel conns={conns} onLogoutAll={logoutAll} />;
}

/* ───────────────────────── SETUP (multi-Firebase) ───────────────────────── */
function Setup({ initial, onConnected }) {
  const [rows, setRows] = useState(
    initial.length ? initial : [{ id: uid(), label: "Firebase 1", url: "", key: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({}); // id -> 'ok'|'fail'
  const [err, setErr] = useState("");

  const update = (id, field, val) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, [field]: val } : x)));
  const addRow = () =>
    setRows((r) => [...r, { id: uid(), label: `Firebase ${r.length + 1}`, url: "", key: "" }]);
  const removeRow = (id) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));

  const connectAll = async () => {
    setErr("");
    const filled = rows.filter((r) => r.url.trim());
    if (filled.length === 0) {
      setErr("Kam se kam ek Firebase DB URL daalein");
      return;
    }
    setBusy(true);
    const st = {};
    const results = await Promise.allSettled(
      filled.map((c) => fbGet(normalizeUrl(c.url), c.key, "clients"))
    );
    results.forEach((res, i) => (st[filled[i].id] = res.status === "fulfilled" ? "ok" : "fail"));
    setStatus(st);
    setBusy(false);
    const okConns = filled.filter((c) => st[c.id] === "ok");
    if (okConns.length === 0) {
      setErr("Koi bhi Firebase connect nahi hua — URL / key check karein");
      return;
    }
    onConnected(okConns);
  };

  return (
    <div className="lb-setup" data-testid="setup-screen">
      <div className="lb-orb lb-o1" />
      <div className="lb-orb lb-o2" />
      <div className="lb-setup-card lb-setup-wide">
        <div className="lb-eyebrow">Lead Blast Panel</div>
        <h1 className="lb-h1">
          <span className="lb-grad">SMS</span> Lead Blaster
        </h1>
        <p className="lb-sub">
          Ek ya zyada Firebase add karo — sabke devices ek saath bind ho jayenge.
        </p>

        <div className="lb-conns" data-testid="conn-list">
          {rows.map((r, i) => (
            <div className="lb-conn" key={r.id} data-testid={`conn-${i}`}>
              <div className="lb-conn-head">
                <input
                  className="lb-conn-label"
                  data-testid={`conn-label-${i}`}
                  value={r.label}
                  onChange={(e) => update(r.id, "label", e.target.value)}
                  placeholder="Label"
                />
                {status[r.id] === "ok" && <span className="lb-tag ok">● connected</span>}
                {status[r.id] === "fail" && <span className="lb-tag fail">● failed</span>}
                {rows.length > 1 && (
                  <button
                    className="lb-xbtn"
                    data-testid={`conn-remove-${i}`}
                    onClick={() => removeRow(r.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <input
                className="lb-input"
                data-testid={`conn-url-${i}`}
                placeholder="https://project-default-rtdb.firebaseio.com"
                value={r.url}
                onChange={(e) => update(r.id, "url", e.target.value)}
              />
              <input
                className="lb-input"
                data-testid={`conn-key-${i}`}
                placeholder="Auth secret / key (optional)"
                type="password"
                value={r.key}
                onChange={(e) => update(r.id, "key", e.target.value)}
                style={{ marginBottom: 0 }}
              />
            </div>
          ))}
        </div>

        <button className="lb-addconn" data-testid="add-conn" onClick={addRow}>
          + Add another Firebase
        </button>
        <button className="lb-cta" data-testid="connect-btn" onClick={connectAll} disabled={busy}>
          {busy ? "Connecting…" : `⚡ Connect ${rows.filter((r) => r.url.trim()).length || ""} Firebase`}
        </button>
        {err && (
          <div className="lb-err" data-testid="connect-error">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── PANEL ───────────────────────── */
function Panel({ conns, onLogoutAll }) {
  const [devices, setDevices] = useState([]);
  const [loadingDevs, setLoadingDevs] = useState(true);
  const [devErr, setDevErr] = useState("");

  const [leadData, setLeadData] = useState({ columns: [], rows: [] });
  const [numberCol, setNumberCol] = useState("");
  const [varCol, setVarCol] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [leadMode, setLeadMode] = useState("upload");
  const [leadErr, setLeadErr] = useState("");
  const [replaceLines, setReplaceLines] = useState([]);
  const [replaceName, setReplaceName] = useState("");

  const [template, setTemplate] = useState("");
  const [sim, setSim] = useState(1);

  const [cap, setCap] = useState(80);
  const [distribute, setDistribute] = useState("spread"); // one | spread  (spread = fastest)
  const [deviceSel, setDeviceSel] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [speedMode, setSpeedMode] = useState("turbo"); // turbo | safe
  const [delayMs, setDelayMs] = useState(400);
  const [maxParallel, setMaxParallel] = useState(0); // 0 = all devices at once

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stopRef = useRef(false);

  const connMap = useMemo(() => {
    const m = {};
    conns.forEach((c) => (m[c.id] = { base: normalizeUrl(c.url), key: c.key, label: c.label }));
    return m;
  }, [conns]);

  const loadDevices = useCallback(async () => {
    setLoadingDevs(true);
    setDevErr("");
    try {
      const results = await Promise.allSettled(
        conns.map((c) => fbGet(normalizeUrl(c.url), c.key, "clients"))
      );
      const all = [];
      const errs = [];
      results.forEach((res, i) => {
        const c = conns[i];
        if (res.status === "fulfilled") {
          parseDevices(res.value).forEach((d) =>
            all.push({
              ...d,
              key: c.id + ":" + d.id,
              connId: c.id,
              connLabel: c.label,
              base: normalizeUrl(c.url),
              authKey: c.key,
            })
          );
        } else errs.push(c.label);
      });
      setDevices(all);
      if (errs.length) setDevErr("Load fail: " + errs.join(", "));
    } finally {
      setLoadingDevs(false);
    }
  }, [conns]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // elapsed timer while running
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(t);
  }, [running, startedAt]);

  const onlineDevices = useMemo(() => devices.filter((d) => d.online), [devices]);
  const offlineCount = devices.length - onlineDevices.length;

  const leads = useMemo(() => {
    const rows = leadData.rows || [];
    const mapped = rows
      .map((r) => ({ to: digits(r[numberCol]), v: varCol ? String(r[varCol] ?? "") : "" }))
      .filter((l) => l.to && l.to.replace(/\D/g, "").length >= 6);
    if (replaceLines.length > 0) return mapped.map((l, i) => ({ to: l.to, variable: replaceLines[i] ?? "" }));
    return mapped.map((l) => ({ to: l.to, variable: l.v }));
  }, [leadData, numberCol, varCol, replaceLines]);

  const toggleDevice = (k) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const chosenDevices = useMemo(() => {
    if (deviceSel === "all") return onlineDevices;
    return onlineDevices.filter((d) => selectedIds.has(d.key));
  }, [deviceSel, onlineDevices, selectedIds]);

  const buildMessage = (variable) =>
    template.includes("{{v}}") ? template.replaceAll("{{v}}", variable || "") : template;

  const previewMsg = useMemo(() => buildMessage(leads[0]?.variable ?? "SAMPLE"), [template, leads]); // eslint-disable-line

  const addLog = (type, text) =>
    setLog((l) => [{ type, text, t: new Date().toLocaleTimeString() }, ...l].slice(0, 500));

  const onFile = async (file) => {
    if (!file) return;
    setLeadErr("");
    try {
      const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
      const data = isXlsx ? await parseXlsxFile(file) : await parseCsvFile(file);
      setLeadData(data);
      const numGuess = data.columns.find((c) => /num|phone|mobile|to|contact/i.test(c)) || data.columns[0] || "";
      const varGuess = data.columns.find((c) => /var|name|otp|code|amount|value|line/i.test(c)) || "";
      setNumberCol(numGuess);
      setVarCol(varGuess);
    } catch (e) {
      setLeadErr("File parse nahi hui: " + e.message);
    }
  };
  const applyPaste = () => {
    setLeadErr("");
    const data = parsePasted(pasteText);
    setLeadData(data);
    setNumberCol("number");
    setVarCol(data.rows.some((r) => r.variable) ? "variable" : "");
  };
  const onReplaceFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      let lines = text.split(/\r?\n/);
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      setReplaceLines(lines);
      setReplaceName(file.name);
    } catch (e) {
      setLeadErr("Replace file parse nahi hui: " + e.message);
    }
  };
  const clearReplace = () => {
    setReplaceLines([]);
    setReplaceName("");
  };

  /* ── BLAST ENGINE (parallel across devices) ── */
  const startBlast = async () => {
    setLog([]);
    setSent(0);
    setFailed(0);
    stopRef.current = false;

    if (chosenDevices.length === 0) return addLog("err", "Koi online device nahi hai.");
    if (leads.length === 0) return addLog("err", "Koi valid lead number nahi mila.");
    if (!template.trim()) return addLog("err", "Message body khali hai.");

    const devs = chosenDevices;
    const capN = Math.max(1, Number(cap) || 1);

    // assign leads -> build per-device queues
    const queues = new Map(); // deviceKey -> {device, leads:[]}
    devs.forEach((d) => queues.set(d.key, { device: d, leads: [] }));
    if (distribute === "one") {
      let di = 0, count = 0;
      for (const lead of leads) {
        if (di >= devs.length) break;
        queues.get(devs[di].key).leads.push(lead);
        if (++count >= capN) { di++; count = 0; }
      }
    } else {
      // spread round-robin (fastest: uses all devices evenly)
      const used = {};
      let di = 0, placedTotal = 0;
      const capacity = devs.length * capN;
      for (const lead of leads) {
        if (placedTotal >= capacity) break;
        for (let t = 0; t < devs.length; t++) {
          const d = devs[di % devs.length];
          di++;
          if ((used[d.key] || 0) < capN) {
            used[d.key] = (used[d.key] || 0) + 1;
            queues.get(d.key).leads.push(lead);
            placedTotal++;
            break;
          }
        }
      }
    }

    const groups = [...queues.values()].filter((g) => g.leads.length > 0);
    const totalJobs = groups.reduce((s, g) => s + g.leads.length, 0);
    const skipped = leads.length - totalJobs;
    setTotal(totalJobs);
    setStartedAt(Date.now());
    setElapsed(0);
    setRunning(true);
    addLog(
      "info",
      `Shuru: ${totalJobs} SMS · ${groups.length} device PARALLEL${
        skipped > 0 ? ` · ${skipped} skip (cap)` : ""
      }`
    );

    const safe = speedMode === "safe";
    const dMs = Math.max(0, Number(delayMs) || 0);

    const runDevice = async (g) => {
      for (const lead of g.leads) {
        if (stopRef.current) return;
        const message = buildMessage(lead.variable);
        try {
          await sendSmsCommand(g.device.base, g.device.authKey, g.device.id, {
            sim,
            to: lead.to,
            message,
          });
          if (safe) {
            const ok = await waitForAck(g.device.base, g.device.authKey, g.device.id, {
              timeoutMs: 15000,
              pollMs: 700,
            });
            if (!ok) {
              setFailed((f) => f + 1);
              addLog("err", `⌛ ${g.device.name} → ${lead.to} (timeout)`);
              continue;
            }
          } else if (dMs) {
            await new Promise((r) => setTimeout(r, dMs));
          }
          setSent((s) => s + 1);
          addLog("ok", `✓ ${g.device.name} → ${lead.to}`);
        } catch (e) {
          setFailed((f) => f + 1);
          addLog("err", `✗ ${g.device.name} → ${lead.to} (${e.message})`);
        }
      }
    };

    // concurrency pool over devices (0 = all at once)
    const pool = maxParallel > 0 ? Math.min(maxParallel, groups.length) : groups.length;
    const q = [...groups];
    const workers = Array.from({ length: pool }, async () => {
      while (q.length) {
        if (stopRef.current) return;
        await runDevice(q.shift());
      }
    });
    await Promise.all(workers);

    addLog("info", stopRef.current ? "⏹ Roka gaya." : "✅ Blast complete.");
    setRunning(false);
  };

  const stopBlast = () => (stopRef.current = true);

  const capacity = chosenDevices.length * Math.max(1, Number(cap) || 1);
  const done = sent + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const rate = elapsed > 0 ? (done / (elapsed / 1000)).toFixed(1) : "0";

  return (
    <div className="lb-panel" data-testid="panel">
      <div className="lb-topbar">
        <div className="lb-logo">
          <span className="lb-grad">Lead</span> Blast
        </div>
        <div className="lb-pills">
          <span className="lb-pill lb-pfb" data-testid="stat-fb">
            {conns.length} firebase
          </span>
          <span className="lb-pill lb-pt" data-testid="stat-total">
            {devices.length} devices
          </span>
          <span className="lb-pill lb-pon" data-testid="stat-online">
            {onlineDevices.length} online
          </span>
          <span className="lb-pill lb-poff">{offlineCount} offline</span>
        </div>
        <button className="lb-tbtn" data-testid="refresh-devices" onClick={loadDevices}>
          ↻ Refresh
        </button>
        <button className="lb-tbtn lb-danger" data-testid="disconnect-btn" onClick={onLogoutAll}>
          Logout all
        </button>
      </div>

      <div className="lb-grid">
        {/* DEVICES */}
        <section className="lb-card" data-testid="devices-card">
          <div className="lb-card-h">
            <span>📱 Online Devices</span>
            <span className="lb-count">{onlineDevices.length}</span>
          </div>
          <div className="lb-seg">
            <button
              className={`lb-segbtn ${deviceSel === "all" ? "on" : ""}`}
              data-testid="dev-mode-all"
              onClick={() => setDeviceSel("all")}
            >
              Use all online
            </button>
            <button
              className={`lb-segbtn ${deviceSel === "selected" ? "on" : ""}`}
              data-testid="dev-mode-selected"
              onClick={() => setDeviceSel("selected")}
            >
              Pick devices
            </button>
          </div>
          {loadingDevs ? (
            <div className="lb-muted">Loading devices…</div>
          ) : onlineDevices.length === 0 ? (
            <div className="lb-muted" data-testid="no-online">
              Koi device online nahi hai.
            </div>
          ) : (
            <div className="lb-devlist" data-testid="device-list">
              {onlineDevices.map((d) => {
                const picked = deviceSel === "all" || selectedIds.has(d.key);
                return (
                  <label
                    key={d.key}
                    className={`lb-devrow ${picked ? "picked" : ""}`}
                    data-testid={`device-${d.key}`}
                  >
                    <input
                      type="checkbox"
                      disabled={deviceSel === "all"}
                      checked={picked}
                      onChange={() => toggleDevice(d.key)}
                    />
                    <span className="lb-dot on" />
                    <span className="lb-devname">{d.name}</span>
                    {conns.length > 1 && <span className="lb-conntag">{d.connLabel}</span>}
                    {d.battery != null && <span className="lb-batt">{d.battery}%</span>}
                  </label>
                );
              })}
            </div>
          )}
          {devErr && <div className="lb-err" style={{ marginTop: 10 }}>{devErr}</div>}
          <div className="lb-capacity" data-testid="capacity">
            Capacity: <b>{capacity}</b> SMS ({chosenDevices.length} device × {cap})
          </div>
        </section>

        {/* LEADS */}
        <section className="lb-card" data-testid="leads-card">
          <div className="lb-card-h">
            <span>📥 Leads</span>
            <span className="lb-count" data-testid="lead-count">
              {leads.length}
            </span>
          </div>
          <div className="lb-seg">
            <button
              className={`lb-segbtn ${leadMode === "upload" ? "on" : ""}`}
              data-testid="lead-mode-upload"
              onClick={() => setLeadMode("upload")}
            >
              CSV / Excel
            </button>
            <button
              className={`lb-segbtn ${leadMode === "paste" ? "on" : ""}`}
              data-testid="lead-mode-paste"
              onClick={() => setLeadMode("paste")}
            >
              Paste numbers
            </button>
          </div>
          {leadMode === "upload" ? (
            <label className="lb-upload" data-testid="file-dropzone">
              <input type="file" accept=".csv,.xlsx,.xls" hidden data-testid="file-input" onChange={(e) => onFile(e.target.files?.[0])} />
              <span>⬆ Upload CSV / Excel file</span>
              <small>Ek column number ka, ek optional column badalne wali line ka</small>
            </label>
          ) : (
            <div>
              <textarea
                className="lb-area"
                data-testid="paste-input"
                placeholder={"9876543210\n9123456780,RAHUL"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button className="lb-minibtn" data-testid="apply-paste" onClick={applyPaste}>
                Load pasted leads
              </button>
            </div>
          )}
          {leadData.columns.length > 0 && (
            <div className="lb-maprow" data-testid="column-map">
              <div>
                <label className="lb-fl">Number column</label>
                <select className="lb-select" data-testid="number-col" value={numberCol} onChange={(e) => setNumberCol(e.target.value)}>
                  {leadData.columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lb-fl">Variable line column</label>
                <select className="lb-select" data-testid="var-col" value={varCol} onChange={(e) => setVarCol(e.target.value)}>
                  <option value="">— none —</option>
                  {leadData.columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {leadErr && <div className="lb-err">{leadErr}</div>}
          {leads.length > 0 && (
            <div className="lb-preview" data-testid="lead-preview">
              {leads.slice(0, 4).map((l, i) => (
                <div key={i} className="lb-prow">
                  <span className="lb-mono">{l.to}</span>
                  {l.variable && <span className="lb-var">{l.variable}</span>}
                </div>
              ))}
              {leads.length > 4 && <div className="lb-muted">+{leads.length - 4} more</div>}
            </div>
          )}
        </section>

        {/* MESSAGE */}
        <section className="lb-card" data-testid="message-card">
          <div className="lb-card-h">
            <span>✉️ Message Body</span>
          </div>
          <p className="lb-hint">
            Puri body same jati hai. Jo <b>ek line badalni</b> ho wahan <code>{"{{v}}"}</code> likhein.
          </p>
          <div className="lb-replace" data-testid="replace-box">
            <div className="lb-replace-top">
              <span className="lb-fl" style={{ marginBottom: 0 }}>
                <code>{"{{v}}"}</code> values — line by line (optional)
              </span>
              {replaceLines.length > 0 && (
                <button className="lb-xbtn" data-testid="clear-replace" onClick={clearReplace}>
                  ✕ clear
                </button>
              )}
            </div>
            <label className="lb-replace-upload" data-testid="replace-dropzone">
              <input type="file" accept=".txt,.csv" hidden data-testid="replace-input" onChange={(e) => onReplaceFile(e.target.files?.[0])} />
              <span>⬆ Upload replace file</span>
              <small>Har line ek lead ke liye — line 1 → lead 1…</small>
            </label>
            {replaceLines.length > 0 && (
              <div className={`lb-replace-info ${leads.length && replaceLines.length !== leads.length ? "warn" : ""}`} data-testid="replace-info">
                {replaceName}: <b>{replaceLines.length}</b> lines
                {leads.length > 0 && replaceLines.length !== leads.length && <> ⚠ leads {leads.length} se match nahi</>}
              </div>
            )}
          </div>
          <textarea
            className="lb-area lb-area-lg"
            data-testid="message-input"
            placeholder={"Dear Customer,\nYour code is {{v}}\nThank you."}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div className="lb-sim-row">
            <span className="lb-fl">SIM slot</span>
            <button className={`lb-simbtn ${sim === 1 ? "on" : ""}`} data-testid="sim-1" onClick={() => setSim(1)}>SIM 1</button>
            <button className={`lb-simbtn ${sim === 2 ? "on" : ""}`} data-testid="sim-2" onClick={() => setSim(2)}>SIM 2</button>
          </div>
          {template && (
            <div className="lb-msgprev" data-testid="message-preview">
              <div className="lb-fl">Preview (lead #1)</div>
              <pre>{previewMsg}</pre>
            </div>
          )}
        </section>

        {/* SEND */}
        <section className="lb-card lb-card-run" data-testid="send-card">
          <div className="lb-card-h">
            <span>🚀 Send</span>
            <span className="lb-count">{speedMode === "turbo" ? "⚡ TURBO" : "🛡 SAFE"}</span>
          </div>

          <div className="lb-seg" style={{ maxWidth: 420 }}>
            <button className={`lb-segbtn ${speedMode === "turbo" ? "on" : ""}`} data-testid="mode-turbo" onClick={() => setSpeedMode("turbo")}>
              ⚡ Turbo (fast, no wait)
            </button>
            <button className={`lb-segbtn ${speedMode === "safe" ? "on" : ""}`} data-testid="mode-safe" onClick={() => setSpeedMode("safe")}>
              🛡 Safe (confirm each)
            </button>
          </div>

          <div className="lb-cfg">
            <div>
              <label className="lb-fl">Max SMS / device</label>
              <input type="number" className="lb-input lb-sm" data-testid="cap-input" value={cap} min={1} onChange={(e) => setCap(e.target.value)} />
            </div>
            <div>
              <label className="lb-fl">Spread</label>
              <select className="lb-select" data-testid="distribute-select" value={distribute} onChange={(e) => setDistribute(e.target.value)}>
                <option value="spread">Spread across all devices (fast)</option>
                <option value="one">One device fully, then next</option>
              </select>
            </div>
          </div>
          <div className="lb-cfg">
            <div>
              <label className="lb-fl">Parallel devices (0 = all)</label>
              <input type="number" className="lb-input lb-sm" data-testid="parallel-input" value={maxParallel} min={0} onChange={(e) => setMaxParallel(Number(e.target.value))} />
            </div>
            {speedMode === "turbo" && (
              <div>
                <label className="lb-fl">Delay per SMS (ms)</label>
                <input type="number" className="lb-input lb-sm" data-testid="delay-input" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
              </div>
            )}
          </div>

          {(running || total > 0) && (
            <div className="lb-progress-wrap" data-testid="progress">
              <div className="lb-progress-bar" style={{ width: pct + "%" }} />
              <span className="lb-progress-txt">
                {done}/{total} · {pct}% · {rate}/s · {(elapsed / 1000).toFixed(0)}s
              </span>
            </div>
          )}

          <div className="lb-counters">
            <div className="lb-counter ok">
              <div className="lb-cv" data-testid="sent-count">{sent}</div>
              <div className="lb-cl">Sent</div>
            </div>
            <div className="lb-counter fail">
              <div className="lb-cv" data-testid="failed-count">{failed}</div>
              <div className="lb-cl">Failed</div>
            </div>
            <div className="lb-counter">
              <div className="lb-cv">{leads.length}</div>
              <div className="lb-cl">Leads</div>
            </div>
          </div>

          {!running ? (
            <button className="lb-fire" data-testid="start-blast" onClick={startBlast}>
              💥 Start Blast
            </button>
          ) : (
            <button className="lb-stop" data-testid="stop-blast" onClick={stopBlast}>
              ⏹ Stop
            </button>
          )}

          <div className="lb-log" data-testid="blast-log">
            {log.length === 0 ? (
              <div className="lb-muted">Live log yahan dikhega…</div>
            ) : (
              log.map((e, i) => (
                <div key={i} className={`lb-logline ${e.type}`}>
                  <span className="lb-lt">{e.t}</span> {e.text}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
