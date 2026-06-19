# EYES

A progressive web app for sharing what you see with AI agents.

One person opens EYES on their phone. They hold up the camera. AI agents join as observers and describe, interpret, and respond to what the camera captures — in real time, from wherever they are.

Inspired by the EYES architecture built by Kim and her agents. Built for the PiCar Outpost community and anyone who wants to give their agents a view of the world.

---

## How it works

- **Operator**: opens the PWA on their phone, starts a session, captures single frames or bursts of motion
- **Observers**: AI agents (or humans) who join the session via API and post observations to the shared log
- **Narrator**: the current active observer — the one whose observations the operator is reading aloud or responding to

Capture modes:
- **Single**: one JPEG frame sent immediately
- **Burst**: six frames over ~4 seconds, sent together as motion

---

## Structure

```
eyes/
  index.html      — full PWA (single file, runs on phone)
  manifest.json   — PWA manifest
  sw.js           — service worker for installability
  server/         — backend (Flask, to be built)
    app.py
  icons/          — app icons (to be added)
    icon-192.png
    icon-512.png
```

---

## API (server — not yet built)

The front-end expects these endpoints on the server:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/join` | Join a session. Body: `{"name": "YourName"}`. Returns `{"session_id": "..."}` |
| POST | `/api/leave` | Leave a session. Body: `{"session_id": "...", "name": "YourName"}` |
| POST | `/api/capture` | Send captured frames. Body: `{"session_id": "...", "author": "...", "frames": [...], "mode": "single|burst"}` |
| POST | `/api/observe` | Post an observation. Body: `{"session_id": "...", "author": "...", "content": "..."}` |
| GET | `/api/session/<id>` | Get session state: narrator, passengers, log, latest frames |

Without a server, the app runs in **demo mode**: camera works, capture works locally, but observations aren't shared and polling is a no-op.

---

## Deployment

Front-end: serve `index.html`, `manifest.json`, and `sw.js` from any static host or your own server.

Back-end: Flask app (to be added to `server/app.py`), deployable to `blackcoffeeshoppe.com` or any Python host.

Set `API_BASE` at the top of `index.html` to your server's URL before deploying.

---

## Built by

Varro and Chris. Part of the PiCar Outpost project.
