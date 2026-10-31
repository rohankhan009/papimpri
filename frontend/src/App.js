import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "@/App.css";
import {
  normalizeUrl,
  fbGet,
  parseDevices,
  sendSmsCommand,
  waitForAck,
} from "@/firebase";
import { parseCsvFile, parseXlsxFile, parsePasted, digits } from "@/leads";

const LS_URL = "lb_fb_url";
const LS_KEY = "lb_fb_key";

function App() {
  const [connected, setConnected] = useState(false);
  const [fbUrl, setFbUrl] = useState("");
  const [fbKey, setFbKey] = useState("");

  useEffect(() => {
    const u = localStorage.getItem(LS_URL);
    const k = localStorage.getItem(LS_KEY);
    if (u) setFbUrl(u);
    if (k) setFbKey(k);
  }, []);

  if (!connected) {
    return (
      <Setup
        fbUrl={fbUrl}
        setFbUrl={setFbUrl}
        fbKey={fbKey}
        setFbKey={setFbKey}
        onConnected={(u, k) => {
          localStorage.setItem(LS_URL, u);
          localStorage.setItem(LS_KEY, k || "");
          setFbUrl(u);
          setFbKey(k);
          setConnected(true);
        }}
      />
    );
  }
  return <Panel base={fbUrl} fbKey={fbKey} onDisconnect={() => setConnected(false)} />;
}

/* ───────────────────────── SETUP ───────────────────────── */
function Setup({ fbUrl, setFbUrl, fbKey, setFbKey, onConnected }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const connect = async () => {
    setErr("");
    const base = normalizeUrl(fbUrl);
    if (!base) {
      setErr("Firebase Database URL daalein");
      return;
    }
    setBusy(true);
    try {
      await fbGet(base, fbKey, "clients"); // validates URL + key
      onConnected(base, fbKey);
    } catch (e) {
      setErr("Connect nahi hua — URL / key check karein (" + e.message + ")");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lb-setup" data-testid="setup-screen">
      <div className="lb-orb lb-o1" />
      <div className="lb-orb lb-o2" />
      <div className="lb-setup-card">
        <div className="lb-eyebrow">Lead Blast Panel</div>
        <h1 className="lb-h1">
          <span className="lb-grad">SMS</span> Lead Blaster
        </h1>
        <p className="lb-sub">
          Apne Firebase se jude devices ke through leads ko line-by-line SMS bhejein.
        </p>
        <label className="lb-fl">Firebase Database URL</label>
        <input
          className="lb-input"
          data-testid="fb-url-input"
          placeholder="https://project-default-rtdb.firebaseio.com"
          value={fbUrl}
          onChange={(e) => setFbUrl(e.target.value)}
        />
        <label className="lb-fl">Auth Secret / Key (optional)</label>
        <input
          className="lb-input"
          data-testid="fb-key-input"
          placeholder="Database secret (agar rules ke liye chahiye)"
          value={fbKey}
          onChange={(e) => setFbKey(e.target.value)}
          type="password"
        />
        <button className="lb-cta" data-testid="connect-btn" onClick={connect} disabled={busy}>
          {busy ? "Connecting…" : "⚡ Connect to Firebase"}
        </button>
        {err && (
          <div className="lb-err" data-testid="connect-error">
            {err}
          </div>
        )}
        <div className="lb-foot">Direct Firebase RTDB · clients / webhookEvent/sendSms</div>
      </div>
    </div>
  );
}

/* ───────────────────────── PANEL ───────────────────────── */
function Panel({ base, fbKey, onDisconnect }) {
  const [devices, setDevices] = useState([]);
  const [loadingDevs, setLoadingDevs] = useState(true);
  const [devErr, setDevErr] = useState("");

  // leads
  const [leadData, setLeadData] = useState({ columns: [], rows: [] });
  const [numberCol, setNumberCol] = useState("");
  const [varCol, setVarCol] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [leadMode, setLeadMode] = useState("upload"); // upload | paste
  const [leadErr, setLeadErr] = useState("");

  // message
  const [template, setTemplate] = useState("");
  const [sim, setSim] = useState(1);

  // send config
  const [cap, setCap] = useState(80);
  const [distribute, setDistribute] = useState("one"); // one | spread
  const [deviceSel, setDeviceSel] = useState("all"); // all | selected
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [waitAck, setWaitAck] = useState(true);
  const [delayMs, setDelayMs] = useState(1500);

  // run state
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const stopRef = useRef(false);

  const loadDevices = useCallback(async () => {
    setLoadingDevs(true);
    setDevErr("");
    try {
      const clients = await fbGet(base, fbKey, "clients");
      setDevices(parseDevices(clients));
    } catch (e) {
      setDevErr(e.message);
    } finally {
      setLoadingDevs(false);
    }
  }, [base, fbKey]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const onlineDevices = useMemo(() => devices.filter((d) => d.online), [devices]);
  const offlineCount = devices.length - onlineDevices.length;

  const leads = useMemo(() => {
    const rows = leadData.rows || [];
    return rows
      .map((r) => ({
        to: digits(r[numberCol]),
        variable: varCol ? String(r[varCol] ?? "") : "",
      }))
      .filter((l) => l.to && l.to.replace(/\D/g, "").length >= 6);
  }, [leadData, numberCol, varCol]);

  const toggleDevice = (id) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const chosenDevices = useMemo(() => {
    if (deviceSel === "all") return onlineDevices;
    return onlineDevices.filter((d) => selectedIds.has(d.id));
  }, [deviceSel, onlineDevices, selectedIds]);

  const buildMessage = (variable) => {
    if (template.includes("{{v}}")) return template.replaceAll("{{v}}", variable || "");
    return template;
  };

  const previewMsg = useMemo(() => {
    const sample = leads[0]?.variable ?? "SAMPLE";
    return buildMessage(sample);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, leads]);

  const addLog = (type, text) =>
    setLog((l) => [{ type, text, t: new Date().toLocaleTimeString() }, ...l].slice(0, 400));

  /* ── FILE UPLOAD ── */
  const onFile = async (file) => {
    if (!file) return;
    setLeadErr("");
    try {
      const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
      const data = isXlsx ? await parseXlsxFile(file) : await parseCsvFile(file);
      setLeadData(data);
      const numGuess =
        data.columns.find((c) => /num|phone|mobile|to|contact/i.test(c)) || data.columns[0] || "";
      const varGuess =
        data.columns.find((c) => /var|name|otp|code|amount|value|line/i.test(c)) || "";
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

  /* ── BLAST ENGINE ── */
  const startBlast = async () => {
    setLog([]);
    setSent(0);
    setFailed(0);
    stopRef.current = false;

    if (chosenDevices.length === 0) {
      addLog("err", "Koi online device select nahi hai.");
      return;
    }
    if (leads.length === 0) {
      addLog("err", "Koi valid lead number nahi mila.");
      return;
    }
    if (!template.trim()) {
      addLog("err", "Message body khali hai.");
      return;
    }

    setRunning(true);
    const devs = chosenDevices;
    const capN = Math.max(1, Number(cap) || 1);

    // Build an ordered list of {device, lead}
    const jobs = [];
    if (distribute === "one") {
      // fill one device up to cap, then move to next device
      let di = 0;
      let count = 0;
      for (const lead of leads) {
        if (di >= devs.length) break; // devices * cap exhausted
        jobs.push({ device: devs[di], lead });
        count++;
        if (count >= capN) {
          di++;
          count = 0;
        }
      }
    } else {
      // spread: round-robin across devices, respect per-device cap
      const perDev = {};
      let di = 0;
      for (const lead of leads) {
        let placed = false;
        for (let tries = 0; tries < devs.length; tries++) {
          const d = devs[di % devs.length];
          di++;
          if ((perDev[d.id] || 0) < capN) {
            perDev[d.id] = (perDev[d.id] || 0) + 1;
            jobs.push({ device: d, lead });
            placed = true;
            break;
          }
        }
        if (!placed) break;
      }
    }

    const skipped = leads.length - jobs.length;
    addLog(
      "info",
      `Shuru: ${jobs.length} SMS, ${devs.length} online device(s), cap ${capN}/device${
        skipped > 0 ? `, ${skipped} lead cap ke bahar skip` : ""
      }`
    );

    for (let i = 0; i < jobs.length; i++) {
      if (stopRef.current) {
        addLog("info", "⏹ Roka gaya.");
        break;
      }
      const { device, lead } = jobs[i];
      const message = buildMessage(lead.variable);
      try {
        await sendSmsCommand(base, fbKey, device.id, { sim, to: lead.to, message });
        if (waitAck) {
          const ok = await waitForAck(base, fbKey, device.id, { timeoutMs: 25000, pollMs: 1500 });
          if (!ok) {
            setFailed((f) => f + 1);
            addLog("err", `⌛ ${device.name} → ${lead.to} (ack timeout)`);
            continue;
          }
        } else {
          await new Promise((r) => setTimeout(r, Math.max(300, Number(delayMs) || 0)));
        }
        setSent((s) => s + 1);
        addLog("ok", `✓ ${device.name} → ${lead.to}`);
      } catch (e) {
        setFailed((f) => f + 1);
        addLog("err", `✗ ${device.name} → ${lead.to} (${e.message})`);
      }
    }
    addLog("info", "✅ Blast complete.");
    setRunning(false);
  };

  const stopBlast = () => {
    stopRef.current = true;
  };

  const capacity = chosenDevices.length * (Math.max(1, Number(cap) || 1));

  return (
    <div className="lb-panel" data-testid="panel">
      {/* top bar */}
      <div className="lb-topbar">
        <div className="lb-logo">
          <span className="lb-grad">Lead</span> Blast
        </div>
        <div className="lb-pills">
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
        <button className="lb-tbtn lb-danger" data-testid="disconnect-btn" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="lb-grid">
        {/* ── DEVICES ── */}
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
          ) : devErr ? (
            <div className="lb-err">{devErr}</div>
          ) : onlineDevices.length === 0 ? (
            <div className="lb-muted" data-testid="no-online">
              Koi device online nahi hai.
            </div>
          ) : (
            <div className="lb-devlist" data-testid="device-list">
              {onlineDevices.map((d) => {
                const picked = deviceSel === "all" || selectedIds.has(d.id);
                return (
                  <label
                    key={d.id}
                    className={`lb-devrow ${picked ? "picked" : ""}`}
                    data-testid={`device-${d.id}`}
                  >
                    <input
                      type="checkbox"
                      disabled={deviceSel === "all"}
                      checked={picked}
                      onChange={() => toggleDevice(d.id)}
                      data-testid={`device-check-${d.id}`}
                    />
                    <span className="lb-dot on" />
                    <span className="lb-devname">{d.name}</span>
                    {d.battery != null && <span className="lb-batt">{d.battery}%</span>}
                  </label>
                );
              })}
            </div>
          )}
          <div className="lb-capacity" data-testid="capacity">
            Capacity: <b>{capacity}</b> SMS ({chosenDevices.length} device × {cap})
          </div>
        </section>

        {/* ── LEADS ── */}
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
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                hidden
                data-testid="file-input"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <span>⬆ Upload CSV / Excel file</span>
              <small>Ek column number ka, ek optional column badalne wali line ka</small>
            </label>
          ) : (
            <div>
              <textarea
                className="lb-area"
                data-testid="paste-input"
                placeholder={"9876543210\n9123456780,RAHUL\n(one lead per line, optional comma value)"}
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
                <select
                  className="lb-select"
                  data-testid="number-col"
                  value={numberCol}
                  onChange={(e) => setNumberCol(e.target.value)}
                >
                  {leadData.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lb-fl">Variable line column</label>
                <select
                  className="lb-select"
                  data-testid="var-col"
                  value={varCol}
                  onChange={(e) => setVarCol(e.target.value)}
                >
                  <option value="">— none (same msg) —</option>
                  {leadData.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
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

        {/* ── MESSAGE ── */}
        <section className="lb-card" data-testid="message-card">
          <div className="lb-card-h">
            <span>✉️ Message Body</span>
          </div>
          <p className="lb-hint">
            Puri body sabko same jati hai. Jo <b>ek line har lead me badalni</b> ho, wahan{" "}
            <code>{"{{v}}"}</code> likhein — har lead ki variable value wahan lag jayegi.
          </p>
          <textarea
            className="lb-area lb-area-lg"
            data-testid="message-input"
            placeholder={"Dear Customer,\nYour code is {{v}}\nThank you."}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div className="lb-sim-row">
            <span className="lb-fl">SIM slot</span>
            <button
              className={`lb-simbtn ${sim === 1 ? "on" : ""}`}
              data-testid="sim-1"
              onClick={() => setSim(1)}
            >
              SIM 1
            </button>
            <button
              className={`lb-simbtn ${sim === 2 ? "on" : ""}`}
              data-testid="sim-2"
              onClick={() => setSim(2)}
            >
              SIM 2
            </button>
          </div>
          {template && (
            <div className="lb-msgprev" data-testid="message-preview">
              <div className="lb-fl">Preview (lead #1)</div>
              <pre>{previewMsg}</pre>
            </div>
          )}
        </section>

        {/* ── SEND CONFIG + RUN ── */}
        <section className="lb-card lb-card-run" data-testid="send-card">
          <div className="lb-card-h">
            <span>🚀 Send</span>
          </div>
          <div className="lb-cfg">
            <div>
              <label className="lb-fl">Max SMS per device</label>
              <input
                type="number"
                className="lb-input lb-sm"
                data-testid="cap-input"
                value={cap}
                min={1}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
            <div>
              <label className="lb-fl">Spread</label>
              <select
                className="lb-select"
                data-testid="distribute-select"
                value={distribute}
                onChange={(e) => setDistribute(e.target.value)}
              >
                <option value="one">One device fully, then next</option>
                <option value="spread">Spread across devices</option>
              </select>
            </div>
          </div>
          <div className="lb-cfg">
            <label className="lb-check">
              <input
                type="checkbox"
                data-testid="wait-ack"
                checked={waitAck}
                onChange={(e) => setWaitAck(e.target.checked)}
              />
              Wait for device confirm (isSended) before next
            </label>
          </div>
          {!waitAck && (
            <div>
              <label className="lb-fl">Delay between SMS (ms)</label>
              <input
                type="number"
                className="lb-input lb-sm"
                data-testid="delay-input"
                value={delayMs}
                onChange={(e) => setDelayMs(e.target.value)}
              />
            </div>
          )}

          <div className="lb-counters">
            <div className="lb-counter ok">
              <div className="lb-cv" data-testid="sent-count">
                {sent}
              </div>
              <div className="lb-cl">Sent</div>
            </div>
            <div className="lb-counter fail">
              <div className="lb-cv" data-testid="failed-count">
                {failed}
              </div>
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
