import { buildTimeline, cursorAt, Tap } from './timeline';

const taps = (...xs: Array<[number, number, number]>): Tap[] => xs.map(([t, x, y]) => ({ t, x, y }));

describe('buildTimeline', () => {
  it('starts play-time at 0 and emits one ripple per tap', () => {
    const tl = buildTimeline(taps([1000, 0.1, 0.2], [1500, 0.5, 0.6], [3000, 0.9, 0.1]), 2500);
    expect(tl.ripples).toHaveLength(3);
    expect(tl.ripples[0].pt).toBe(0);
    expect(tl.segments).toHaveLength(2);
  });

  it('compresses idle gaps to maxIdleMs', () => {
    const tl = buildTimeline(taps([0, 0, 0], [60000, 1, 1]), 2500);
    expect(tl.segments[0].e - tl.segments[0].s).toBe(2500);
  });

  it('keeps gaps shorter than maxIdleMs intact', () => {
    const tl = buildTimeline(taps([0, 0, 0], [800, 1, 1]), 2500);
    expect(tl.segments[0].e - tl.segments[0].s).toBe(800);
  });

  it('survives clock skew (negative / non-finite gaps) with a nominal step', () => {
    const tl = buildTimeline(taps([5000, 0, 0], [1000, 1, 1]), 2500); // out-of-order
    expect(tl.segments[0].e - tl.segments[0].s).toBe(250);
    expect(tl.duration).toBeGreaterThan(0);
  });

  it('disables compression when maxIdleMs is 0', () => {
    const tl = buildTimeline(taps([0, 0, 0], [60000, 1, 1]), 0);
    expect(tl.segments[0].e - tl.segments[0].s).toBe(60000);
  });
});

describe('cursorAt', () => {
  const tl = buildTimeline(taps([0, 0, 0], [1000, 1, 1]), 5000);

  it('sits on the first tap before playback', () => {
    expect(cursorAt(tl, 0)).toEqual({ x: 0, y: 0 });
  });

  it('interpolates linearly mid-segment', () => {
    expect(cursorAt(tl, 500)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('rests on the last tap past the end', () => {
    expect(cursorAt(tl, 999999)).toEqual({ x: 1, y: 1 });
  });
});
