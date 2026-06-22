// Object-detection + tracking constants for the ball/racket detection layer.
// task-rules §6: no magic literals in logic. All values are PROVISIONAL and are
// calibrated on the demo clip in the final validation task of this plan.

// --- Tracking (buildTracks) -------------------------------------------------
// Minimum detection score to accept a box (below = treated as no detection).
// Deliberately low: a fast, motion-blurred ball scores poorly and gap-fill
// closes the resulting holes. PROVISIONAL.
export const TRACK_SCORE_MIN = 0.2;

// Max normalized center-to-center jump between consecutive accepted detections,
// as a fraction of the (normalized) frame extent. Rejects a spurious far box
// (a background ball / a second racket) that would teleport the track.
// PROVISIONAL.
export const TRACK_GATING_MAX_DIST = 0.25;

// Interior gaps shorter than this many frames are linearly interpolated; longer
// gaps stay null (a low-confidence zone). At ~30fps, 8 frames ≈ 0.27s.
// PROVISIONAL.
export const TRACK_MAX_GAP_FRAMES = 8;

// Centered moving-average window for track-center smoothing. Mirrors
// SMOOTH_WINDOW_FRAMES for pose; tracks are noisier but the same window is safe.
export const TRACK_SMOOTH_WINDOW = 5;
