import type { Landmark, PoseFrame, Handedness } from '../types';

// MediaPipe BlazePose 33-landmark indices (see skills/cv-pose-estimation).
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
} as const;

// Right-handed player: racket = right arm. Left-handed: racket = left arm.
// NOTE: MediaPipe labels left/right from the camera's mirror view; this mapping
// is the single source of truth and is locked by landmarks.test.ts.
export function racketWrist(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_WRIST : LM.L_WRIST];
}
export function tossWrist(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.L_WRIST : LM.R_WRIST];
}
export function racketElbow(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_ELBOW : LM.L_ELBOW];
}
export function racketShoulder(f: PoseFrame, h: Handedness): Landmark {
  return f.landmarks[h === 'right' ? LM.R_SHOULDER : LM.L_SHOULDER];
}
