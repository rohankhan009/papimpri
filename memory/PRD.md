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
