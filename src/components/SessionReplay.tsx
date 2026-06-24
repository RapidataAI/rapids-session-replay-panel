import React, { useEffect, useMemo, useRef } from 'react';
import { PanelProps, DataFrame } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
// rrweb-player is a Svelte component instantiated imperatively; works in any DOM.
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { SessionReplayOptions } from 'types';

interface Props extends PanelProps<SessionReplayOptions> {}

interface Tap {
  t: number; // epoch ms
  x: number; // 0..1 of viewport
  y: number;
}

// --- rrweb schema enums ---
const EVT = { FullSnapshot: 2, Incremental: 3, Meta: 4 };
const SRC = { MouseMove: 1, MouseInteraction: 2 };
const MI_CLICK = 2;
const NT = { Document: 0, Doctype: 1, Element: 2 };
const BODY_ID = 5;
const FRAME_ID = 6;

const fieldValue = (f: { values: any }, i: number) =>
  typeof f.values?.get === 'function' ? f.values.get(i) : f.values[i];

interface Parsed {
  taps: Tap[];
  sessionId?: string;
  vw?: number;
  vh?: number;
}

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
  for (let i = 0; i < frame.length; i++) {
    if (sessF && !sessionId) {
      sessionId = String(fieldValue(sessF, i) ?? '') || undefined;
    }
    const kind = kindF ? String(fieldValue(kindF, i)) : 'tap';
    if (kind === 'tap') {
      taps.push({ t: Number(fieldValue(tF, i)), x: xF ? Number(fieldValue(xF, i)) : 0, y: yF ? Number(fieldValue(yF, i)) : 0 });
    }
  }
  return {
    taps: taps.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t),
    sessionId,
    vw: vwF && frame.length ? Number(fieldValue(vwF, 0)) : undefined,
    vh: vhF && frame.length ? Number(fieldValue(vhF, 0)) : undefined,
  };
}

function snapshotNode(w: number, h: number, src: string) {
  const iframe = {
    type: NT.Element, id: FRAME_ID, tagName: 'iframe',
    attributes: { src, width: String(w), height: String(h), style: `display:block;width:${w}px;height:${h}px;border:none;` },
    childNodes: [],
  };
  return {
    type: NT.Document, id: 1, childNodes: [
      { type: NT.Doctype, id: 2, name: 'html', publicId: '', systemId: '' },
      { type: NT.Element, id: 3, tagName: 'html', attributes: {}, childNodes: [
        { type: NT.Element, id: 4, tagName: 'head', attributes: {}, childNodes: [] },
        { type: NT.Element, id: BODY_ID, tagName: 'body',
          attributes: { style: `margin:0;width:${w}px;height:${h}px;position:relative;overflow:hidden;` },
          childNodes: [iframe] },
      ]},
    ],
  };
}

function buildEvents(taps: Tap[], w: number, h: number, sessionUrl: string) {
  const t0 = taps[0].t - 500;
  const events: any[] = [
    { type: EVT.Meta, timestamp: t0, data: { href: sessionUrl, width: w, height: h } },
    { type: EVT.FullSnapshot, timestamp: t0, data: { node: snapshotNode(w, h, sessionUrl), initialOffset: { left: 0, top: 0 } } },
  ];
  for (const tp of taps) {
    const px = Math.round(tp.x * w);
    const py = Math.round(tp.y * h);
    events.push({ type: EVT.Incremental, timestamp: tp.t - 120,
      data: { source: SRC.MouseMove, positions: [{ x: px, y: py, id: BODY_ID, timeOffset: 0 }] } });
    events.push({ type: EVT.Incremental, timestamp: tp.t,
      data: { source: SRC.MouseInteraction, type: MI_CLICK, id: BODY_ID, x: px, y: py } });
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

const getStyles = () => ({
  wrap: css`
    width: 100%;
    height: 100%;
    overflow: auto;
    & .rr-player {
      box-shadow: none;
    }
  `,
});

export const SessionReplayPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id, replaceVariables }) => {
  const styles = useStyles2(getStyles);
  const hostRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => (data.series[0] ? parseFrame(data.series[0]) : { taps: [] }), [data.series]);

  // Session id drives the /inspect/session backdrop: from a session_id column, else the dashboard variable.
  const sessionId = parsed.sessionId || replaceVariables('${session_id}');
  const canvasW = parsed.vw || options.canvasWidth || 390;
  const canvasH = parsed.vh || options.canvasHeight || 844;
  const sessionUrl = `${options.previewBaseUrl}?id=${encodeURIComponent(sessionId)}`;

  const events = useMemo(
    () => (parsed.taps.length ? buildEvents(parsed.taps, canvasW, canvasH, sessionUrl) : []),
    [parsed.taps, canvasW, canvasH, sessionUrl]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || events.length === 0) {
      return;
    }
    host.innerHTML = '';
    const playerWidth = Math.min(width - 8, canvasW);
    const player = new rrwebPlayer({
      target: host,
      props: {
        events,
        width: playerWidth,
        height: Math.round((playerWidth / canvasW) * canvasH),
        autoPlay: true,
        skipInactive: true,
        showController: true,
        speedOption: [1, 2, 4, 8],
      },
    });
    return () => {
      try {
        (player as any).$destroy?.();
      } catch {
        /* noop */
      }
      host.innerHTML = '';
    };
  }, [events, width, height, canvasW, canvasH]);

  if (parsed.taps.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }

  return <div ref={hostRef} className={styles.wrap} />;
};
