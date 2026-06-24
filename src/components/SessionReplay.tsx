import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanelProps, DataFrame } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { SessionReplayOptions } from 'types';

interface Props extends PanelProps<SessionReplayOptions> {}

type Kind = 'tap' | 'rapid_loaded' | 'modal_close';
interface Row {
  t: number; // epoch ms
  kind: Kind;
  x: number; // 0..1 of viewport
  y: number;
  label: string;
  rapid: string;
}

const fieldValue = (f: { values: any }, i: number) =>
  typeof f.values?.get === 'function' ? f.values.get(i) : f.values[i];

function parseRows(frame: DataFrame): Row[] {
  const by = (name: string) => frame.fields.find((f) => f.name === name);
  const tF = by('t') ?? by('time') ?? frame.fields[0];
  const kindF = by('kind');
  const xF = by('x');
  const yF = by('y');
  const labelF = by('label');
  const rapidF = by('rapid_id') ?? by('rapid');
  const rows: Row[] = [];
  for (let i = 0; i < frame.length; i++) {
    rows.push({
      t: Number(fieldValue(tF, i)),
      kind: (kindF ? String(fieldValue(kindF, i)) : 'tap') as Kind,
      x: xF ? Number(fieldValue(xF, i)) : 0,
      y: yF ? Number(fieldValue(yF, i)) : 0,
      label: labelF ? String(fieldValue(labelF, i) ?? '') : '',
      rapid: rapidF ? String(fieldValue(rapidF, i) ?? '') : '',
    });
  }
  return rows.filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
}

const getStyles = () => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: system-ui, sans-serif;
  `,
  stage: css`
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: #0b1021;
    overflow: hidden;
  `,
  frame: css`
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  `,
  cursor: css`
    position: absolute;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 50%;
    background: rgba(137, 180, 250, 0.9);
    box-shadow: 0 0 0 2px #fff, 0 0 8px rgba(137, 180, 250, 0.8);
    pointer-events: none;
    transition: left 120ms linear, top 120ms linear;
    z-index: 3;
  `,
  ripple: css`
    position: absolute;
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    border-radius: 50%;
    border: 2px solid rgba(137, 180, 250, 0.9);
    pointer-events: none;
    z-index: 2;
  `,
  bar: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: #11162a;
    color: #cdd6f4;
    font-size: 12px;
  `,
  btn: css`
    background: #1f2a4d;
    color: #cdd6f4;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
  `,
  scrub: css`
    flex: 1 1 auto;
  `,
});

export const SessionReplayPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id }) => {
  const styles = useStyles2(getStyles);
  const rows = useMemo(() => (data.series[0] ? parseRows(data.series[0]) : []), [data.series]);

  const t0 = rows.length ? rows[0].t : 0;
  const duration = rows.length ? rows[rows.length - 1].t - t0 : 0;

  const [playMs, setPlayMs] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const lastTsRef = useRef<number | null>(null);
  playingRef.current = playing;
  speedRef.current = speed;

  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current != null && playingRef.current) {
        const dt = (ts - lastTsRef.current) * speedRef.current;
        setPlayMs((p) => (p + dt >= duration ? duration : p + dt));
      }
      lastTsRef.current = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  if (rows.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }

  const now = t0 + playMs;
  const firstRapid = rows.find((r) => r.rapid)?.rapid ?? '';
  const currentRapid = [...rows].reverse().find((r) => r.t <= now && r.rapid)?.rapid ?? firstRapid;
  const modalOpen = !rows.some((r) => r.kind === 'modal_close' && r.t <= now);
  const lastTap = [...rows].reverse().find((r) => r.kind === 'tap' && r.t <= now);
  const sinceTap = lastTap ? now - lastTap.t : Infinity;

  const src = `${options.previewBaseUrl}?id=${encodeURIComponent(currentRapid)}${
    modalOpen ? '&rewardOnComplete=true' : ''
  }`;

  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <div className={styles.wrap} style={{ width, height }}>
      <div className={styles.stage}>
        {/* key on rapid+modal so the iframe reloads only when the screen state changes */}
        <iframe className={styles.frame} src={src} key={src} title="rapid preview" />
        {lastTap && sinceTap < 1500 && (
          <div className={styles.cursor} style={{ left: `${lastTap.x * 100}%`, top: `${lastTap.y * 100}%` }} />
        )}
        {lastTap && sinceTap < 450 && (
          <div
            className={styles.ripple}
            style={{
              left: `${lastTap.x * 100}%`,
              top: `${lastTap.y * 100}%`,
              opacity: 1 - sinceTap / 450,
              transform: `scale(${1 + sinceTap / 300})`,
            }}
          />
        )}
      </div>
      <div className={styles.bar}>
        <button className={styles.btn} onClick={() => setPlaying((p) => !p)}>
          {playing ? '❚❚' : '►'}
        </button>
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={duration}
          value={playMs}
          onChange={(e) => {
            setPlaying(false);
            setPlayMs(Number(e.target.value));
          }}
        />
        <span>
          {fmt(playMs)} / {fmt(duration)}
        </span>
        <select className={styles.btn} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[1, 2, 4, 8].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span title={lastTap?.label}>{lastTap ? `${lastTap.label || lastTap.kind}` : ''}</span>
      </div>
    </div>
  );
};
