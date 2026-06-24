# Rapids Session Replay (Grafana panel)

A Grafana panel that **replays a single session's interactions** with `rrweb-player`
(scrub / play / speed / skip-inactivity) — an animated cursor over the **actual
session**, rendered live via rapids-frontend's `/inspect/session?id=<session_id>`.

Scope it with a `session_id` dashboard variable. Best-effort **tap replay** (our
`session.click` is a *pointerdown*), not a pixel-perfect DOM recording.

## How it works
1. The query returns the session's **tap stream** (`session.click`).
2. The panel builds an rrweb event stream: `Meta` + `FullSnapshot` whose body holds
   an `<iframe>` of `${previewBaseUrl}?id=<session_id>` (default `/inspect/session`,
   which loads the real session via `inspectSession`), then per tap a
   `MouseMove`+`Click`.
3. Renders `rrweb-player`, scaled to the panel.

## Data contract
One query/frame, ordered by `t`:

| column | meaning |
|---|---|
| `t` | tap time, epoch **ms** |
| `x`, `y` | tap position, **normalized 0..1** of the viewport |
| `session_id` | *(optional)* the session — else the panel uses the `${session_id}` dashboard variable |
| `vw`, `vh` | *(optional)* viewport px for the canvas aspect (else the `canvasWidth/Height` options) |
| `kind` | *(optional)* only rows with `kind = 'tap'` (or no `kind`) are plotted |

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

## Limitations
- Tap-only fidelity; the backdrop is the live `/inspect/session` render. The cursor
  is a visual overlay — it does not drive the backdrop, so for multi-rapid sessions
  the later taps overlay the session's current screen rather than advancing it.
- Coordinates are normalized to the session viewport; ~1% land off-canvas.
- rrweb may sandbox the cross-origin iframe on replay; if the backdrop is blank, the
  fallback is screenshot backdrops. Some sessions have clock-skewed timestamps.

## Install / develop
Unsigned plugin; installed into Grafana like `rapids-preview-panel`
(`GF_PLUGINS_PREINSTALL` URL-zip + `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`).
`npm run dev` / `npm run build` / `npm run typecheck`.
