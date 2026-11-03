import type { PoseFrame, Handedness, Landmark } from '../types';
import { jointAngle } from './geometry';
import { LM, racketWrist, racketElbow, racketShoulder, tossWrist } from './landmarks';
import { KNEE_MIN_VISIBILITY, VISIBILITY_THRESHOLD, BODY_HEIGHT_SCALE, PLAYER_HEIGHT_DEFAULT_CM } from '../constants/biomechanics';
import { pointSpeed, argmax } from '../pipeline/signals';

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

// 1 - y of the racket elbow; larger = elbow raised higher. Used by T1 (racket
// drop = elbow height minus wrist height over the trophy→contact window).
export function racketElbowHeight(f: PoseFrame, h: Handedness): number {
  return 1 - racketElbow(f, h).y;
}

// 1 - y of the racket shoulder; larger = shoulder raised higher. Reference for
// contact-height (C1) and racket-drop-depth (T1) measurements.
export function racketShoulderHeight(f: PoseFrame, h: Handedness): number {
  return 1 - racketShoulder(f, h).y;
}

// 1 - y of the toss shoulder; larger = higher. Reference for toss-apex height
// (TO2). For a righty the toss shoulder is the LEFT shoulder and vice-versa.
export function tossShoulderHeight(f: PoseFrame, h: Handedness): number {
  const i = h === 'right' ? LM.L_SHOULDER : LM.R_SHOULDER;
  return 1 - f.landmarks[i].y;
}

// Returns the visible hip landmark (or the more visible of the two). On a side
// view one hip is routinely occluded; trusting the occluded one drifts its x and
// corrupts every "behind the body" judgment (C2, TO1). Falls back to the
// shoulder-midpoint x when neither hip is reliable, so callers get a sane body
// center instead of noise. Returns NaN in {x,y} only when even that is missing.
export function visibleHip(f: PoseFrame): Landmark {
  const l = f.landmarks[LM.L_HIP];
  const r = f.landmarks[LM.R_HIP];
  if (l.visibility >= VISIBILITY_THRESHOLD && r.visibility >= VISIBILITY_THRESHOLD) {
    return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: 0, visibility: 1 };
  }
  if (l.visibility >= VISIBILITY_THRESHOLD) return l;
  if (r.visibility >= VISIBILITY_THRESHOLD) return r;
  // Neither hip reliable: fall back to the shoulder midpoint (still on the torso).
  const ls = f.landmarks[LM.L_SHOULDER];
  const rs = f.landmarks[LM.R_SHOULDER];
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: 0, visibility: 1 };
}

// Horizontal center of the body at the hips (image x). Used as the "body line"
// against which contact / toss horizontal offsets are judged (C2, TO1).
export function hipCenterX(f: PoseFrame): number {
  return visibleHip(f).x;
}

// Horizontal center of the feet. Used by F2 (balance): |hipCenter.x − footCenter.x|
// at follow-through end. Falls back to ankles when heels are occluded / missing,
// then to the hip center (so F2 degrades to "no lean detected" rather than NaN).
export function footCenterX(f: PoseFrame): number {
  const lh = f.landmarks[LM.L_HEEL];
  const rh = f.landmarks[LM.R_HEEL];
  const la = f.landmarks[LM.L_ANKLE];
  const ra = f.landmarks[LM.R_ANKLE];
  const heelOk = lh.visibility >= VISIBILITY_THRESHOLD && rh.visibility >= VISIBILITY_THRESHOLD;
  const ankleOk = la.visibility >= VISIBILITY_THRESHOLD && ra.visibility >= VISIBILITY_THRESHOLD;
  if (heelOk) return (lh.x + rh.x) / 2;
  if (ankleOk) return (la.x + ra.x) / 2;
  return hipCenterX(f);
}

// ============================================================================
// Layer 2 — physical units (m/s). See specs/2026-11-03-event-refinement-design.
// ============================================================================

// Estimated standing height of the player AS SEEN IN THE FRAME, in normalized
// image units. MediaPipe coordinates measure the IMAGE, not the world — the
// same swing fills a different fraction of the frame depending on camera
// distance. The player's own body is always in frame, though, so the vertical
// nose→ankle extent acts as a built-in ruler; BODY_HEIGHT_SCALE restores the
// crown/sole fraction the landmarks can't see.
//
// Why these two landmarks: the nose is the highest reliably-detected head
// point, the ankles are the lowest body points, and both sit on the midline
// of a side-view stance. Returns NaN when either end is unreadable — callers
// treat NaN as "no ruler in this frame" and report the metric as unknown.
export function bodyHeightUnits(f: PoseFrame): number {
  const nose = f.landmarks[LM.NOSE];
  const la = f.landmarks[LM.L_ANKLE];
  const ra = f.landmarks[LM.R_ANKLE];
  if (nose.visibility < VISIBILITY_THRESHOLD) return NaN;
  const lOk = la.visibility >= VISIBILITY_THRESHOLD;
  const rOk = ra.visibility >= VISIBILITY_THRESHOLD;
  if (!lOk && !rOk) return NaN;
  const ankleY = lOk && rOk ? (la.y + ra.y) / 2 : lOk ? la.y : ra.y;
  return Math.abs(nose.y - ankleY) * BODY_HEIGHT_SCALE;
}

// Peak speed of the racket wrist inside [windowFrom, windowTo] (inclusive),
// converted to meters per second.
//
// Conversion (Layer 2, educational): `pointSpeed` gives the wrist speed in
// normalized image units per second. One normalized unit corresponds to
// (playerHeight / bodyHeightUnits) real meters at that frame, so
//   speed[m/s] = speed[units/s] × (playerHeightCm / 100) / bodyHeightUnits.
// The ruler is read at the PEAK frame (where the measurement happens). The
// result is an estimate: it assumes the camera view is roughly side-on and
// vertical extent maps to real height; the UI labels it as such.
// Returns NaN when the window is empty, there are < 2 frames, or the body
// ruler is unreadable at the peak frame.
export function peakWristSpeedMs(
  poses: PoseFrame[], h: Handedness,
  windowFrom: number, windowTo: number,
  playerHeightCm: number = PLAYER_HEIGHT_DEFAULT_CM,
): number {
  const n = poses.length;
  if (n < 2) return NaN;
  const from = Math.min(Math.max(windowFrom, 0), n - 1);
  const to = Math.min(Math.max(windowTo, from), n - 1);
  if (to <= from) return NaN;

  const speeds = pointSpeed(
    poses.map(p => { const w = racketWrist(p, h); return { x: w.x, y: w.y }; }),
    poses.map(p => p.timestampMs),
  );
  const peak = argmax(speeds, from, to + 1);
  const scale = bodyHeightUnits(poses[peak]);
  if (!Number.isFinite(scale) || scale <= 0) return NaN;
  return speeds[peak] * (playerHeightCm / 100) / scale;
}
