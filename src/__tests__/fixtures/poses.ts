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
