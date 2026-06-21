export interface Landmark { x: number; y: number; z: number; visibility: number; }

export interface PoseFrame {
  frameIndex: number;
  timestampMs: number;
  landmarks: Landmark[]; // length 33
}

export type Handedness = 'right' | 'left';
// Only 'low' / 'high' are ever produced by detectPhases; no 'medium' tier exists
// yet. Re-add it when a rule distinguishes a middle grade.
export type Confidence = 'low' | 'high';

export interface Phases {
  handedness: Handedness;
  events: { trophyFrame: number; contactFrame: number; followStartFrame: number };
  phases: {
    preparation: [number, number];
    trophy: [number, number];
    acceleration: [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
}

export interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: { kneeFlexionAtTrophyDeg: number };
}
