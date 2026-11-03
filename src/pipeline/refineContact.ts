import type { PoseFrame, Phases, ObjectTrack } from '../types';
import { LM, racketWrist } from '../pose/landmarks';
import { tossWristHeight } from '../pose/metrics';
import { pointSpeed, argmax } from './signals';
import { CONTACT_TRACK_COVERAGE_MIN, CONTACT_AGREEMENT_FRAMES } from '../constants/biomechanics';

// Track-verified contact refinement (Layer 1, cycle B of the detection layer).
//
// `detectPhases` is a pure POSE function: it finds contact as the highest
// racket-wrist peak with an extended elbow. That is an indirect reading of
// "when was the ball hit" — it says when the hand moved fastest/highest, not
// when the ball actually met the strings. This module adds the DIRECT reading:
// the frame where the ball center and racket center come closest, taken from
// the object tracks built by `buildTracks`. Composition happens in
// `analyzeServe` (pose phases in → refined phases out), so both steps stay
// independently testable pure functions.
//
// The cascade, step by step:
//   1. COVERAGE GATE — refinement runs only when BOTH tracks cover at least
//      CONTACT_TRACK_COVERAGE_MIN of the clip with real detections. Below that
//      the minimum-distance scan is dominated by gaps, not measurements, so we
//      keep the pose estimate and attach a diagnostic the UI can explain.
//   2. TRACK CANDIDATE — inside [tossStartFrame, poseContactFrame] find the
//      frame of minimum ball↔racket center distance. The window keeps the scan
//      inside the plausible hit zone: before the toss starts there is no ball
//      flight yet, after the pose contact the ball is already leaving.
//   3. CROSS-CHECK — an independent second signal: the peak of the smoothed
//      racket-wrist speed after the toss apex, constrained to frames where the
//      wrist is above the shoulder midline (contact happens up there; the
//      biggest speed excursion below the shoulder is backswing or landing, not
//      the hit). Two INDEPENDENT measurements agreeing within
//      CONTACT_AGREEMENT_FRAMES is what earns confidence 'high' — and the
//      track frame becomes the contact frame, because it is the direct ball
//      measurement.
//   4. DISAGREEMENT — the pose contact stays, confidence drops to 'low', and a
//      machine-readable diagnostic ('contact-track-mismatch') is attached. We
//      never silently swap the timing: a wrong "refinement" is worse than an
//      honest low-confidence pose estimate.
//
// A candidate at or before the trophy frame is rejected as implausible: the
// ball can pass near a hanging racket during the backswing, and that is not a
// serve contact.
export function refineContactWithTracks(
  phases: Phases,
  poses: PoseFrame[],
  ballTrack: ObjectTrack,
  racketTrack: ObjectTrack,
): Phases {
  const n = poses.length;

  // 1) Coverage gate.
  const tracksReliable = ballTrack.coverage >= CONTACT_TRACK_COVERAGE_MIN
    && racketTrack.coverage >= CONTACT_TRACK_COVERAGE_MIN;
  if (!tracksReliable || n === 0) {
    return { ...phases, contactDiagnostic: 'contact-tracks-sparse' };
  }

  // 2) Track candidate: min ball↔racket distance in the plausible hit zone.
  const from = Math.min(Math.max(phases.events.tossStartFrame, 0), n - 1);
  const to = Math.min(Math.max(phases.events.contactFrame, 0), n - 1);
  let candFrame = -1;
  let bestDist = Infinity;
  for (let i = from; i <= to; i++) {
    const b = ballTrack.points[i];
    const r = racketTrack.points[i];
    if (!b || !r) continue; // uncovered frame — no measurement here
    const d = Math.hypot(b.center.x - r.center.x, b.center.y - r.center.y);
    if (d < bestDist) { bestDist = d; candFrame = i; }
  }
  if (candFrame < 0) {
    // Tracks are nominally covered, but never simultaneously inside the hit
    // window → not enough evidence there.
    return { ...phases, contactDiagnostic: 'contact-tracks-sparse' };
  }
  if (candFrame <= phases.events.trophyFrame) {
    // Closest approach happened during the backswing, not at the hit.
    return { ...phases, confidence: 'low', contactDiagnostic: 'contact-track-mismatch' };
  }

  // 3) Cross-check: wrist-speed peak after the toss apex, in the high zone.
  const h = phases.handedness;
  const speeds = pointSpeed(
    poses.map(p => { const w = racketWrist(p, h); return { x: w.x, y: w.y }; }),
    poses.map(p => p.timestampMs),
  );
  const tossHeights = poses.map(p => tossWristHeight(p, h));
  // Toss apex = highest toss-wrist point inside the same window; the upward
  // swing starts after it.
  const apex = argmax(tossHeights, from, to + 1);
  const searchFrom = Math.min(apex, n - 1);
  // High zone: racket wrist above the shoulder midline.
  const highIdx: number[] = [];
  for (let i = searchFrom; i < n; i++) {
    const shoulderMidY =
      (poses[i].landmarks[LM.L_SHOULDER].y + poses[i].landmarks[LM.R_SHOULDER].y) / 2;
    if (racketWrist(poses[i], h).y < shoulderMidY) highIdx.push(i);
  }
  const wristPeak = highIdx.length > 0
    ? argmax(speeds, highIdx[0], highIdx[highIdx.length - 1] + 1)
    : argmax(speeds, searchFrom, n);

  if (Math.abs(candFrame - wristPeak) <= CONTACT_AGREEMENT_FRAMES) {
    // Two independent measurements agree — adopt the direct ball reading and
    // rebuild the phase intervals around the (possibly shifted) contact frame.
    const events = { ...phases.events, contactFrame: candFrame };
    const accelStart = Math.min(events.trophyFrame + 1, events.contactFrame);
    const last = phases.phases.followThrough[1];
    return {
      ...phases,
      events,
      phases: {
        preparation: [0, events.trophyFrame],
        trophy: [events.trophyFrame, accelStart],
        acceleration: [accelStart, events.contactFrame],
        followThrough: [events.contactFrame, last],
      },
      confidence: 'high',
      contactSource: 'tracks',
      contactDiagnostic: null,
    };
  }

  // 4) Disagreement: keep the pose estimate, downgrade confidence.
  return { ...phases, confidence: 'low', contactDiagnostic: 'contact-track-mismatch' };
}
