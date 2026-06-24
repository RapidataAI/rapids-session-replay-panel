# Rapids Session Replay (Grafana panel)

A Grafana panel that **replays a single session's interactions** as an animated
cursor over the **live rapid preview**, reconstructed from Rapidata logs. Scope
it with a `session_id` dashboard variable; it has play / scrub / speed controls.

It is a best-effort **tap replay** (our `session.click` is a *pointerdown*), not
a pixel-perfect DOM recording — there is no captured DOM/scroll/typed-input. The
backdrop is the real, *live* preview of the rapid, and the panel swaps it at the
state transitions it can infer (reward-modal close, `rapid.loaded`).

## Data contract
Feed the panel **one query** returning a long-format frame (ordered by `t`):

| column | meaning |
|---|---|
| `t` | event time, epoch **ms** |
| `kind` | `tap` \| `rapid_loaded` \| `modal_close` |
| `x`, `y` | tap position, **normalized 0..1** of the viewport (only for `tap`) |
| `label` | element/answer label (button text or tag) |
| `rapid_id` | the rapid on screen at that event |

The panel tracks the current rapid (latest `rapid_id` / `rapid_loaded`) and
whether the reward modal is open (until the first `modal_close`), and renders
`${previewBaseUrl}?id=<rapid_id>&rewardOnComplete=<modal?>` as the backdrop.

### Example query (ClickHouse datasource)
```sql
SELECT toUnixTimestamp64Milli(timestamp) AS t, 'tap' AS kind,
       toFloat64OrNull(attributes['position.x']) AS x,
       toFloat64OrNull(attributes['position.y']) AS y,
       coalesce(nullIf(attributes['button.text'], ''), attributes['tag.name']) AS label,
       rapid_id
FROM frontend.metrics
WHERE session_id = '${session_id}' AND metric_name = 'session.click' AND $__timeFilter(timestamp)
UNION ALL
SELECT toUnixTimestamp64Milli(timestamp), 'rapid_loaded', 0, 0, 'rapid.loaded', rapid_id
FROM frontend.metrics
WHERE session_id = '${session_id}' AND metric_name = 'rapid.loaded' AND $__timeFilter(timestamp)
UNION ALL
SELECT toUnixTimestamp64Milli(Timestamp), 'modal_close', 0, 0, 'reward modal closed', ''
FROM otel.session_logs
WHERE LogAttributes['session.id'] = '${session_id}' AND ServiceName = 'Rapidata.RapidsFrontend'
  AND Body = 'Closed Reward-on-complete modal' AND $__timeFilter(TimestampTime)
ORDER BY t
```

## Options
- **Rapid preview base URL** — default `https://rapids.rapidata.ai/preview/rapid`.
  The `?rewardOnComplete=true` the panel appends needs the rapids-frontend support
  so the reward modal renders in the preview.

## Limitations
- Tap-only fidelity; the backdrop is the *current* live render of the rapid, not
  a historical capture. Swapping rapids reloads the iframe (brief flicker).
- Coordinates are normalized to the session's own viewport; ~1% land off-canvas.
- A small fraction of sessions have corrupted timestamps (clock skew) that can
  break ordering.

## Install / develop
Unsigned plugin; installed into Grafana the same way as `rapids-preview-panel`
(`GF_PLUGINS_PREINSTALL` URL-zip + `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`).
`npm run dev` / `npm run build` / `npm run typecheck` for local work.
