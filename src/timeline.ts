export interface Tap {
  t: number; // epoch ms
  x: number; // 0..1 of viewport
  y: number;
}

export interface Segment {
  s: number; // play-time start (ms)
  e: number; // play-time end
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface Timeline {
  segments: Segment[];
  ripples: Array<{ pt: number; x: number; y: number }>;
  duration: number;
}

// Re-base the (possibly clock-skewed, gap-heavy) tap stream onto a compressed
// "play-time" axis so dead time between taps doesn't dominate the replay.
export function buildTimeline(taps: Tap[], maxIdleMs: number): Timeline {
  const segments: Segment[] = [];
  const ripples: Array<{ pt: number; x: number; y: number }> = [];
  let pt = 0;
  ripples.push({ pt: 0, x: taps[0].x, y: taps[0].y });
  for (let i = 1; i < taps.length; i++) {
    let gap = taps[i].t - taps[i - 1].t;
    if (!Number.isFinite(gap) || gap < 0) {
      gap = 250; // skew guard: out-of-order timestamps fall back to a nominal step
    }
    if (maxIdleMs > 0 && gap > maxIdleMs) {
      gap = maxIdleMs;
    }
    const s = pt;
    pt += Math.max(gap, 1);
    segments.push({ s, e: pt, fromX: taps[i - 1].x, fromY: taps[i - 1].y, toX: taps[i].x, toY: taps[i].y });
    ripples.push({ pt, x: taps[i].x, y: taps[i].y });
  }
  return { segments, ripples, duration: pt + 1200 };
}

export function cursorAt(tl: Timeline, p: number): { x: number; y: number } {
  if (!tl.segments.length) {
    return { x: tl.ripples[0]?.x ?? 0.5, y: tl.ripples[0]?.y ?? 0.5 };
  }
  if (p <= tl.segments[0].s) {
    const f = tl.segments[0];
    return { x: f.fromX, y: f.fromY };
  }
  for (const seg of tl.segments) {
    if (p >= seg.s && p <= seg.e) {
      const r = seg.e === seg.s ? 1 : (p - seg.s) / (seg.e - seg.s);
      return { x: seg.fromX + (seg.toX - seg.fromX) * r, y: seg.fromY + (seg.toY - seg.fromY) * r };
    }
  }
  const last = tl.segments[tl.segments.length - 1];
  return { x: last.toX, y: last.toY };
}
