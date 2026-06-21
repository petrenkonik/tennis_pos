// All biomechanics thresholds live here, each with a source comment.
// task-rules §6: no magic literals in logic.

// Centered moving-average window for landmark trajectory smoothing.
// cv-pose-estimation skill: window ~5 at 30fps ≈ ~2-frame peak lag,
// within our ±2-frame phase-detection tolerance.
export const SMOOTH_WINDOW_FRAMES = 5;

// Racket arm considered "extended" at contact (elbowExtension >= this).
// Calibrated down from 160 on the demo clip: at the true contact frame the
// smoothed shoulder-elbow-wrist angle reads ~147 deg (overhead self-occlusion
// flattens the estimate), so 160 rejected the real contact. Provisional.
export const CONTACT_ELBOW_MIN_DEG = 140;

// Minimum normalized height rise for a racket-wrist peak to count (noise filter).
// Calibrated down from 0.05: after the mandatory trajectory smoothing the real
// contact peak on the demo clip has a prominence of only ~0.02, so 0.05 rejected
// it and forced the low-confidence global-max fallback. Provisional.
export const CONTACT_HEIGHT_PROMINENCE = 0.015;

// visibility below this => landmark unreliable (cv-pose-estimation skill, ~0.5).
export const VISIBILITY_THRESHOLD = 0.5;

// If more than this fraction of frames have low-visibility critical landmarks,
// we refuse to analyze (serve-not-recognized).
export const MAX_LOW_VIS_FRACTION = 0.5;

// UI defaults (used by App.tsx sliders). These intentionally override the
// stricter gate defaults above: amateur side-view clips shot on a phone are
// noisier than the ~0.5 used in research-grade footage, so we are more lenient
// (lower visibility bar, higher reject tolerance). task-rules §6: thresholds
// live here, not as inline literals in components.
export const DEFAULT_UI_VISIBILITY_THRESHOLD = 0.30;
export const DEFAULT_UI_MAX_LOW_VIS_FRACTION = 0.85;

// Minimum share of frames a critical landmark must be unreliable in to appear
// in the "most often missing: ..." diagnostic message on the reject path.
// Below this we consider it noise rather than the offending joint.
export const DIAGNOSTIC_MIN_LOW_FRAC = 0.2;

// Reference landmark used to decide whether the racket is "overhead" at trophy.
// MediaPipe gives no crown point, so we approximate "above the head" with a point
// that sits below the crown. `nose` is more lenient (racket needs to clear only
// the face) and is preferred for noisy amateur footage; switch to shoulders for
// stricter detection once calibration data exists.
export const TROPHY_OVERHEAD_REF_LM = 0; // LM.NOSE
export const TROPHY_OVERHEAD_REF_NAME = 'nose';

// Time-based fallback split when trophy is not expressed (tennis-serve-phases skill).
export const FALLBACK_PREP_FRACTION = 0.6;
export const FALLBACK_ACCEL_FRACTION = 0.2;

// Knee JOINT angle at trophy (hip-knee-ankle); 180° = straight, smaller = more bend.
// Named JOINT_ANGLE (not FLEXION) on purpose: a flexion angle uses the opposite
// convention (0° = straight, larger = more bend). The serve-error-detection
// skill describes the same physical range as flexion 20-35°, i.e. joint angle
// ~145-160°. Keeping the name aligned with the stored convention avoids the
// `180 - x` flip the old KNEE_FLEXION_* name implied.
// Chow et al. (2012): intermediate players ~20-35° knee flexion ≈ ~145-160° joint angle.
// Lower bound widened for amateur variability; values are provisional pending
// next-phase calibration on real serves.
export const KNEE_JOINT_ANGLE_NORMAL_RANGE_DEG: [number, number] = [140, 160];

// Angle this many degrees above the normal upper bound => "barely bent" => error (vs warn).
export const KNEE_JOINT_ANGLE_ERROR_MARGIN_DEG = 10;

// Browser memory guard for a single serve clip (ADR-0001).
export const MAX_CLIP_SECONDS = 30;

// Below this visibility a knee landmark is occluded/unreliable. kneeJointAngle
// then trusts the other leg instead. On a side view the far leg is routinely
// occluded and its angle drifts small — the old min(L,R) preferred exactly that
// noisy leg. 0.5 matches the research-grade VISIBILITY_THRESHOLD above.
export const KNEE_MIN_VISIBILITY = 0.5;
