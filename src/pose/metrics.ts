import type { PoseFrame, Handedness } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder, tossWrist } from './landmarks';
import { KNEE_MIN_VISIBILITY } from '../constants/biomechanics';

// Knee JOINT angle (180° = straight, smaller = more bent) of the more-trustworthy
// leg. On a side view the far leg is routinely occluded and its estimated angle
// drifts small, so we pick the more-VISIBLE knee rather than the more-bent one
// (the old min(L,R) preferred exactly the noisy occluded leg). Returns NaN when
// neither knee clears KNEE_MIN_VISIBILITY — callers treat NaN as "knee unknown".
export function kneeJointAngle(f: PoseFrame): number {
  const lVis = f.landmarks[LM.L_KNEE].visibility;
  const rVis = f.landmarks[LM.R_KNEE].visibility;
  const lOk = lVis >= KNEE_MIN_VISIBILITY;
  const rOk = rVis >= KNEE_MIN_VISIBILITY;
  if (!lOk && !rOk) return NaN;
  const left = jointAngle(f.landmarks[LM.L_HIP], f.landmarks[LM.L_KNEE], f.landmarks[LM.L_ANKLE]);
  const right = jointAngle(f.landmarks[LM.R_HIP], f.landmarks[LM.R_KNEE], f.landmarks[LM.R_ANKLE]);
  if (lOk && !rOk) return left;
  if (rOk && !lOk) return right;
  if (lVis > rVis) return left;
  if (rVis > lVis) return right;
  // Equally visible (both trustworthy): fall back to the more-bent leg.
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

// Toss-arm wrist height (1 - y); larger = arm raised higher. Used by the trophy
// toss-arm-peak anchor.
export function tossWristHeight(f: PoseFrame, h: Handedness): number {
  return 1 - tossWrist(f, h).y;
}
