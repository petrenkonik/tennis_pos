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
// The gate is TIME-AWARE (see buildTracks): this value is the allowance for a
// CONSECUTIVE pair of frames; it grows by TRACK_GATE_GAP_SCALE per missed frame.
// PROVISIONAL.
export const TRACK_GATING_MAX_DIST = 0.25;

// Per missed frame since the last accepted detection, the allowed jump grows by
// this many normalized units. Rationale: a fast ball legitimately covers more
// ground when the detector missed frames in between — a fixed gate would lock
// the track out forever after one rejection (the stale-anchor defect fixed
// here). PROVISIONAL — calibrated on the demo clip + synthetic tracks.
export const TRACK_GATE_GAP_SCALE = 0.15;

// Hard cap on the time-aware gate allowance. Whatever the gap, a candidate
// farther than this from the last accepted point is a different object
// (background ball / second racket), not the same one catching up.
// PROVISIONAL.
export const TRACK_GATE_MAX_DIST_CAP = 0.6;

// Interior gaps shorter than this many frames are linearly interpolated; longer
// gaps stay null (a low-confidence zone). At ~30fps, 8 frames ≈ 0.27s.
// PROVISIONAL.
export const TRACK_MAX_GAP_FRAMES = 8;

// Centered moving-average window for track-center smoothing. Mirrors
// SMOOTH_WINDOW_FRAMES for pose; tracks are noisier but the same window is safe.
export const TRACK_SMOOTH_WINDOW = 5;

// --- Model (MediaPipe ObjectDetector, EfficientDet-Lite0, COCO, Apache-2.0) --
// Pinned exactly like MEDIAPIPE_VERSION in extractPoses: the '/1/' path segment
// pins the model revision; '@latest' drift would move the model away from the
// API we compile against. Loading from a CDN is allowed by task-rules §4.
// NOTE: the ObjectDetector model is a `.tflite` asset (unlike PoseLandmarker's
// `.task`); the `.task` extension 404s on this host.
export const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

// COCO category names emitted by EfficientDet-Lite0 for the two tracked objects.
// Used as the ObjectDetector categoryAllowlist and to bucket detections.
export const COCO_BALL = 'sports ball';
export const COCO_RACKET = 'tennis racket';
