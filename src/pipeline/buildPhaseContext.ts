import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeJointAngle } from '../pose/metrics';

// Computes the metrics rules read. The knee angle is taken at the already-detected
// trophy frame — rules consume this value rather than recomputing geometry. Uses
// the occlusion-robust kneeJointAngle so C3's verdict matches what trophy
// detection saw (same leg, same NaN-when-unreadable semantics).
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const tf = phases.events.trophyFrame;
  const kneeFlexionAtTrophyDeg =
    tf >= 0 && tf < poses.length ? kneeJointAngle(poses[tf]) : NaN;
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
