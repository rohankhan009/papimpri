# SMS Lead Blaster — PRD

## Problem
User has ~40 Android phones connected to their own Firebase Realtime Database (Medline panel).
They wanted a NEW panel to blast SMS to a list of leads (phone numbers) line-by-line,
each lead getting the same message body with ONE line varying per lead. CSV/Excel upload,
online-device filter, and "one device sends 80 SMS" (configurable cap).

## Decoded Firebase protocol (from user's obfuscated medline_panel_v2.html)
- DB access: Firebase RTDB REST — `<DB_URL>/<path>.json?auth=<key>` (client-side fetch, no SDK).
- Devices: `clients/{deviceId}` → fields: status ("online"/"offline"), name, model, battery, mobNo, sims.
- Messages: `messages/{deviceId}`.
- SEND SMS: PUT `clients/{deviceId}/webhookEvent/sendSms` = `{ from: <sim 1|2>, to, message, isSended:false }`.
  The phone watches this node, sends the SMS, and flips `isSended` to true (ack).

## Architecture
- Frontend-only React app (no backend / no Mongo). Talks directly to the user's Firebase like their panel.
- `src/firebase.js` — REST helpers: fbGet/fbPut, parseDevices (online filter), sendSmsCommand, waitForAck.
- `src/leads.js` — CSV (papaparse) + Excel (xlsx/SheetJS) + pasted-text parsing, number cleaning.
- `src/App.js` — Setup (DB URL + optional key, saved to localStorage) → Panel.
- Panel: online device list/select, lead upload/paste + column mapping, message template with `{{v}}`
  placeholder (the one changing line), SIM 1/2, per-device cap (default 80), spread mode
  (one-device-then-next [default] | spread-across-devices), wait-for-ack vs fixed delay, live log + counters.

## Implemented (2026-06)
- Full connect → load clients → online filter → CSV/XLSX/paste leads → per-lead message → line-by-line blast.
- Default: one device sends up to 80, waiting for each `isSended` before the next.
- Verified via Node test against mock Firebase: exact path + payload, online filter, ack polling, lead parsing. PASS.
- Cyber aesthetic matching user's Medline panel (cyan/dark, Exo 2 + Share Tech Mono).

## To validate with real devices
- Confirm the Android app flips `isSended=true` (if it deletes/doesn't set it, uncheck "Wait for confirm" and use fixed delay).

## Backlog / P1
- Save/resume campaigns, retry failed, export send report CSV.
- Live device online status auto-refresh (polling).
- Rotate SIM per send; random-OTP generator (like panel's Nuke mode).

## Update (2026-06) — {{v}} replace-file upload
- Message Body me ek "Upload replace file" button add hua (.txt/.csv).
- File ki har line = us position ke lead ka {{v}} value (line 1 → lead 1, line 2 → lead 2…).
- Number leads upload/paste se aate hain; replace lines positional map hoti hain (invalid numbers filter hone ke baad bhi order sahi).
- Mismatch count par warning. Auto-reconnect (localStorage) add hua; Disconnect clears it.
- Verified via Node test: positional mapping PASS.

## Update (2026-06) — Speed + Multi-Firebase
- MULTI-FIREBASE: Setup me ab kai Firebase add ho sakte hain (label+URL+key each). Sab projects ke devices merge hokar ek list me. localStorage key: lb_fb_conns (legacy single migrated).
- Device object carries {connId, connLabel, base, authKey, key:connId+id} so sends route to the correct project.
- PARALLEL BLAST: har device ek saath (concurrently) apni queue line-by-line bhejta hai. Pool size = "Parallel devices" (0=all). Node test: 3 devices = 3x faster, routing correct, payload {from,to,message,isSended:false} intact.
- Speed modes: Turbo (no ack, delay default 400ms) [default] vs Safe (wait isSended, poll 700ms/timeout 15s).
- Spread mode default (round-robin across all devices) for max speed; "one device fully" still available.
- Progress bar + live rate (/s) + elapsed. Logout all = clears all connections at once.

## Update (2026-06) — Admin + Client auth, server-side background blast
- MAJOR: moved to full-stack. Custom JWT + bcrypt auth (no Clerk; closed username/password system).
- Roles: admin (manage clients only, cannot blast) + client (own firebases/leads/tasks, isolated).
- First-run: /api/setup/admin creates admin (username papiatma; password set on first screen).
- Admin dashboard: create/list/reset-password/delete clients. Deleting a client stops its running task.
- Client panel now talks to API: firebases add/remove/remove-all (dup URL rejected 409, key never returned to client), /devices (server merges+filters online), leads+{{v}} replace file (client-side parse), start/stop task.
- BACKGROUND ENGINE (server-side): POST /api/tasks runs asyncio task; parallel across devices; progress persisted to Mongo via _flusher; survives client logout. GET /api/tasks/current resumes % on re-login. run_task wrapped try/except/finally (crash -> status=failed, frees 409 lock). Startup marks interrupted running tasks.
- Auto-logout-all-firebase default ON: on completed task, all client firebases removed.
- 401 interceptor -> clearAuth + back to Login.
- Tested: backend 16/16 pytest; frontend 100% incl. logout-at-87% -> re-login shows running task -> completes -> auto-logout clears firebases. test_credentials.md updated.
- Known low-pri backlog: brute-force/rate-limit on login, JWT revocation on password reset, restore task config in UI on re-login, SSRF hardening on firebase URL.
