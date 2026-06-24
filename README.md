# Rapids Session Replay (Grafana panel)

A Grafana panel that **replays a single session's interactions** as an animated
cursor over the **actual session**, rendered live via rapids-frontend's
`/inspect/session?id=<session_id>`. Built-in play / scrub / speed controls.

Scope it with a `session_id` dashboard variable. Best-effort **tap replay** (our
`session.click` is a *pointerdown*), not a pixel-perfect DOM recording.

## How it works
1. The query returns the session's **tap stream** (`session.click`).
2. The panel renders a live `<iframe>` of `${previewBaseUrl}?id=<session_id>`
   (default `/inspect/session`, which loads the real session via `inspectSession`)
   as the backdrop.
3. A lightweight cursor overlay moves between taps in real (idle-compressed) timing,
   pulsing a ripple at each tap. A small control bar gives play/pause, scrub and
   1–8× speed. No rrweb dependency — the backdrop is the genuine rapid, not a
   reconstructed DOM snapshot.

## Data contract
One query/frame, ordered by `t`:

| column | meaning |
|---|---|
| `t` | tap time, epoch **ms** |
| `x`, `y` | tap position, **normalized 0..1** of the viewport |
| `session_id` | *(optional)* the session — else the panel uses the `${session_id}` dashboard variable |
| `vw`, `vh` | *(optional)* viewport px for the canvas aspect (else the `canvasWidth/Height` options) |
| `kind` | *(optional)* if present, only rows with `kind = 'tap'` are plotted (markers like `rapid_loaded` are ignored) |

### Example query (ClickHouse datasource)
```sql
SELECT toUnixTimestamp64Milli(timestamp) AS t,
       toFloat64OrNull(attributes['position.x']) AS x,
       toFloat64OrNull(attributes['position.y']) AS y
FROM frontend.metrics
WHERE session_id = '${session_id}' AND metric_name = 'session.click' AND $__timeFilter(timestamp)
ORDER BY t
```

## Options
- **Rapid preview base URL** — default `https://rapids.rapidata.ai/inspect/session`;
  the panel appends `?id=<session_id>`.
- **Canvas width / height** — replay canvas size (portrait ~390×844, landscape
  ~850×393); overridden by `vw`/`vh` columns.
- **Max idle (ms)** — long gaps between taps are compressed to this so dead time
  doesn't dominate playback (default 2500; 0 disables).
- **Cursor colour** — the overlay cursor / tap-ripple colour.

## Limitations
- Tap-only fidelity; the backdrop is the live `/inspect/session` render. The cursor
  is a visual overlay — it does not drive the backdrop, so for multi-rapid sessions
  the later taps overlay the session's current screen rather than advancing it.
- Coordinates are normalized to the session viewport; ~1% land off-canvas.
- Some sessions have clock-skewed timestamps; out-of-order gaps fall back to a
  nominal step so playback stays monotonic.

## Install / develop
Unsigned plugin; installed into Grafana like `rapids-preview-panel`
(`GF_PLUGINS_PREINSTALL` URL-zip + `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`).
`npm run dev` / `npm run build` / `npm run typecheck` / `npm test`.
