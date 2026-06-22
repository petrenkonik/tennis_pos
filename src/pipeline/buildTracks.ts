import type { BoxNorm, Detection, DetectionFrame, ObjectTrack, TrackPoint } from '../types';
import {
  TRACK_SCORE_MIN, TRACK_GATING_MAX_DIST, TRACK_MAX_GAP_FRAMES, TRACK_SMOOTH_WINDOW,
} from '../constants/detection';

type Pt = { x: number; y: number };
const centerOf = (b: BoxNorm): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerpBox = (a: BoxNorm, b: BoxNorm, t: number): BoxNorm => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t,
});

function buildTrack(frames: DetectionFrame[], pick: (f: DetectionFrame) => Detection | null): ObjectTrack {
  const n = frames.length;
  const pts: (TrackPoint | null)[] = new Array(n).fill(null);

  // 1) Accept the best detection per frame, gating against teleporting jumps.
  let lastCenter: Pt | null = null;
  let realCount = 0;
  for (let i = 0; i < n; i++) {
    const d = pick(frames[i]);
    if (!d || d.score < TRACK_SCORE_MIN) continue;
    const c = centerOf(d.box);
    if (lastCenter && dist(c, lastCenter) > TRACK_GATING_MAX_DIST) continue; // spurious far box
    pts[i] = {
      frameIndex: frames[i].frameIndex, timestampMs: frames[i].timestampMs,
      center: c, box: d.box, score: d.score, interpolated: false,
    };
    lastCenter = c;
    realCount++;
  }

  // 2) Linearly interpolate short interior gaps.
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (pts[i] === null) continue;
    if (prev >= 0 && i - prev - 1 > 0 && i - prev - 1 <= TRACK_MAX_GAP_FRAMES) {
      const a = pts[prev]!, b = pts[i]!;
      for (let k = prev + 1; k < i; k++) {
        const t = (k - prev) / (i - prev);
        const box = lerpBox(a.box, b.box, t);
        pts[k] = {
          frameIndex: frames[k].frameIndex, timestampMs: frames[k].timestampMs,
          center: centerOf(box), box, score: a.score + (b.score - a.score) * t, interpolated: true,
        };
      }
    }
    prev = i;
  }

  // 3) Smooth centers with a centered moving average that skips nulls.
  const half = Math.floor(TRACK_SMOOTH_WINDOW / 2);
  const smoothed = pts.map((p, i) => {
    if (p === null) return null;
    let sx = 0, sy = 0, cnt = 0;
    for (let j = -half; j <= half; j++) {
      const q = i + j >= 0 && i + j < n ? pts[i + j] : null;
      if (q) { sx += q.center.x; sy += q.center.y; cnt++; }
    }
    return { ...p, center: { x: sx / cnt, y: sy / cnt } };
  });

  return { points: smoothed, coverage: n > 0 ? realCount / n : 0 };
}

export function buildTracks(frames: DetectionFrame[]): { ballTrack: ObjectTrack; racketTrack: ObjectTrack } {
  return {
    ballTrack: buildTrack(frames, f => f.ball),
    racketTrack: buildTrack(frames, f => f.racket),
  };
}
