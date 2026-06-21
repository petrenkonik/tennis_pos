import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeJointAngle } from '../pose/metrics';

// Computes the metrics rules read. C3 measures knee bend as the DEEPEST robust
// knee flexion over the trophy->contact window (not a single frame): the trophy
// event sits on the trophy POSE, while peak leg load comes a few frames later
// during the racket drop. Reading only the trophy frame would under-report the
// bend. Falls back to the trophy frame if the window is empty; NaN when no frame
// has a readable knee (ruleC3 renders NaN as "unknown").
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const { trophyFrame, contactFrame } = phases.events;
  const lo = Math.max(0, trophyFrame);
  const hi = Math.min(contactFrame, poses.length);
  let minAngle = Infinity;
  for (let i = lo; i < hi; i++) {
    const a = kneeJointAngle(poses[i]);
    if (!Number.isNaN(a) && a < minAngle) minAngle = a;
  }
  let kneeFlexionAtTrophyDeg = Number.isFinite(minAngle) ? minAngle : NaN;
  if (Number.isNaN(kneeFlexionAtTrophyDeg) && trophyFrame >= 0 && trophyFrame < poses.length) {
    kneeFlexionAtTrophyDeg = kneeJointAngle(poses[trophyFrame]);
  }
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
