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

type Kind = 'tap' | 'rapid_loaded' | 'modal_close';
interface Row {
  t: number;
  kind: Kind;
  x: number;
  y: number;
  label: string;
  rapid: string;
  vw?: number;
  vh?: number;
}

// --- rrweb schema enums ---
const EVT = { FullSnapshot: 2, Incremental: 3, Meta: 4 };
const SRC = { Mutation: 0, MouseMove: 1, MouseInteraction: 2 };
const MI_CLICK = 2;
const NT = { Document: 0, Doctype: 1, Element: 2 };
const BODY_ID = 5;
const FRAME_ID = 6;

const fieldValue = (f: { values: any }, i: number) =>
  typeof f.values?.get === 'function' ? f.values.get(i) : f.values[i];

function parseRows(frame: DataFrame): Row[] {
  const by = (n: string) => frame.fields.find((f) => f.name === n);
  const tF = by('t') ?? by('time') ?? frame.fields[0];
  const kindF = by('kind');
  const xF = by('x');
  const yF = by('y');
  const labelF = by('label');
  const rapidF = by('rapid_id') ?? by('rapid');
  const vwF = by('vw');
  const vhF = by('vh');
  const rows: Row[] = [];
  for (let i = 0; i < frame.length; i++) {
    rows.push({
      t: Number(fieldValue(tF, i)),
      kind: (kindF ? String(fieldValue(kindF, i)) : 'tap') as Kind,
      x: xF ? Number(fieldValue(xF, i)) : 0,
      y: yF ? Number(fieldValue(yF, i)) : 0,
      label: labelF ? String(fieldValue(labelF, i) ?? '') : '',
      rapid: rapidF ? String(fieldValue(rapidF, i) ?? '') : '',
      vw: vwF ? Number(fieldValue(vwF, i)) : undefined,
      vh: vhF ? Number(fieldValue(vhF, i)) : undefined,
    });
  }
  return rows.filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
}

function snapshotNode(w: number, h: number, src: string) {
  const img = {
    type: NT.Element, id: FRAME_ID, tagName: 'iframe',
    attributes: { src, width: String(w), height: String(h),
      style: `display:block;width:${w}px;height:${h}px;border:none;` },
    childNodes: [],
  };
  return {
    type: NT.Document, id: 1, childNodes: [
      { type: NT.Doctype, id: 2, name: 'html', publicId: '', systemId: '' },
      { type: NT.Element, id: 3, tagName: 'html', attributes: {}, childNodes: [
        { type: NT.Element, id: 4, tagName: 'head', attributes: {}, childNodes: [] },
        { type: NT.Element, id: BODY_ID, tagName: 'body',
          attributes: { style: `margin:0;width:${w}px;height:${h}px;position:relative;overflow:hidden;` },
          childNodes: [img] },
      ]},
    ],
  };
}

function buildEvents(rows: Row[], w: number, h: number, base: string) {
  const t0 = rows[0].t - 500;
  const url = (rapid: string, modal: boolean) =>
    `${base}?id=${encodeURIComponent(rapid)}${modal ? '&rewardOnComplete=true' : ''}`;
  const swap = (src: string, ts: number) => ({
    type: EVT.Incremental, timestamp: ts,
    data: { source: SRC.Mutation, texts: [], removes: [], adds: [],
      attributes: [{ id: FRAME_ID, attributes: { src } }] },
  });

  let curRapid = rows.find((r) => r.rapid)?.rapid ?? '';
  let modal = true;
  const events: any[] = [
    { type: EVT.Meta, timestamp: t0, data: { href: url(curRapid, modal), width: w, height: h } },
    { type: EVT.FullSnapshot, timestamp: t0,
      data: { node: snapshotNode(w, h, url(curRapid, modal)), initialOffset: { left: 0, top: 0 } } },
  ];

  for (const r of rows) {
    if (r.rapid && r.rapid !== curRapid) {
      curRapid = r.rapid;
      events.push(swap(url(curRapid, modal), r.t - 1));
    }
    if (r.kind === 'modal_close' && modal) {
      modal = false;
      events.push(swap(url(curRapid, modal), r.t));
    } else if (r.kind === 'tap') {
      const px = Math.round(r.x * w);
      const py = Math.round(r.y * h);
      events.push({ type: EVT.Incremental, timestamp: r.t - 120,
        data: { source: SRC.MouseMove, positions: [{ x: px, y: py, id: BODY_ID, timeOffset: 0 }] } });
      events.push({ type: EVT.Incremental, timestamp: r.t,
        data: { source: SRC.MouseInteraction, type: MI_CLICK, id: BODY_ID, x: px, y: py } });
    }
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

export const SessionReplayPanel: React.FC<Props> = ({ options, data, width, height, fieldConfig, id }) => {
  const styles = useStyles2(getStyles);
  const hostRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => (data.series[0] ? parseRows(data.series[0]) : []), [data.series]);

  const canvasW = rows[0]?.vw || options.canvasWidth || 390;
  const canvasH = rows[0]?.vh || options.canvasHeight || 844;
  const events = useMemo(
    () => (rows.length ? buildEvents(rows, canvasW, canvasH, options.previewBaseUrl) : []),
    [rows, canvasW, canvasH, options.previewBaseUrl]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || events.length === 0) {
      return;
    }
    host.innerHTML = '';
    // Fit the canvas into the panel.
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

  if (rows.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsStringField />;
  }

  return <div ref={hostRef} className={styles.wrap} />;
};
