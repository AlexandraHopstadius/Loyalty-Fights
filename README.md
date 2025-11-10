# Loyalty Fights – Live Admin + Viewer

This repository hosts the static fight card viewer (`index.html` + `fightcard.js` + `ws-client.js`) and the admin console (`admin.html`) used to drive live updates during events.

You can deploy a single Node server (e.g. on **Render**) that:

1. Serves the static files.
2. Exposes a WebSocket for real‑time broadcasts to all viewers.
3. Provides an authenticated admin action endpoint.
4. Persists the latest state to `fights.json` (and optionally commits it back to GitHub).

## Architecture

Component overview:

| Component | Purpose |
|-----------|---------|
| `server.js` | Node server: HTTP + WebSocket, holds in‑memory state and broadcasts updates. |
| `admin.html` | Admin UI: connects via WebSocket + POST `/admin/action` with a token. |
| `index.html` | Viewer: renders fights and listens for `{type:'state'}` WebSocket messages. |
| `fightcard.js` | Rendering + local XLSX/CSV import for initial fight data. |
| `ws-client.js` | Resilient viewer WebSocket client with backoff + state application. |

State shape broadcast to viewers:

```jsonc
{
  "type": "state",
  "state": {
    "fights": [ { "id": 1, "a": "...", "b": "...", "weight": "..", "klass": "..", "winner": "a|b|draw?" }, ... ],
    "current": 0,
    "standby": false,
    "infoVisible": true
  },
  "broadcastId": 42
}
```

Viewers ACK broadcasts with `{ type:'ack', broadcastId }` (optional, only logged server‑side).

## Deploy to Render (recommended)

1. Create a new **Web Service** (Node) from this GitHub repo.
2. Build command: *(leave empty – Node not compiled)*
3. Start command: `node server.js`
4. Environment Variable: set a strong `ADMIN_TOKEN` (e.g. generate with a password manager). Keep it secret.
5. (Optional) Set `GITHUB_TOKEN` and `GITHUB_REPO` (`owner/repo`) to auto‑commit `fights.json` after each change.
6. Deploy. After deploy you will have a base URL like `https://loyalty-fights.onrender.com`.

### Point Admin & Viewer at the Server

In `admin.html` a script already sets:

```html
<script>window.SERVER_ORIGIN = 'https://loyalty-fights.onrender.com'</script>
```

If you change your Render URL, update that line. For the viewer you can optionally add the same script tag (or host the viewer directly from Render so it shares origin automatically). If `window.SERVER_ORIGIN` is absent, both admin and viewer default to their own page origin.

### Obtaining the Admin Interface

Navigate to: `https://YOUR_RENDER_URL/admin.html?token=ADMIN_TOKEN`

Or open `admin.html` and paste the token manually, then click **Connect**.

### Performing Actions

Every admin action (set current fight, set winner, standby, etc.)
1. Sends a WebSocket admin message.
2. Performs an HTTP POST `/admin/action?token=ADMIN_TOKEN` for validation + persistence.
3. Server saves `fights.json` and broadcasts the full updated state `{type:'state'}`.

### Persisting Fights

Upload a CSV or XLSX file from the viewer page to locally replace fights.
To push those new fights to the live service:

1. In admin UI choose winners / set current as needed – each action persists.
2. (Optional) Add a future action to send an entire fight list (`setFights`). The server already supports this via WebSocket/HTTP with payload:

```json
{ "type": "setFights", "fights": [ { "a": "A", "b": "B", "weight": "67 kg", "klass": "C Herr" } ] }
```

### Environment Variables Summary

| Name | Required | Description |
|------|----------|-------------|
| `ADMIN_TOKEN` | Yes | Secret token used by admin clients (query param or Bearer token). |
| `PORT` | No | Render sets automatically; fallback 3000 locally. |
| `GITHUB_TOKEN` | No | PAT with `repo` scope for committing `fights.json`. |
| `GITHUB_REPO` | No | `owner/repo` for auto‑commit target. |

### Local Development

```powershell
# Install deps
npm install

# Set a local admin token (PowerShell example)
$env:ADMIN_TOKEN = "dev-secret-token"

# Run server
npm start

# Open viewer
Start-Process http://localhost:3000/index.html
# Open admin (token in query for auto connect)
Start-Process http://localhost:3000/admin.html?token=dev-secret-token
```

### Security Notes

* Treat `ADMIN_TOKEN` like a password – rotate if exposed.
* Avoid embedding the token inside public repos or client code shared with viewers.
* Future hardening: migrate to short‑lived signed JWTs or a small auth form served only over HTTPS.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Viewer never updates | WebSocket blocked | Ensure Render URL uses https and client converts to wss. Check browser console. |
| Admin shows unauthorized | Wrong token | Confirm `ADMIN_TOKEN` value in Render settings matches query param. Redeploy after changes. |
| Standby stuck on | No admin connected | Connect admin; selecting a fight clears standby. |
| Winners reset on restart | Missing persistence | Ensure writes to `fights.json` succeed; check server logs. |

### Extending

Add new action types (e.g., `setTimer`, `pauseMatch`) by editing `server.js` `applyAction()` (or equivalent logic) and updating `admin.html` buttons.

---

Legacy Supabase function code is retained under `supabase/functions` for reference but is not required for Render deployment.

Happy hosting! 🎉
