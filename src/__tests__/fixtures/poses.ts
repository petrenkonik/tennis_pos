import type { Landmark, PoseFrame } from '../../types';
import { LM } from '../../pose/landmarks';

export function makeLandmarks(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const a: Landmark[] = [];
  for (let i = 0; i < 33; i++) a.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
  for (const k of Object.keys(overrides)) {
    const i = Number(k);
    a[i] = { ...a[i], ...overrides[i] };
  }
  return a;
}

export function makeFrame(frameIndex: number, lms: Landmark[], fps = 30): PoseFrame {
  return { frameIndex, timestampMs: (frameIndex / fps) * 1000, landmarks: lms };
}

// Knee landmarks producing progressively smaller (more bent) angles.
function knee(bend: 'straight' | 'bent' | 'deep') {
  const ax = bend === 'straight' ? 0.5 : bend === 'bent' ? 0.62 : 0.72;
  return {
    [LM.L_HIP]: { x: 0.5, y: 0.4 }, [LM.L_KNEE]: { x: 0.5, y: 0.58 }, [LM.L_ANKLE]: { x: ax, y: 0.78 },
    [LM.R_HIP]: { x: 0.5, y: 0.4 }, [LM.R_KNEE]: { x: 0.5, y: 0.58 }, [LM.R_ANKLE]: { x: ax, y: 0.78 },
  };
}
// Racket arm (right) with given wrist/elbow y; shoulder fixed at 0.55.
function arm(wristY: number, elbowY: number) {
  return {
    [LM.R_SHOULDER]: { x: 0.5, y: 0.55 },
    [LM.R_ELBOW]: { x: 0.5, y: elbowY },
    [LM.R_WRIST]: { x: 0.5, y: wristY },
  };
}
const nose = { [LM.NOSE]: { x: 0.5, y: 0.5 } };

// Toss arm (left wrist for a righty) at a given height-y. Lower y = raised higher.
function toss(wristY: number) {
  return { [LM.L_WRIST]: { x: 0.5, y: wristY } };
}

// Deterministic right-handed serve: trophy=2, contact=4, followStart=6.
export function buildHappyServe(): PoseFrame[] {
  const specs: Array<[ 'straight'|'bent'|'deep', number, number ]> = [
    ['straight', 0.70, 0.62], // f0 prep, racket low
    ['bent',     0.55, 0.50], // f1 rising (not overhead)
    ['deep',     0.45, 0.42], // f2 trophy: overhead + deepest knee
    ['bent',     0.30, 0.28], // f3 overhead, rising
    ['straight', 0.15, 0.35], // f4 contact: highest + straight elbow
    ['straight', 0.40, 0.45], // f5 descending (still overhead)
    ['straight', 0.62, 0.58], // f6 follow start: wrist below shoulder (0.55)
  ];
  return specs.map(([bend, wY, eY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY) })));
}

// Right-handed serve where the DEEPEST knee bend lands AFTER contact (the landing
// crouch at f5-f6) while the racket wrist is still above the nose. The old
// "deepest knee among overhead frames" rule picked f5; the contact-bounded rule
// must pick the real trophy at f2. trophy=2, contact=4, followStart=6.
export function buildLandingCrouchServe(): PoseFrame[] {
  // [knee bend, racket wristY, racket elbowY, toss wristY]
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep, racket low, toss low
    ['bent',     0.55, 0.50, 0.45], // f1 rising (not overhead), toss rising
    ['bent',     0.45, 0.42, 0.15], // f2 TROPHY: overhead, toss UP, knee bent
    ['bent',     0.30, 0.28, 0.30], // f3 overhead, rising, toss dropping
    ['straight', 0.12, 0.32, 0.55], // f4 CONTACT: highest + straight elbow
    ['deep',     0.40, 0.45, 0.70], // f5 post-contact: overhead, DEEPEST knee (landing load)
    ['deep',     0.62, 0.58, 0.75], // f6 follow start: wrist below shoulder, knee deep
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}

// Right-handed serve isolating the toss-arm gate: f1 is overhead with the deepest
// knee but the toss arm is DOWN (decoy); f2 is the real trophy (toss arm UP, knee
// less bent). The gate must reject f1 and pick f2. trophy=2, contact=4, followStart=5.
export function buildTossGateServe(): PoseFrame[] {
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep
    ['deep',     0.45, 0.42, 0.70], // f1 overhead, DEEP knee, toss DOWN (decoy)
    ['bent',     0.44, 0.41, 0.15], // f2 TROPHY: overhead, BENT knee, toss UP
    ['bent',     0.30, 0.28, 0.30], // f3 overhead, rising
    ['straight', 0.12, 0.32, 0.55], // f4 CONTACT: highest + straight elbow
    ['straight', 0.62, 0.58, 0.60], // f5 follow start: wrist below shoulder
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}

// Right-handed serve where the toss-arm peak (f2) is the trophy pose, but a LATER
// overhead frame (f4) has a deeper knee bend (the racket-drop load). f3 and f4 are
// both within the OLD algorithm's 0.10 toss-band (floor = peak tossH 0.90 - 0.10 =
// 0.80), so the old "deepest knee within the toss band" rule admits f3 (tossH 0.87)
// and f4 (tossH 0.85) and picks f4 for its deeper knee. The NEW toss-peak anchor
// instead picks f2 (nearest the toss-arm peak, tie-break never reached) - this is
// what makes the test discriminate the two algorithms.
// Also exercises the C3 trophy->contact knee window (deepest in [2,5) is f4).
// trophy=2, contact=5, followStart=6.
export function buildKneeAfterTrophyServe(): PoseFrame[] {
  const specs: Array<['straight'|'bent'|'deep', number, number, number]> = [
    ['straight', 0.70, 0.62, 0.70], // f0 prep
    ['bent',     0.55, 0.50, 0.45], // f1 rising (not overhead), toss rising
    ['bent',     0.45, 0.42, 0.10], // f2 TROPHY: overhead, toss arm PEAK (tossH 0.90)
    ['bent',     0.42, 0.40, 0.13], // f3 overhead, toss still within old 0.10 band (tossH 0.87)
    ['deep',     0.40, 0.38, 0.15], // f4 overhead, within old band + DEEPEST knee (tossH 0.85)
    ['straight', 0.12, 0.32, 0.55], // f5 CONTACT: highest + straight elbow
    ['straight', 0.62, 0.58, 0.60], // f6 follow start: wrist below shoulder
  ];
  return specs.map(([bend, wY, eY, tY], i) =>
    makeFrame(i, makeLandmarks({ ...nose, ...knee(bend), ...arm(wY, eY), ...toss(tY) })));
}

// Right-handed serve where the only racket-wrist height peak (f4) has a BENT
// elbow (~98 deg), so no peak clears CONTACT_ELBOW_MIN_DEG: detectContact takes
// the global-max fallback and returns confident=false. Exercises the degraded
// path (the fallback branch + the contact-not-confident trophy bound). The result
// is still well-ordered and flagged confidence 'low'. trophy=2, contact=4, follow=6.
export function buildNoConfidentContactServe(): PoseFrame[] {
  const frames: Array<Record<number, Partial<Landmark>>> = [
    { ...nose, ...knee('straight'), ...arm(0.70, 0.62), ...toss(0.70) }, // f0 prep, height .30
    { ...nose, ...knee('bent'),     ...arm(0.55, 0.52), ...toss(0.45) }, // f1 rising (not overhead), .45
    { ...nose, ...knee('bent'),     ...arm(0.45, 0.42), ...toss(0.12) }, // f2 TROPHY overhead, toss peak, .55
    { ...nose, ...knee('bent'),     ...arm(0.40, 0.42), ...toss(0.40) }, // f3 overhead, .60
    { ...nose, ...knee('straight'), ...arm(0.20, 0.35), [LM.R_ELBOW]: { x: 0.65, y: 0.35 }, ...toss(0.55) }, // f4 height peak, BENT elbow, .80
    { ...nose, ...knee('straight'), ...arm(0.45, 0.50), ...toss(0.60) }, // f5 descent (still above shoulder), .55
    { ...nose, ...knee('straight'), ...arm(0.62, 0.58), ...toss(0.60) }, // f6 follow start: wrist below shoulder, .38
  ];
  return frames.map((o, i) => makeFrame(i, makeLandmarks(o)));
}
