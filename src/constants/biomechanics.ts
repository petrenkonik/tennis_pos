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

// --- Toss-start event (detectTossStart) -------------------------------------
// The toss lift is detected from the SMOOTHED VERTICAL VELOCITY of the toss
// wrist, not from any single frame: "the arm started rising" is a motion
// trend, not a pose. We scan the smoothed height-derivative series for the
// first frame whose upward rate exceeds this threshold.
//
// Units and sign convention: the code works with toss-wrist HEIGHT (1 − y), so
// "up" is positive and the threshold is positive 0.35 (in the raw image-y
// convention the same threshold would read −0.35; see the spec's threshold
// table). In normalized units, 0.35 frame-heights/s means the wrist travels a
// third of the frame in one second — far faster than idle sway or camera
// shake, and comfortably below a real toss lift (~2-4 frame-heights/s at
// 30 fps on the demo clip and synthetic serves).
// Calibration: empirical, tuned on the demo clip + synthetic serves.
// PROVISIONAL — recalibrate on a labeled serve set (tracked follow-up).
export const TOSS_START_VELOCITY_THRESHOLD = 0.35;

// When no frame crosses the threshold (the toss lift is hidden by noise, or
// the clip starts mid-motion), fall back to a time split: preparation on a
// side-view serve spans roughly [0, 0.6n) (FALLBACK_PREP_FRACTION), so the
// interior third of the clip is the most plausible toss moment. The event is
// still reported (the UI needs a marker position) but forces confidence 'low'.
export const TOSS_START_FALLBACK_FRACTION = 1 / 3;

// --- Track-verified contact (refineContactWithTracks) ------------------------
// Minimum track coverage (real detections / total frames) required of BOTH the
// ball and the racket tracks before their closest-approach frame may refine
// the contact timing. Matches the detection-layer success bar ("ball detected
// in ≥50% of frames of the toss→contact window"): below half the frames, the
// minimum-distance scan is dominated by gaps rather than measurements.
// See the event-refinement spec, threshold table.
export const CONTACT_TRACK_COVERAGE_MIN = 0.5;

// Agreement window (± frames) between the track candidate (ball↔racket closest
// approach) and the wrist-speed peak for the refinement to be trusted.
// ~0.1 s at 30 fps: wider than the ±2-frame phase-detection tolerance (both
// signals carry ≈2 frames of smoothing lag), tighter than a phase width.
// See the event-refinement spec, threshold table.
export const CONTACT_AGREEMENT_FRAMES = 3;

// --- Layer 2: swing speed in physical units (peakWristSpeedMs) ---------------
// MediaPipe coordinates measure the IMAGE, not the world. To convert speed
// into m/s we read the player's body extent in frame (nose→ankle mid) as a
// built-in ruler. The nose sits below the crown and the ankle-mid above the
// sole, so the measured extent UNDER-reports standing height; this scale
// restores the missing head/foot fraction. Geometry estimate, provisional
// like the rest — see the event-refinement spec, threshold table.
export const BODY_HEIGHT_SCALE = 1.25;

// Default real-world height for the m/s conversion when the user has not set
// their own (population-average). Per-user override lives in the UI settings
// (App.tsx) — a wrong value scales every m/s number linearly, so the UI marks
// the metric as an estimate based on this setting.
export const PLAYER_HEIGHT_DEFAULT_CM = 175;

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

// ============================================================================
// Serve error rules (T1, T2, T3, TO1, TO2, C1, C2, F1, F2)
// ----------------------------------------------------------------------------
// All values below are PROVISIONAL. They are estimated in normalized image
// coordinates (BlazePose x,y ∈ [0,1], y grows downward) from the geometry of a
// side-view serve, NOT yet calibrated on labeled serves. Calibration on a set
// of ≥5 serves per verdict class is a tracked follow-up (see the spec). Until
// then rules degrade to 'unknown' on any uncomputable metric — never to a wrong
// verdict — so mis-calibration produces soft gaps, not false positives.
// ============================================================================

// --- C1: contact too low (wrist height above racket shoulder @ contact) ----
// Reach at contact: a good contact happens with the arm extended well above the
// shoulder. Below WARN the contact is increasingly low / arm bent; below ERROR
// it is clearly low. Heights are fractions of frame height (1 - y).
// PROVISIONAL — geometry estimate; a fully-extended overhead reach on a typical
// side-view clip clears the shoulder by ~0.10-0.15 of frame height.
export const CONTACT_HEIGHT_ABOVE_SHOULDER_WARN = 0.05;
export const CONTACT_HEIGHT_ABOVE_SHOULDER_ERROR = 0.02;

// --- C2: contact behind the body (racketWrist.x − hipCenter.x @ contact) ----
// The contact is "behind" when its horizontal offset opposes facingSign. The
// magnitude (fraction of frame width) decides warn vs error. Near-zero offset
// (within WARN) counts as in-line. PROVISIONAL — geometry estimate.
export const CONTACT_HORIZONTAL_BEHIND_WARN = 0.03;
export const CONTACT_HORIZONTAL_BEHIND_ERROR = 0.05;

// --- TO2: toss too low (toss-wrist apex height above toss shoulder) --------
// A toss with enough time for a full swing peaks well above the shoulder; below
// WARN it is rushed, below ERROR it is far too low. Fraction of frame height.
// PROVISIONAL — a good amateur toss peaks ~0.15-0.25 above the shoulder.
export const TOSS_APEX_HEIGHT_ABOVE_SHOULDER_WARN = 0.15;
export const TOSS_APEX_HEIGHT_ABOVE_SHOULDER_ERROR = 0.08;

// --- TO1: toss too far back (tossWrist.x − hipCenter.x @ apex) --------------
// Same sign/magnitude scheme as C2, applied to the toss apex. PROVISIONAL.
export const TOSS_APEX_HORIZONTAL_BEHIND_WARN = 0.03;
export const TOSS_APEX_HORIZONTAL_BEHIND_ERROR = 0.05;

// --- T3: toss arm drops too early (tossWristH(contact) / tossWristH(apex)) --
// Ratio in [0,1]: 1.0 = arm still at apex height at contact, lower = more drop.
// Below WARN the arm has dropped noticeably; below ERROR it has collapsed.
// Scale-free across players who toss to different absolute heights. PROVISIONAL.
export const TOSS_ARM_DROP_AT_CONTACT_WARN = 0.85;
export const TOSS_ARM_DROP_AT_CONTACT_ERROR = 0.70;

// --- T1: no racket drop (max of racketElbowH − racketWristH over trophy→contact)
// Positive = wrist dropped below the elbow (racket "behind the back" = good).
// At/below ERROR the wrist never drops below the elbow; up to WARN the drop is
// shallow. Fraction of frame height. PROVISIONAL — geometry estimate.
export const RACKET_DROP_DEPTH_WARN = 0.03;
export const RACKET_DROP_DEPTH_ERROR = 0.0;

// --- T2: too long in trophy (acceleration-phase duration, ms) ---------------
// WEAK PROXY: the trophy phase is ~1 frame by construction, so we measure the
// trophy→contact (acceleration) window instead. Above WARN there is a long pause
// before the swing; above ERROR a clear freeze. The rule is warn-only and its
// confidence is forced to 'low' (see spec). PROVISIONAL — a fluent acceleration
// on a side-view clip takes ~250-350 ms.
export const ACCELERATION_PHASE_MS_WARN = 400;
export const ACCELERATION_PHASE_MS_ERROR = 600;

// --- F1: abrupt stop (|Δx| of racket wrist, contact → follow-through end) ---
// A finished serve swings the racket across the body; below WARN the motion
// cuts off short, below ERROR it stops almost in place. Fraction of frame width.
// PROVISIONAL — geometry estimate.
export const FOLLOW_THROUGH_TRAVEL_WARN = 0.12;
export const FOLLOW_THROUGH_TRAVEL_ERROR = 0.08;

// --- F2: loss of balance (|hipCenter.x − footCenter.x| @ follow-through end)
// info-only: CV cannot reliably tell "falling over" from "a natural step into
// the court" (serve-error-detection skill). Above this we surface a soft info
// note, never warn/error. Fraction of frame width. PROVISIONAL.
export const LEAN_AT_FOLLOW_END_INFO = 0.10;
