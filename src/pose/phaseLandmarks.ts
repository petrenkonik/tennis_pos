import { LM } from './landmarks';
import type { PhaseKey } from '../lib/phaseTime';

/**
 * Which body parts dominate each serve phase — used to highlight the relevant
 * bones/joints on the skeleton overlay when a phase block is hovered/selected.
 *
 * Derived from the biomechanics reference (skills/tennis-serve-phases and
 * docs/biomechanics/serve-phases.md): the parts that move or bear load during
 * that phase. We list both sides for the symmetric parts (legs, torso) and
 * keep the racket/toss arm generic (both L and R) because the overlay draws
 * both anyway and handedness only changes which is active — highlighting both
 * is harmless and avoids a handedness lookup in the render loop.
 */
export const PHASE_LANDMARKS: Record<PhaseKey, number[]> = {
  // Ball toss + knee bend: legs drive, the toss arm raises the ball.
  preparation: [LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
                LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST],

  // Racket behind the head, knees bent, toss arm extended: full body is engaged.
  trophy: [LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
           LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW,
           LM.L_WRIST, LM.R_WRIST],

  // Acceleration to contact: the racket arm extends to strike.
  acceleration: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW,
                 LM.L_WRIST, LM.R_WRIST],

  // Follow-through: the racket travels down and across; torso/balance finishes.
  followThrough: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST,
                  LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE],
};
