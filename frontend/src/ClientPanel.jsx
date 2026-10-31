import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import api, { savedUser } from "@/api";
import { parseCsvFile, parseXlsxFile, parsePasted, digits } from "@/leads";

export default function ClientPanel({ onLogout }) {
  const [firebases, setFirebases] = useState([]);
  const [devicesData, setDevicesData] = useState({ devices: [], errors: [] });
  const [loadingDevs, setLoadingDevs] = useState(true);

  // add firebase
  const [fbLabel, setFbLabel] = useState("");
  const [fbUrl, setFbUrl] = useState("");
  const [fbKey, setFbKey] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbErr, setFbErr] = useState("");

  // leads
  const [leadData, setLeadData] = useState({ columns: [], rows: [] });
  const [numberCol, setNumberCol] = useState("");
  const [varCol, setVarCol] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [leadMode, setLeadMode] = useState("upload");
  const [leadErr, setLeadErr] = useState("");
  const [replaceLines, setReplaceLines] = useState([]);
  const [replaceName, setReplaceName] = useState("");

  // message + config
  const [template, setTemplate] = useState("");
  const [sim, setSim] = useState(1);
  const [cap, setCap] = useState(80);
  const [distribute, setDistribute] = useState("spread");
  const [speed, setSpeed] = useState("turbo");
  const [delayMs, setDelayMs] = useState(400);
  const [maxParallel, setMaxParallel] = useState(0);
  const [autoLogout, setAutoLogout] = useState(true);
  const [deviceSel, setDeviceSel] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // task
  const [task, setTask] = useState(null);
  const [startErr, setStartErr] = useState("");
  const prevStatus = useRef(null);

  const loadFirebases = useCallback(async () => {
    try {
      const { data } = await api.get("/firebases");
      setFirebases(data);
    } catch {}
  }, []);
  const loadDevices = useCallback(async () => {
    setLoadingDevs(true);
    try {
      const { data } = await api.get("/devices");
      setDevicesData(data);
    } catch {
      setDevicesData({ devices: [], errors: [] });
    }
    setLoadingDevs(false);
  }, []);
  const loadTask = useCallback(async () => {
    try {
      const { data } = await api.get("/tasks/current");
      setTask(data.task);
    } catch {}
  }, []);

  useEffect(() => {
    loadFirebases();
    loadDevices();
    loadTask();
  }, [loadFirebases, loadDevices, loadTask]);

  // poll while running
  useEffect(() => {
    if (task?.status !== "running") {
      if (prevStatus.current === "running") {
        // just finished -> refresh firebases/devices (autoLogout may have cleared them)
        loadFirebases();
        loadDevices();
      }
      prevStatus.current = task?.status;
      return;
    }
    prevStatus.current = "running";
    const iv = setInterval(loadTask, 1500);
    return () => clearInterval(iv);
  }, [task?.status, loadTask, loadFirebases, loadDevices]);

  const onlineDevices = useMemo(() => devicesData.devices.filter((d) => d.online), [devicesData]);
  const offlineCount = devicesData.devices.length - onlineDevices.length;

  const leads = useMemo(() => {
    const rows = leadData.rows || [];
    const mapped = rows
      .map((r) => ({ to: digits(r[numberCol]), v: varCol ? String(r[varCol] ?? "") : "" }))
      .filter((l) => l.to && l.to.replace(/\D/g, "").length >= 6);
    if (replaceLines.length > 0) return mapped.map((l, i) => ({ to: l.to, variable: replaceLines[i] ?? "" }));
    return mapped.map((l) => ({ to: l.to, variable: l.v }));
  }, [leadData, numberCol, varCol, replaceLines]);

  const buildMessage = (v) => (template.includes("{{v}}") ? template.replaceAll("{{v}}", v || "") : template);
  const previewMsg = useMemo(() => buildMessage(leads[0]?.variable ?? "SAMPLE"), [template, leads]); // eslint-disable-line

  const toggleDevice = (k) =>
    setSelectedIds((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const chosenDevices = useMemo(
    () => (deviceSel === "all" ? onlineDevices : onlineDevices.filter((d) => selectedIds.has(d.key))),
    [deviceSel, onlineDevices, selectedIds]
  );

  /* firebase ops */
  const addFirebase = async () => {
    setFbErr("");
    if (!fbUrl.trim()) return setFbErr("Firebase URL daalein");
    setFbBusy(true);
    try {
      await api.post("/firebases", { label: fbLabel || `Firebase ${firebases.length + 1}`, url: fbUrl, key: fbKey });
      setFbLabel(""); setFbUrl(""); setFbKey("");
      await loadFirebases();
      await loadDevices();
    } catch (e) {
      setFbErr(e.response?.data?.detail || "Add fail");
    } finally {
      setFbBusy(false);
    }
  };
  const removeFirebase = async (id) => {
    await api.delete(`/firebases/${id}`);
    await loadFirebases();
    await loadDevices();
  };
  const removeAllFirebases = async () => {
    if (!window.confirm("Sabhi Firebase connections remove kar dein?")) return;
    await api.delete("/firebases");
    await loadFirebases();
    await loadDevices();
  };

  /* leads ops */
  const onFile = async (file) => {
    if (!file) return;
    setLeadErr("");
    try {
      const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
      const data = isXlsx ? await parseXlsxFile(file) : await parseCsvFile(file);
      setLeadData(data);
      setNumberCol(data.columns.find((c) => /num|phone|mobile|to|contact/i.test(c)) || data.columns[0] || "");
      setVarCol(data.columns.find((c) => /var|name|otp|code|amount|value|line/i.test(c)) || "");
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
    const text = await file.text();
    let lines = text.split(/\r?\n/);
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    setReplaceLines(lines);
    setReplaceName(file.name);
  };

  /* task ops */
  const startBlast = async () => {
    setStartErr("");
    try {
      const { data } = await api.post("/tasks", {
        leads,
        template,
        sim,
        cap: Number(cap) || 1,
        distribute,
        speed,
        delayMs: Number(delayMs) || 0,
        maxParallel: Number(maxParallel) || 0,
        autoLogout,
        deviceKeys: deviceSel === "selected" ? [...selectedIds] : null,
      });
      setTask({ id: data.task_id, status: "running", total: data.total, sent: 0, failed: 0, done: 0, devices: data.devices, log: [] });
    } catch (e) {
      setStartErr(e.response?.data?.detail || "Start fail");
    }
  };
  const stopBlast = async () => {
    if (task?.id) await api.post(`/tasks/${task.id}/stop`);
    loadTask();
  };

  const running = task?.status === "running";
  const capacity = chosenDevices.length * (Number(cap) || 1);
  const total = task?.total || 0;
  const done = (task?.sent || 0) + (task?.failed || 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="lb-panel" data-testid="client-panel">
      <div className="lb-topbar">
        <div className="lb-logo"><span className="lb-grad">Lead</span> Blast</div>
        <div className="lb-pills">
          <span className="lb-pill lb-pfb" data-testid="who">{savedUser()}</span>
          <span className="lb-pill lb-pt">{firebases.length} firebase</span>
          <span className="lb-pill lb-pon" data-testid="stat-online">{onlineDevices.length} online</span>
          <span className="lb-pill lb-poff">{offlineCount} offline</span>
          {running && <span className="lb-pill lb-prun" data-testid="running-pill">🟢 task {pct}%</span>}
        </div>
        <button className="lb-tbtn" data-testid="refresh-devices" onClick={() => { loadFirebases(); loadDevices(); }}>↻ Refresh</button>
        <button className="lb-tbtn lb-danger" data-testid="logout-btn" onClick={onLogout}>Logout</button>
      </div>

      <div className="lb-grid">
        {/* FIREBASES + DEVICES */}
        <section className="lb-card" data-testid="firebase-card">
          <div className="lb-card-h">
            <span>🔥 Firebases & Devices</span>
            {firebases.length > 0 && (
              <button className="lb-xbtn" data-testid="remove-all-fb" onClick={removeAllFirebases}>Remove all</button>
            )}
          </div>
          <div className="lb-fbadd">
            <input className="lb-input lb-sm" data-testid="fb-label" placeholder="Label" value={fbLabel} onChange={(e) => setFbLabel(e.target.value)} />
            <input className="lb-input lb-sm" data-testid="fb-url" placeholder="https://xxx-rtdb.firebaseio.com" value={fbUrl} onChange={(e) => setFbUrl(e.target.value)} />
            <input className="lb-input lb-sm" data-testid="fb-key" placeholder="Auth key (optional)" type="password" value={fbKey} onChange={(e) => setFbKey(e.target.value)} />
            <button className="lb-minibtn" style={{ margin: 0 }} data-testid="add-fb-btn" onClick={addFirebase} disabled={fbBusy}>{fbBusy ? "…" : "+ Add"}</button>
          </div>
          {fbErr && <div className="lb-err">{fbErr}</div>}
          {firebases.length > 0 && (
            <div className="lb-fblist" data-testid="fb-list">
              {firebases.map((f) => (
                <div key={f.id} className="lb-fbrow" data-testid={`fb-${f.id}`}>
                  <span className="lb-conntag">{f.label}</span>
                  <span className="lb-mono lb-fburl">{f.url.replace(/^https?:\/\//, "")}</span>
                  <button className="lb-xbtn" data-testid={`fb-remove-${f.id}`} onClick={() => removeFirebase(f.id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="lb-seg" style={{ marginTop: 14 }}>
            <button className={`lb-segbtn ${deviceSel === "all" ? "on" : ""}`} data-testid="dev-mode-all" onClick={() => setDeviceSel("all")}>Use all online</button>
            <button className={`lb-segbtn ${deviceSel === "selected" ? "on" : ""}`} data-testid="dev-mode-selected" onClick={() => setDeviceSel("selected")}>Pick devices</button>
          </div>
          {loadingDevs ? (
            <div className="lb-muted">Loading devices…</div>
          ) : onlineDevices.length === 0 ? (
            <div className="lb-muted" data-testid="no-online">Koi device online nahi.</div>
          ) : (
            <div className="lb-devlist" data-testid="device-list">
              {onlineDevices.map((d) => {
                const picked = deviceSel === "all" || selectedIds.has(d.key);
                return (
                  <label key={d.key} className={`lb-devrow ${picked ? "picked" : ""}`} data-testid={`device-${d.key}`}>
                    <input type="checkbox" disabled={deviceSel === "all"} checked={picked} onChange={() => toggleDevice(d.key)} />
                    <span className="lb-dot on" />
                    <span className="lb-devname">{d.name}</span>
                    {firebases.length > 1 && <span className="lb-conntag">{d.connLabel}</span>}
                    {d.battery != null && <span className="lb-batt">{d.battery}%</span>}
                  </label>
                );
              })}
            </div>
          )}
          <div className="lb-capacity">Capacity: <b>{capacity}</b> SMS ({chosenDevices.length} × {cap})</div>
        </section>

        {/* LEADS */}
        <section className="lb-card" data-testid="leads-card">
          <div className="lb-card-h"><span>📥 Leads</span><span className="lb-count" data-testid="lead-count">{leads.length}</span></div>
          <div className="lb-seg">
            <button className={`lb-segbtn ${leadMode === "upload" ? "on" : ""}`} data-testid="lead-mode-upload" onClick={() => setLeadMode("upload")}>CSV / Excel</button>
            <button className={`lb-segbtn ${leadMode === "paste" ? "on" : ""}`} data-testid="lead-mode-paste" onClick={() => setLeadMode("paste")}>Paste numbers</button>
          </div>
          {leadMode === "upload" ? (
            <label className="lb-upload" data-testid="file-dropzone">
              <input type="file" accept=".csv,.xlsx,.xls" hidden data-testid="file-input" onChange={(e) => onFile(e.target.files?.[0])} />
              <span>⬆ Upload CSV / Excel</span>
              <small>Ek column number ka, ek optional column variable ka</small>
            </label>
          ) : (
            <div>
              <textarea className="lb-area" data-testid="paste-input" placeholder={"9876543210\n9123456780,RAHUL"} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
              <button className="lb-minibtn" data-testid="apply-paste" onClick={applyPaste}>Load pasted leads</button>
            </div>
          )}
          {leadData.columns.length > 0 && (
            <div className="lb-maprow">
              <div>
                <label className="lb-fl">Number column</label>
                <select className="lb-select" data-testid="number-col" value={numberCol} onChange={(e) => setNumberCol(e.target.value)}>
                  {leadData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="lb-fl">Variable column</label>
                <select className="lb-select" data-testid="var-col" value={varCol} onChange={(e) => setVarCol(e.target.value)}>
                  <option value="">— none —</option>
                  {leadData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          {leadErr && <div className="lb-err">{leadErr}</div>}
          {leads.length > 0 && (
            <div className="lb-preview" data-testid="lead-preview">
              {leads.slice(0, 4).map((l, i) => (
                <div key={i} className="lb-prow"><span className="lb-mono">{l.to}</span>{l.variable && <span className="lb-var">{l.variable}</span>}</div>
              ))}
              {leads.length > 4 && <div className="lb-muted">+{leads.length - 4} more</div>}
            </div>
          )}
        </section>

        {/* MESSAGE */}
        <section className="lb-card" data-testid="message-card">
          <div className="lb-card-h"><span>✉️ Message Body</span></div>
          <p className="lb-hint">Jo <b>ek line badalni</b> ho wahan <code>{"{{v}}"}</code> likhein.</p>
          <div className="lb-replace">
            <div className="lb-replace-top">
              <span className="lb-fl" style={{ marginBottom: 0 }}><code>{"{{v}}"}</code> values — line by line (optional)</span>
              {replaceLines.length > 0 && <button className="lb-xbtn" data-testid="clear-replace" onClick={() => { setReplaceLines([]); setReplaceName(""); }}>✕ clear</button>}
            </div>
            <label className="lb-replace-upload" data-testid="replace-dropzone">
              <input type="file" accept=".txt,.csv" hidden data-testid="replace-input" onChange={(e) => onReplaceFile(e.target.files?.[0])} />
              <span>⬆ Upload replace file</span>
              <small>Har line ek lead ke liye — line 1 → lead 1…</small>
            </label>
            {replaceLines.length > 0 && (
              <div className={`lb-replace-info ${leads.length && replaceLines.length !== leads.length ? "warn" : ""}`} data-testid="replace-info">
                {replaceName}: <b>{replaceLines.length}</b> lines{leads.length > 0 && replaceLines.length !== leads.length && <> ⚠ leads {leads.length} se match nahi</>}
              </div>
            )}
          </div>
          <textarea className="lb-area lb-area-lg" data-testid="message-input" placeholder={"Dear Customer,\nYour code is {{v}}\nThank you."} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <div className="lb-sim-row">
            <span className="lb-fl">SIM slot</span>
            <button className={`lb-simbtn ${sim === 1 ? "on" : ""}`} data-testid="sim-1" onClick={() => setSim(1)}>SIM 1</button>
            <button className={`lb-simbtn ${sim === 2 ? "on" : ""}`} data-testid="sim-2" onClick={() => setSim(2)}>SIM 2</button>
          </div>
          {template && <div className="lb-msgprev" data-testid="message-preview"><div className="lb-fl">Preview (lead #1)</div><pre>{previewMsg}</pre></div>}
        </section>

        {/* SEND */}
        <section className="lb-card lb-card-run" data-testid="send-card">
          <div className="lb-card-h"><span>🚀 Send (background)</span><span className="lb-count">{speed === "turbo" ? "⚡ TURBO" : "🛡 SAFE"}</span></div>

          <div className="lb-seg" style={{ maxWidth: 420 }}>
            <button className={`lb-segbtn ${speed === "turbo" ? "on" : ""}`} data-testid="mode-turbo" onClick={() => setSpeed("turbo")}>⚡ Turbo (fast)</button>
            <button className={`lb-segbtn ${speed === "safe" ? "on" : ""}`} data-testid="mode-safe" onClick={() => setSpeed("safe")}>🛡 Safe (confirm)</button>
          </div>
          <div className="lb-cfg">
            <div><label className="lb-fl">Max SMS / device</label><input type="number" className="lb-input lb-sm" data-testid="cap-input" value={cap} min={1} onChange={(e) => setCap(e.target.value)} /></div>
            <div><label className="lb-fl">Spread</label>
              <select className="lb-select" data-testid="distribute-select" value={distribute} onChange={(e) => setDistribute(e.target.value)}>
                <option value="spread">Spread across all devices (fast)</option>
                <option value="one">One device fully, then next</option>
              </select>
            </div>
          </div>
          <div className="lb-cfg">
            <div><label className="lb-fl">Parallel devices (0 = all)</label><input type="number" className="lb-input lb-sm" data-testid="parallel-input" value={maxParallel} min={0} onChange={(e) => setMaxParallel(e.target.value)} /></div>
            {speed === "turbo" && <div><label className="lb-fl">Delay / SMS (ms)</label><input type="number" className="lb-input lb-sm" data-testid="delay-input" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} /></div>}
          </div>
          <label className="lb-check" style={{ marginBottom: 14 }}>
            <input type="checkbox" data-testid="autologout-check" checked={autoLogout} onChange={(e) => setAutoLogout(e.target.checked)} />
            Task complete hote hi sab Firebase auto-logout (remove)
          </label>

          {(running || total > 0) && (
            <div className="lb-progress-wrap" data-testid="progress">
              <div className="lb-progress-bar" style={{ width: pct + "%" }} />
              <span className="lb-progress-txt">{task?.status} · {done}/{total} · {pct}%</span>
            </div>
          )}
          <div className="lb-counters">
            <div className="lb-counter ok"><div className="lb-cv" data-testid="sent-count">{task?.sent || 0}</div><div className="lb-cl">Sent</div></div>
            <div className="lb-counter fail"><div className="lb-cv" data-testid="failed-count">{task?.failed || 0}</div><div className="lb-cl">Failed</div></div>
            <div className="lb-counter"><div className="lb-cv">{leads.length}</div><div className="lb-cl">Leads</div></div>
          </div>

          {!running ? (
            <button className="lb-fire" data-testid="start-blast" onClick={startBlast}>💥 Start Blast</button>
          ) : (
            <button className="lb-stop" data-testid="stop-blast" onClick={stopBlast}>⏹ Stop</button>
          )}
          {startErr && <div className="lb-err">{startErr}</div>}
          {running && <p className="lb-hint" style={{ marginTop: 10 }}>Task server par chal raha hai — aap logout karke wapas aa sakte ho, progress chalta rahega.</p>}

          <div className="lb-log" data-testid="blast-log">
            {!task?.log || task.log.length === 0 ? (
              <div className="lb-muted">Live log yahan dikhega…</div>
            ) : (
              task.log.map((e, i) => (
                <div key={i} className={`lb-logline ${e.type}`}><span className="lb-lt">{String(e.t).slice(11, 19)}</span> {e.text}</div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
