// Direct Firebase Realtime Database REST helpers (client-side, same approach as the user's Medline panel).
// No Firebase SDK needed — plain fetch against <DB_URL>/<path>.json?auth=<key>

export function normalizeUrl(url) {
  if (!url) return "";
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

function buildUrl(base, key, path) {
  const auth = key ? `?auth=${encodeURIComponent(key)}` : "";
  return `${base}/${path}.json${auth}`;
}

export async function fbGet(base, key, path) {
  const res = await fetch(buildUrl(base, key, path), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

export async function fbPut(base, key, path, data) {
  const res = await fetch(buildUrl(base, key, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PUT ${path} → HTTP ${res.status}`);
  return res.json();
}

// clients node -> array of device objects
export function parseDevices(clients) {
  if (!clients || typeof clients !== "object") return [];
  return Object.entries(clients).map(([id, d]) => {
    const dev = d && typeof d === "object" ? d : {};
    const statusRaw = dev.status ?? dev.online;
    const online =
      statusRaw === true ||
      String(statusRaw ?? "").toLowerCase() === "online" ||
      String(statusRaw ?? "").toLowerCase() === "on";
    let sims = dev.sims;
    if (sims && typeof sims === "object" && !Array.isArray(sims)) {
      sims = Object.values(sims);
    }
    return {
      id,
      name: dev.name || dev.model || id,
      model: dev.model || "",
      online,
      battery: dev.battery ?? dev.batt ?? null,
      number: dev.mobNo || dev.number || dev.phone || "",
      sims: Array.isArray(sims) ? sims : [],
      raw: dev,
    };
  });
}

// Write an SMS command exactly like the Medline panel:
// clients/<id>/webhookEvent/sendSms = { from, to, message, isSended:false }
export async function sendSmsCommand(base, key, deviceId, { sim, to, message }) {
  const payload = { from: Number(sim) || 1, to, message, isSended: false };
  await fbPut(base, key, `clients/${deviceId}/webhookEvent/sendSms`, payload);
  return payload;
}

// Poll until the device flips isSended=true (ack) or timeout.
export async function waitForAck(base, key, deviceId, { timeoutMs = 25000, pollMs = 1500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const node = await fbGet(base, key, `clients/${deviceId}/webhookEvent/sendSms`);
      if (!node) return true; // node cleared by device = done
      if (node.isSended === true || node.isSended === "true") return true;
    } catch (e) {
      // ignore transient errors, keep polling
    }
  }
  return false; // timed out
}
