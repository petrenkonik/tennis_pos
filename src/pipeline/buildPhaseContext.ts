import type { PoseFrame, Phases, PhaseContext } from '../types';
import { kneeFlexion } from '../pose/metrics';

// Computes the metrics rules read. The knee angle is taken at the already-detected
// trophy frame — rules consume this value rather than recomputing geometry.
export function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext {
  const tf = phases.events.trophyFrame;
  const kneeFlexionAtTrophyDeg =
    tf >= 0 && tf < poses.length ? kneeFlexion(poses[tf]) : NaN;
  return { poses, fps, phases, metrics: { kneeFlexionAtTrophyDeg } };
}
