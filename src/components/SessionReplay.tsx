import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    });
  }
  return {
    taps: taps.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t),
    sessionId,
    vw,
    vh,
  };
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [1, 2, 4, 8];
const CONTROLS_H = 36;

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
    align-items: center;
    gap: 8px;
    width: 100%;
    height: ${CONTROLS_H}px;
    padding: 0 4px;
    font-size: 12px;
  `,
  btn: css`
    cursor: pointer;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    padding: 2px 6px;
  `,
  speed: css`
    cursor: pointer;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.55;
    padding: 2px 4px;
  `,
  speedOn: css`
    opacity: 1;
    font-weight: 700;
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
  `,
  tick: css`
    position: absolute;
    top: 50%;
    width: 2px;
    height: 9px;
    margin-top: -4px;
    background: #ff3b30;
    border-radius: 1px;
    pointer-events: none;
    transform: translateX(-50%);
  `,
  time: css`
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
    min-width: 80px;
    text-align: right;
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
});

export const SessionReplayPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id, replaceVariables }) => {
  const styles = useStyles2(getStyles);
  const parsed = useMemo(() => (data.series[0] ? parseFrame(data.series[0]) : { taps: [] }), [data.series]);
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
  }, [timeline]);

  // Wait for the backdrop's `ready` (interact mode) before starting the clock;
  // fall back after a timeout so a missing/old handler can't hang playback.
  useEffect(() => {
    if (!options.interact) {
      setReplayReady(true);
      return;
    }
    setReplayReady(false);
    const onMessage = (e: MessageEvent) => {
      if (e.data?.source === 'rapidata-session-replay' && e.data?.type === 'ready') {
        setReplayReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    const fallback = window.setTimeout(() => setReplayReady(true), 10000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(fallback);
    };
  }, [options.interact, sessionUrl, timeline]);

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
              { source: 'rapidata-session-replay', type: 'tap', x: r.x, y: r.y },
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
    setPlaying(true);
  };
  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setPlayhead(v);
    lastRippleIdxRef.current = timeline.ripples.reduce((acc, r, i) => (r.pt <= v ? i : acc), -1);
  };
  const ended = playhead >= timeline.duration;

  return (
    <div className={styles.wrap}>
      <div className={styles.stage} style={{ width: stageW, height: stageH }}>
        <div className={styles.inner} style={{ width: canvasW, height: canvasH, transform: `scale(${scale})` }}>
          <iframe ref={iframeRef} className={styles.frame} src={sessionUrl} title="session backdrop" />
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
      <div className={styles.controls} style={{ width: stageW }}>
        <button className={styles.btn} onClick={() => (ended ? restart() : setPlaying((p) => !p))}>
          {ended ? '↻' : playing ? '❚❚' : '▶'}
        </button>
        <div className={styles.scrubWrap}>
          <input className={styles.scrub} type="range" min={0} max={timeline.duration} value={playhead} onChange={onScrub} />
          {timeline.ripples.map((r, i) => (
            <span
              key={i}
              className={styles.tick}
              style={{ left: `${(r.pt / timeline.duration) * 100}%`, background: options.cursorColor || '#ff3b30' }}
              title={`tap ${i} @ ${fmt(r.pt)}`}
            />
          ))}
        </div>
        {SPEEDS.map((s) => (
          <button key={s} className={cx(styles.speed, s === speed && styles.speedOn)} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
        <span className={styles.time}>
          {fmt(playhead)} / {fmt(timeline.duration)}
        </span>
      </div>
    </div>
  );
};
