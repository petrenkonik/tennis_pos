import type { PoseFrame, Phases, Handedness, Confidence } from '../types';
import { LM, racketWrist, racketShoulder } from '../pose/landmarks';
import { kneeFlexion, elbowExtension, racketWristHeight } from '../pose/metrics';
import { localMaxima } from '../pose/geometry';
import {
  CONTACT_ELBOW_MIN_DEG, CONTACT_HEIGHT_PROMINENCE, VISIBILITY_THRESHOLD,
  MAX_LOW_VIS_FRACTION, FALLBACK_PREP_FRACTION, FALLBACK_ACCEL_FRACTION,
  DIAGNOSTIC_MIN_LOW_FRAC, TROPHY_OVERHEAD_REF_LM,
} from '../constants/biomechanics';

// Machine-readable diagnostic codes that the UI (App.tsx) resolves via t().
// Never embed display strings here — the detection layer is locale-agnostic.
export type ServeRejectCode = 'too-few-frames' | 'low-visibility';

export interface ServeRejectDetail {
  code: ServeRejectCode;
  params: Record<string, unknown>;
}

export class ServeNotRecognizedError extends Error {
  detail: ServeRejectDetail;
  constructor(detail: ServeRejectDetail) {
    super(detail.code);
    this.name = 'ServeNotRecognizedError';
    this.detail = detail;
  }
}

const CRITICAL_LM = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST, LM.L_KNEE, LM.R_KNEE];

// Stable machine keys for the worst-offender diagnostic (translated in the UI).
const CRITICAL_LM_KEYS: Record<number, string> = {
  [LM.L_SHOULDER]: 'left-shoulder',
  [LM.R_SHOULDER]: 'right-shoulder',
  [LM.L_WRIST]: 'left-wrist',
  [LM.R_WRIST]: 'right-wrist',
  [LM.L_KNEE]: 'left-knee',
  [LM.R_KNEE]: 'right-knee',
};

const pct = (x: number) => Math.round(x * 100);

// Per-critical-landmark share of frames where it is below the visibility threshold,
// worst offenders first. Used only on the failure path to explain WHY a serve was rejected.
export function visibilityBreakdown(
  poses: PoseFrame[],
  visTh: number = VISIBILITY_THRESHOLD,
): Array<{ key: string; lowFrac: number }> {
  return CRITICAL_LM
    .map(i => ({
      key: CRITICAL_LM_KEYS[i],
      lowFrac: poses.filter(f => f.landmarks[i].visibility < visTh).length / poses.length,
    }))
    .sort((a, b) => b.lowFrac - a.lowFrac);
}

// Runtime overrides for the visibility gate (UI-tunable). Omitted fields fall
// back to the calibrated defaults in constants/biomechanics.ts.
export interface GateOptions {
  visibilityThreshold?: number;
  maxLowVisFraction?: number;
}

function assemble(
  h: Handedness, trophyFrame: number, contactFrame: number,
  followStartFrame: number, last: number, confidence: Confidence,
): Phases {
  const accelStart = Math.min(trophyFrame + 1, contactFrame);
  return {
    handedness: h,
    events: { trophyFrame, contactFrame, followStartFrame },
    phases: {
      preparation: [0, trophyFrame],
      trophy: [trophyFrame, accelStart],
      acceleration: [accelStart, contactFrame],
      followThrough: [contactFrame, last],
    },
    confidence,
  };
}

function timeBasedFallback(poses: PoseFrame[], h: Handedness): Phases {
  const last = poses.length - 1;
  const trophyFrame = Math.round(last * FALLBACK_PREP_FRACTION);
  const contactFrame = Math.round(last * (FALLBACK_PREP_FRACTION + FALLBACK_ACCEL_FRACTION));
  return assemble(h, trophyFrame, contactFrame, contactFrame, last, 'low');
}

export function detectPhases(
  poses: PoseFrame[], h: Handedness, gate: GateOptions = {},
): Phases {
  const visTh = gate.visibilityThreshold ?? VISIBILITY_THRESHOLD;
  const maxLowVis = gate.maxLowVisFraction ?? MAX_LOW_VIS_FRACTION;

  if (poses.length < 2) {
    throw new ServeNotRecognizedError({
      code: 'too-few-frames',
      params: { n: poses.length },
    });
  }

  // 1) visibility gate
  const lowVis = poses.filter(f =>
    CRITICAL_LM.some(i => f.landmarks[i].visibility < visTh)).length;
  if (lowVis / poses.length > maxLowVis) {
    const worst = visibilityBreakdown(poses, visTh)
      .filter(b => b.lowFrac > DIAGNOSTIC_MIN_LOW_FRAC)
      .map(b => ({ key: b.key, pct: pct(b.lowFrac) }));
    throw new ServeNotRecognizedError({
      code: 'low-visibility',
      params: {
        lowPct: pct(lowVis / poses.length),
        total: poses.length,
        maxPct: pct(maxLowVis),
        visTh: visTh.toFixed(2),
        worst,
      },
    });
  }

  const last = poses.length - 1;

  // 2) trophy = min knee flexion among "racket overhead" frames
  let trophyFrame = -1, minAngle = Infinity;
  for (let i = 0; i <= last; i++) {
    const overhead = racketWrist(poses[i], h).y < poses[i].landmarks[TROPHY_OVERHEAD_REF_LM].y;
    if (!overhead) continue;
    const ang = kneeFlexion(poses[i]);
    if (ang < minAngle) { minAngle = ang; trophyFrame = i; }
  }
  if (trophyFrame < 0) return timeBasedFallback(poses, h);

  let confidence: Confidence = 'high';

  // 3) contact = highest qualifying racket-wrist peak after trophy
  const heights = poses.map(p => racketWristHeight(p, h));
  const peaks = localMaxima(heights, CONTACT_HEIGHT_PROMINENCE).filter(i => i > trophyFrame);
  let contactFrame = -1, best = -Infinity;
  for (const i of peaks) {
    if (elbowExtension(poses[i], h) >= CONTACT_ELBOW_MIN_DEG && heights[i] > best) {
      best = heights[i]; contactFrame = i;
    }
  }
  if (contactFrame < 0) {
    confidence = 'low'; // no clean peak: take global max height after trophy
    for (let i = trophyFrame + 1; i <= last; i++) {
      if (heights[i] > best) { best = heights[i]; contactFrame = i; }
    }
    if (contactFrame < 0) contactFrame = Math.min(trophyFrame + 1, last);
  }

  // 4) follow-through start = first post-contact frame with wrist below shoulder
  let followStartFrame = -1;
  for (let i = contactFrame + 1; i <= last; i++) {
    if (racketWrist(poses[i], h).y > racketShoulder(poses[i], h).y) { followStartFrame = i; break; }
  }
  if (followStartFrame < 0) { followStartFrame = last; confidence = 'low'; }

  // 5) invariant guard: trophy < contact < followStart, each pair at least 1 apart.
  // Order alone is not enough — without the +1 floor the contact/trophy frames
  // can collapse onto each other and produce degenerate [n, n] phase intervals.
  const clampMinWidths = (): void => {
    contactFrame = Math.min(Math.max(contactFrame, trophyFrame + 1), last);
    followStartFrame = Math.min(Math.max(followStartFrame, contactFrame + 1), last);
  };
  if (!(trophyFrame < contactFrame && contactFrame < followStartFrame)) {
    confidence = 'low';
    clampMinWidths();
  } else if (contactFrame === trophyFrame + 1 && contactFrame === followStartFrame) {
    // ordered but degenerate (collapsed triple) — widen defensively
    confidence = 'low';
    clampMinWidths();
  }

  return assemble(h, trophyFrame, contactFrame, followStartFrame, last, confidence);
}
