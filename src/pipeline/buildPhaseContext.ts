import type { PoseFrame, Phases, PhaseContext, Handedness } from '../types';
import {
  kneeJointAngle, elbowExtension, racketWristHeight, tossWristHeight,
  racketElbowHeight, racketShoulderHeight, tossShoulderHeight, hipCenterX, footCenterX,
} from '../pose/metrics';
import { racketWrist, tossWrist } from '../pose/landmarks';

// Computes the metrics the rules read.
//
// C3 measures knee bend as the DEEPEST robust knee flexion over the trophy→contact
// window (not a single frame): the trophy event sits on the trophy POSE, while peak
// leg load comes a few frames later during the racket drop. Reading only the trophy
// frame would under-report the bend. Falls back to the trophy frame if the window
// is empty; NaN when no frame has a readable knee (ruleC3 renders NaN as "unknown").
//
// The remaining metrics feed rules C1, C2, TO1, TO2, T1, T2, T3, F1, F2. Each is
// NaN (or facingSign 0) when it cannot be computed; rules render that as 'unknown'
// rather than guessing (do-no-harm, task-rules §5).
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const h = phases.handedness;
  const { trophyFrame, contactFrame, followStartFrame } = phases.events;
  const last = poses.length - 1;

  // --- C3: deepest robust knee flexion over [trophy, contact) ---
  const kneeFlexionAtTrophyDeg = kneeFlexionOver(poses, trophyFrame, contactFrame);

  // --- C1: contact height above shoulder (+ corroborating elbow angle) ---
  const contactFrame_ = clampIndex(contactFrame, poses);
  const elbowExtensionAtContactDeg = contactFrame_ >= 0 ? elbowExtension(poses[contactFrame_], h) : NaN;
  const contactHeightAboveShoulder = contactFrame_ >= 0
    ? racketWristHeight(poses[contactFrame_], h) - racketShoulderHeight(poses[contactFrame_], h)
    : NaN;
  const contactHorizontalOffset = contactFrame_ >= 0
    ? racketWrist(poses[contactFrame_], h).x - hipCenterX(poses[contactFrame_])
    : NaN;

  // --- Toss apex (anchor for TO1, TO2, and the denominator of T3) ---
  // Apex = argmax toss-wrist height over [0, contactFrame). Bounded by contact so
  // the post-contact toss-arm descent can't win.
  const tossApexFrame = tossApex(poses, h, contactFrame);
  const tossApexFrame_ = tossApexFrame >= 0 ? tossApexFrame : -1;
  const tossApexHeightAboveShoulder = tossApexFrame_ >= 0
    ? tossWristHeight(poses[tossApexFrame_], h) - tossShoulderHeight(poses[tossApexFrame_], h)
    : NaN;
  const tossApexHorizontalOffset = tossApexFrame_ >= 0
    ? tossWrist(poses[tossApexFrame_], h).x - hipCenterX(poses[tossApexFrame_])
    : NaN;

  // --- T3: toss-arm drop ratio at contact (tossWristH(contact) / tossWristH(apex)) ---
  let tossArmDropAtContact = NaN;
  if (contactFrame_ >= 0 && tossApexFrame_ >= 0) {
    const apexH = tossWristHeight(poses[tossApexFrame_], h);
    const contactH = tossWristHeight(poses[contactFrame_], h);
    if (apexH > 0) tossArmDropAtContact = contactH / apexH;
  }

  // --- T1: racket drop depth = max over [trophy, contact) of (racketElbowH − racketWristH) ---
  const racketDropDepth = racketDropOver(poses, h, trophyFrame, contactFrame);

  // --- T2: acceleration-phase duration (trophy→contact) in ms ---
  const accelerationPhaseMs = fps > 0 && contactFrame > trophyFrame
    ? ((contactFrame - trophyFrame) / fps) * 1000
    : NaN;

  // --- F1: |Δx| of racket wrist from contact to follow-through end ---
  const followThroughHorizontalTravel = (contactFrame_ >= 0 && last >= 0)
    ? Math.abs(racketWrist(poses[last], h).x - racketWrist(poses[contactFrame_], h).x)
    : NaN;

  // --- F2: |hipCenter.x − footCenter.x| at the last frame of follow-through ---
  const leanAtFollowEnd = last >= 0
    ? Math.abs(hipCenterX(poses[last]) - footCenterX(poses[last]))
    : NaN;

  // --- facingSign: direction of the swing (trophy → followStart). 0 = ambiguous. ---
  const facingSign = computeFacingSign(poses, h, trophyFrame, followStartFrame);

  return {
    poses, fps, phases,
    metrics: {
      kneeFlexionAtTrophyDeg,
      elbowExtensionAtContactDeg,
      contactHeightAboveShoulder,
      contactHorizontalOffset,
      tossApexFrame: tossApexFrame_,
      tossApexHeightAboveShoulder,
      tossApexHorizontalOffset,
      tossArmDropAtContact,
      racketDropDepth,
      accelerationPhaseMs,
      followThroughHorizontalTravel,
      leanAtFollowEnd,
      facingSign,
    },
  };
}

// Deepest robust knee flexion over [lo, hi), with a single-frame fallback.
function kneeFlexionOver(poses: PoseFrame[], lo: number, hi: number): number {
  const a = Math.max(0, lo);
  const b = Math.min(hi, poses.length);
  let minAngle = Infinity;
  for (let i = a; i < b; i++) {
    const ang = kneeJointAngle(poses[i]);
    if (!Number.isNaN(ang) && ang < minAngle) minAngle = ang;
  }
  if (Number.isFinite(minAngle)) return minAngle;
  if (lo >= 0 && lo < poses.length) return kneeJointAngle(poses[lo]);
  return NaN;
}

// argmax toss-wrist height over [0, contactFrame). Returns -1 if no frame.
function tossApex(poses: PoseFrame[], h: Handedness, contactFrame: number): number {
  const end = Math.min(contactFrame, poses.length);
  let best = -1, bestH = -Infinity;
  for (let i = 0; i < end; i++) {
    const hh = tossWristHeight(poses[i], h);
    if (hh > bestH) { bestH = hh; best = i; }
  }
  return best;
}

// max over [lo, hi) of (racketElbowH − racketWristH). NaN if the window is empty.
function racketDropOver(poses: PoseFrame[], h: Handedness, lo: number, hi: number): number {
  const a = Math.max(0, lo);
  const b = Math.min(hi, poses.length);
  let maxDrop = -Infinity;
  for (let i = a; i < b; i++) {
    const drop = racketElbowHeight(poses[i], h) - racketWristHeight(poses[i], h);
    if (drop > maxDrop) maxDrop = drop;
  }
  return Number.isFinite(maxDrop) ? maxDrop : NaN;
}

// Direction of the swing: sign of the racket-wrist horizontal travel from the
// trophy pose to the start of follow-through. +1/-1 = a consistent swing
// direction (the follow-through travels across the body); 0 = no measurable
// travel (vertical clip or noise) → direction-dependent rules return 'unknown'.
function computeFacingSign(
  poses: PoseFrame[], h: Handedness, trophyFrame: number, followStartFrame: number,
): 1 | -1 | 0 {
  if (trophyFrame < 0 || followStartFrame < 0 || trophyFrame >= poses.length || followStartFrame >= poses.length) {
    return 0;
  }
  if (followStartFrame === trophyFrame) return 0;
  const dx = racketWrist(poses[followStartFrame], h).x - racketWrist(poses[trophyFrame], h).x;
  if (dx > 0) return 1;
  if (dx < 0) return -1;
  return 0;
}

function clampIndex(i: number, poses: PoseFrame[]): number {
  return i >= 0 && i < poses.length ? i : -1;
}
