import type { PoseFrame, Handedness } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder } from './landmarks';

// Smaller angle = more bend (180° = straight). Take the more-bent leg.
export function kneeFlexion(f: PoseFrame): number {
  const left = jointAngle(f.landmarks[LM.L_HIP], f.landmarks[LM.L_KNEE], f.landmarks[LM.L_ANKLE]);
  const right = jointAngle(f.landmarks[LM.R_HIP], f.landmarks[LM.R_KNEE], f.landmarks[LM.R_ANKLE]);
  return Math.min(left, right);
}

// 180° = fully extended racket arm.
export function elbowExtension(f: PoseFrame, h: Handedness): number {
  return jointAngle(racketShoulder(f, h), racketElbow(f, h), racketWrist(f, h));
}

// Image y grows downward; invert so larger = higher.
export function racketWristHeight(f: PoseFrame, h: Handedness): number {
  return 1 - racketWrist(f, h).y;
}
