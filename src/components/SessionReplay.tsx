import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelProps, DataFrame } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { css, cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { SessionReplayOptions } from 'types';
import { buildTimeline, cursorAt, Tap } from '../timeline';

interface Props extends PanelProps<SessionReplayOptions> {}

interface Parsed {
  taps: Tap[];
  sessionId?: string;
  vw?: number;
  vh?: number;
}

const fieldValue = (f: { values: any }, i: number) =>
  typeof f.values?.get === 'function' ? f.values.get(i) : f.values[i];

function parseFrame(frame: DataFrame): Parsed {
  const by = (n: string) => frame.fields.find((f) => f.name === n);
  const tF = by('t') ?? by('time') ?? frame.fields[0];
  const kindF = by('kind');
  const xF = by('x');
  const yF = by('y');
  const tagF = by('tag') ?? by('tagname');
  const pathF = by('path') ?? by('element_path');
  const sessF = by('session_id') ?? by('session');
  const vwF = by('vw');
  const vhF = by('vh');
  const taps: Tap[] = [];
  let sessionId: string | undefined;
  let vw: number | undefined;
  let vh: number | undefined;
  // First finite value wins — vw/vh may ride on a viewport-marker row, not a tap row.
  const firstFinite = (cur: number | undefined, f: typeof vwF, i: number) => {
    if (cur !== undefined || !f) {
      return cur;
    }
    const v = Number(fieldValue(f, i));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  for (let i = 0; i < frame.length; i++) {
    if (sessF && !sessionId) {
      sessionId = String(fieldValue(sessF, i) ?? '') || undefined;
    }
    vw = firstFinite(vw, vwF, i);
    vh = firstFinite(vh, vhF, i);
    // when a `kind` column is present, only the tap rows are cursor positions;
    // rapid_loaded / modal_close markers sit at (0,0) and must not be plotted.
    const kind = kindF ? String(fieldValue(kindF, i)) : 'tap';
    if (kind !== 'tap') {
      continue;
    }
    taps.push({
      t: Number(fieldValue(tF, i)),
      x: xF ? Number(fieldValue(xF, i)) : 0,
      y: yF ? Number(fieldValue(yF, i)) : 0,
      tag: tagF ? String(fieldValue(tagF, i) ?? '') || undefined : undefined,
      path: pathF ? String(fieldValue(pathF, i) ?? '') || undefined : undefined,
    });
  }
  return {
    taps: taps.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t),
    sessionId,
    vw,
    vh,
  };
}

interface RecordedOrder {
  index: number;
  optionOrder: string[];
}

// Parse the rapid.option.order query (rapid_index + option_order JSON) so the
// panel can tell /inspect/session the order the user actually saw.
function parseOrder(frame: DataFrame): RecordedOrder[] {
  const idxF = frame.fields.find((f) => f.name === 'rapid_index' || f.name === 'index');
  const ordF = frame.fields.find((f) => f.name === 'option_order');
  if (!idxF || !ordF) {
    return [];
  }
  const out: RecordedOrder[] = [];
  for (let i = 0; i < frame.length; i++) {
    const index = Number(fieldValue(idxF, i));
    let optionOrder: string[] = [];
    const raw = fieldValue(ordF, i);
    try {
      optionOrder = Array.isArray(raw) ? raw : JSON.parse(String(raw));
    } catch {
      optionOrder = [];
    }
    if (Number.isFinite(index) && optionOrder.length) {
      out.push({ index, optionOrder });
    }
  }
  return out;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [1, 2, 4, 8];
const CONTROLS_H = 58;
const ACCENT = '#4950f6';

const getStyles = () => ({
  wrap: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `,
  stage: css`
    position: relative;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    background: #fff;
  `,
  // Sized to the session's true viewport, then scaled to fit — so the embedded
  // rapid lays out at the real device width (correct breakpoints), not the
  // shrunken panel size.
  inner: css`
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  `,
  frame: css`
    border: 0;
    display: block;
    width: 100%;
    height: 100%;
    /* backdrop only — never let scrubbing land a real click in the embedded rapid */
    pointer-events: none;
  `,
  cursor: css`
    position: absolute;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.9);
    pointer-events: none;
    transition: left 60ms linear, top 60ms linear;
    z-index: 3;
  `,
  ripple: css`
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    pointer-events: none;
    z-index: 2;
    animation: rrtap 600ms ease-out forwards;
    @keyframes rrtap {
      from {
        transform: scale(0.4);
        opacity: 0.9;
      }
      to {
        transform: scale(2.6);
        opacity: 0;
      }
    }
  `,
  controls: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    height: ${CONTROLS_H}px;
    padding: 6px 6px 2px;
    font-size: 12px;
  `,
  scrubRow: css`
    display: flex;
    align-items: center;
    gap: 10px;
  `,
  ctrlRow: css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  `,
  btn: css`
    cursor: pointer;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 14px;
    line-height: 1;
    padding: 2px 8px;
  `,
  speed: css`
    cursor: pointer;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    font-size: 12px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  `,
  speedOn: css`
    opacity: 1;
    color: #fff;
    font-weight: 600;
    background: ${ACCENT};
  `,
  scrubWrap: css`
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  `,
  scrub: css`
    width: 100%;
    cursor: pointer;
    position: relative;
    z-index: 1;
    accent-color: ${ACCENT};
  `,
  tick: css`
    position: absolute;
    top: 50%;
    width: 10px;
    height: 5px;
    border-radius: 3px;
    background: ${ACCENT};
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 2;
  `,
  time: css`
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
    min-width: 42px;
  `,
  dbgMarker: css`
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: rgba(0, 122, 255, 0.85);
    box-shadow: 0 0 0 1px #fff;
    pointer-events: none;
    z-index: 4;
  `,
  dbgLabel: css`
    position: absolute;
    transform: translate(6px, -50%);
    font-size: 10px;
    font-weight: 700;
    color: #007aff;
    text-shadow: 0 0 2px #fff, 0 0 2px #fff;
    pointer-events: none;
    z-index: 4;
    white-space: nowrap;
  `,
  dbgInfo: css`
    font-size: 11px;
    font-family: monospace;
    opacity: 0.85;
    align-self: stretch;
    padding: 2px 4px;
  `,
  waiting: css`
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 11px;
    pointer-events: none;
    z-index: 5;
  `,
  outer: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: stretch;
  `,
  main: css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `,
  side: css`
    width: 210px;
    flex: none;
    overflow-y: auto;
    border-left: 1px solid rgba(128, 128, 128, 0.25);
    padding: 4px 6px;
    font-size: 11px;
  `,
  sideHead: css`
    opacity: 0.6;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 2px 0 6px;
  `,
  warn: css`
    background: rgba(255, 59, 48, 0.14);
    color: #ff3b30;
    padding: 3px 6px;
    border-radius: 4px;
    margin-bottom: 6px;
    font-size: 11px;
  `,
  tlRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    &:hover {
      background: rgba(128, 128, 128, 0.12);
    }
  `,
  tlActive: css`
    background: rgba(91, 110, 225, 0.18);
  `,
  tlTime: css`
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
    min-width: 34px;
  `,
  tlTag: css`
    flex: 1;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  tlStatus: css`
    width: 14px;
    text-align: center;
  `,
  tlOk: css`
    color: #2e9e5b;
  `,
  tlBad: css`
    color: #ff3b30;
    background: rgba(255, 59, 48, 0.08);
  `,
});

export const SessionReplayPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id, replaceVariables }) => {
  const styles = useStyles2(getStyles);
  // With two queries (taps + option order), pick each series by its fields.
  const tapsSeries = useMemo(
    () => data.series.find((s) => s.fields.some((f) => f.name === 'x' || f.name === 't')) ?? data.series[0],
    [data.series]
  );
  const orderSeries = useMemo(() => data.series.find((s) => s.fields.some((f) => f.name === 'option_order')), [data.series]);
  const parsed = useMemo(() => (tapsSeries ? parseFrame(tapsSeries) : { taps: [] }), [tapsSeries]);
  const order = useMemo(() => (orderSeries ? parseOrder(orderSeries) : []), [orderSeries]);
  const timeline = useMemo(() => (parsed.taps.length ? buildTimeline(parsed.taps, options.maxIdleMs ?? 2500) : null), [parsed.taps, options.maxIdleMs]);

  const sessionId = (parsed.sessionId || replaceVariables('${session_id}') || '').trim();
  const canvasW = parsed.vw || options.canvasWidth || 390;
  const canvasH = parsed.vh || options.canvasHeight || 844;
  const sessionUrl = sessionId
    ? `${options.previewBaseUrl}?id=${encodeURIComponent(sessionId)}${options.rewardModal ? '&rewardOnComplete=true' : ''}${
        options.interact ? '&replay=true' : ''
      }`
    : '';

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [activeRipple, setActiveRipple] = useState<{ key: number; x: number; y: number } | null>(null);
  // In interact mode, hold playback until the backdrop says it's rendered, so
  // the first tap doesn't fire during the loading screen. Always ready otherwise.
  const [replayReady, setReplayReady] = useState(!options.interact);
  // What each replayed tap actually hit (from the backdrop), to flag divergence.
  const [tapResults, setTapResults] = useState<Record<number, { tag: string | null; path: string | null }>>({});
  // Bumped on restart to remount the iframe — resets the live backdrop (so the
  // reward modal reappears) since synthetic clicks can't be un-applied.
  const [reloadKey, setReloadKey] = useState(0);

  const rafRef = useRef<number>();
  const lastTsRef = useRef<number>();
  const lastRippleIdxRef = useRef<number>(-1);
  const playheadRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  playheadRef.current = playhead;

  useEffect(() => {
    setPlayhead(0);
    setPlaying(true);
    lastRippleIdxRef.current = -1;
    setTapResults({});
  }, [timeline]);

  // True once the backdrop has said hello. Tracked in a ref so we can send the
  // order whenever it becomes available, even if the data query resolves after
  // the hello (otherwise the order is silently dropped — a refresh-only flake).
  const helloRef = useRef(false);
  const sendOrder = useCallback(() => {
    if (order.length && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { source: 'rapidata-session-replay', type: 'order', rapids: order },
        '*'
      );
    }
  }, [order]);

  // Wait for the backdrop's `ready` (interact mode) before starting the clock;
  // fall back after a timeout so a missing/old handler can't hang playback.
  useEffect(() => {
    if (!options.interact) {
      setReplayReady(true);
      return;
    }
    setReplayReady(false);
    helloRef.current = false;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.source !== 'rapidata-session-replay') {
        return;
      }
      if (e.data.type === 'ready') {
        setReplayReady(true);
      }
      // The backdrop asks for the recorded presentation order on mount; reply so
      // it can reorder assets to what the user saw before rendering.
      if (e.data.type === 'replay-hello') {
        helloRef.current = true;
        sendOrder();
      }
      // The backdrop reports which element each tap hit, so we can flag taps
      // that landed on a different element than the original recorded.
      if (e.data.type === 'tap-result' && typeof e.data.i === 'number') {
        const { i, tag, path } = e.data;
        setTapResults((prev) => ({ ...prev, [i]: { tag: tag ?? null, path: path ?? null } }));
      }
    };
    window.addEventListener('message', onMessage);
    const fallback = window.setTimeout(() => setReplayReady(true), 10000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(fallback);
    };
  }, [options.interact, sessionUrl, timeline, sendOrder, reloadKey]);

  // If the order query resolves after the backdrop already said hello, send it.
  useEffect(() => {
    if (helloRef.current) {
      sendOrder();
    }
  }, [sendOrder]);

  useEffect(() => {
    if (!timeline || !playing || !replayReady) {
      return;
    }
    lastTsRef.current = undefined;
    const tick = (ts: number) => {
      if (lastTsRef.current == null) {
        lastTsRef.current = ts;
      }
      const dt = (ts - lastTsRef.current) * speed;
      lastTsRef.current = ts;
      let next = playheadRef.current + dt;
      if (next >= timeline.duration) {
        next = timeline.duration;
      }
      for (let i = lastRippleIdxRef.current + 1; i < timeline.ripples.length; i++) {
        if (timeline.ripples[i].pt <= next) {
          const r = timeline.ripples[i];
          setActiveRipple({ key: i, x: r.x, y: r.y });
          lastRippleIdxRef.current = i;
          if (options.interact) {
            iframeRef.current?.contentWindow?.postMessage(
              { source: 'rapidata-session-replay', type: 'tap', x: r.x, y: r.y, i },
              '*'
            );
          }
        }
      }
      setPlayhead(next);
      if (next >= timeline.duration) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [timeline, playing, speed, options.interact, replayReady]);

  useEffect(() => {
    if (!options.debug) {
      return;
    }
    const rows = parsed.taps.map((t, i) => ({
      i,
      t: t.t,
      x: Number(t.x.toFixed(4)),
      y: Number(t.y.toFixed(4)),
      px: Math.round(t.x * canvasW),
      py: Math.round(t.y * canvasH),
    }));
    console.log('[session-replay] backdrop', { sessionId, viewport: `${canvasW}x${canvasH}`, fromColumns: { vw: parsed.vw, vh: parsed.vh }, sessionUrl, taps: parsed.taps.length });
    // eslint-disable-next-line no-console -- console.table is the point of the debug dump
    console.table(rows);
  }, [options.debug, parsed, sessionId, canvasW, canvasH, sessionUrl]);

  if (!timeline || parsed.taps.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }
  if (!sessionUrl) {
    return <div className={styles.wrap}>No session id — add a `session_id` column or a `$session_id` dashboard variable.</div>;
  }

  // Fit the true viewport into the panel; never upscale past 1:1, so the
  // backdrop doesn't grow with the session — it only ever shrinks to fit.
  const scale = Math.min((width - 8) / canvasW, (height - CONTROLS_H - 8) / canvasH, 1);
  const stageW = Math.max(1, Math.round(canvasW * scale));
  const stageH = Math.max(1, Math.round(canvasH * scale));
  const pos = cursorAt(timeline, playhead);

  const restart = () => {
    setPlayhead(0);
    lastRippleIdxRef.current = -1;
    setActiveRipple(null);
    setTapResults({});
    // Remount the iframe so the live backdrop resets (reward modal reappears);
    // synthetic clicks already applied to it can't be rewound otherwise.
    if (options.interact) {
      setReloadKey((k) => k + 1);
    }
    setPlaying(true);
  };
  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setPlayhead(v);
    lastRippleIdxRef.current = timeline.ripples.reduce((acc, r, i) => (r.pt <= v ? i : acc), -1);
  };
  const ended = playhead >= timeline.duration;

  // Validate each replayed tap against the recorded element: did the synthetic
  // tap land on the same element the original session recorded?
  const tapStatus = (i: number): 'match' | 'mismatch' | 'pending' | 'na' => {
    const rec = parsed.taps[i];
    const res = tapResults[i];
    if (!rec?.path) {return 'na';}
    if (!res) {return 'pending';}
    return res.path === rec.path ? 'match' : 'mismatch';
  };
  const mismatchCount = parsed.taps.reduce((acc, _t, i) => (tapStatus(i) === 'mismatch' ? acc + 1 : acc), 0);
  const showTimeline = options.interact && parsed.taps.some((t) => t.path);
  const scrubToTap = (i: number) => {
    const pt = timeline.ripples[i]?.pt ?? 0;
    setPlayhead(pt);
    lastRippleIdxRef.current = timeline.ripples.reduce((acc, r, j) => (r.pt <= pt ? j : acc), -1);
  };

  return (
    <div className={styles.outer}>
      <div className={styles.main}>
      <div className={styles.stage} style={{ width: stageW, height: stageH }}>
        <div className={styles.inner} style={{ width: canvasW, height: canvasH, transform: `scale(${scale})` }}>
          <iframe key={reloadKey} ref={iframeRef} className={styles.frame} src={sessionUrl} title="session backdrop" />
        </div>
        {activeRipple && (
          <span
            key={activeRipple.key}
            className={styles.ripple}
            style={{ left: `${activeRipple.x * 100}%`, top: `${activeRipple.y * 100}%`, background: options.cursorColor || '#ff3b30' }}
          />
        )}
        <span
          className={styles.cursor}
          style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, background: options.cursorColor || '#ff3b30' }}
        />
        {options.interact && !replayReady && <div className={styles.waiting}>waiting for session…</div>}
        {options.debug &&
          parsed.taps.map((t, i) => (
            <React.Fragment key={i}>
              <span className={styles.dbgMarker} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }} />
              <span className={styles.dbgLabel} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
                {i} ({t.x.toFixed(2)},{t.y.toFixed(2)})
              </span>
            </React.Fragment>
          ))}
      </div>
      {options.debug && (
        <div className={styles.dbgInfo}>
          {sessionId} · {canvasW}×{canvasH}
          {parsed.vw ? ' (from vw/vh)' : ' (default — query has no vw/vh)'} · {parsed.taps.length} taps
        </div>
      )}
      <div className={styles.controls}>
        <div className={styles.scrubRow}>
          <span className={styles.time}>{fmt(playhead)}</span>
          <div className={styles.scrubWrap}>
            <input className={styles.scrub} type="range" min={0} max={timeline.duration} value={playhead} onChange={onScrub} />
            {timeline.ripples.map((r, i) => (
              <span
                key={i}
                className={styles.tick}
                style={{ left: `${(r.pt / timeline.duration) * 100}%` }}
                title={`tap ${i} @ ${fmt(r.pt)}`}
              />
            ))}
          </div>
          <span className={styles.time} style={{ textAlign: 'right' }}>
            {fmt(timeline.duration)}
          </span>
        </div>
        <div className={styles.ctrlRow}>
          <button className={styles.btn} onClick={() => (ended ? restart() : setPlaying((p) => !p))} title={ended ? 'replay' : playing ? 'pause' : 'play'}>
            {ended ? '↻' : playing ? '❚❚' : '▶'}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} className={cx(styles.speed, s === speed && styles.speedOn)} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      </div>
      {showTimeline && (
        <div className={styles.side}>
          {mismatchCount > 0 && (
            <div className={styles.warn}>⚠ {mismatchCount} tap{mismatchCount > 1 ? 's' : ''} hit a different element than recorded</div>
          )}
          <div className={styles.sideHead}>clicks ({parsed.taps.length})</div>
          {parsed.taps.map((t, i) => {
            const st = tapStatus(i);
            const res = tapResults[i];
            const icon = st === 'match' ? '✓' : st === 'mismatch' ? '✗' : st === 'pending' ? '·' : '–';
            const title =
              st === 'mismatch'
                ? `recorded: ${t.tag ?? '?'}  ${t.path}\nhit:      ${res?.tag ?? '?'}  ${res?.path ?? ''}`
                : t.path || 'no recorded element path';
            return (
              <div
                key={i}
                className={cx(styles.tlRow, st === 'mismatch' && styles.tlBad, activeRipple?.key === i && styles.tlActive)}
                title={title}
                onClick={() => scrubToTap(i)}
              >
                <span className={styles.tlTime}>{fmt(timeline.ripples[i]?.pt ?? 0)}</span>
                <span className={styles.tlTag}>{t.tag || '?'}</span>
                <span className={cx(styles.tlStatus, st === 'match' && styles.tlOk, st === 'mismatch' && styles.tlBad)}>{icon}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
