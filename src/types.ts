export interface Landmark { x: number; y: number; z: number; visibility: number; }

export interface PoseFrame {
  frameIndex: number;
  timestampMs: number;
  landmarks: Landmark[]; // length 33
}

export type Handedness = 'right' | 'left';
// Only 'low' / 'high' are ever produced by detectPhases; no 'medium' tier exists
// yet. Re-add it when a rule distinguishes a middle grade.
export type Confidence = 'low' | 'high';

// How the contact timing in `events.contactFrame` was established:
// - 'pose'          — pose-only detection (wrist-height peak + extended elbow);
// - 'tracks'        — refined by the ball↔racket track minimum distance,
//                     cross-checked against the wrist-speed peak;
// - 'fallback-time' — events are a time-based split (trophy not expressed).
export type ContactSource = 'pose' | 'tracks' | 'fallback-time';

export interface Phases {
  handedness: Handedness;
  events: {
    // First frame of the toss lift, from the smoothed vertical velocity of the
    // toss wrist (see detectTossStart). Always a valid frame index: when the
    // lift cannot be detected, a time-based fallback frame is used instead and
    // `confidence` drops to 'low'.
    tossStartFrame: number;
    trophyFrame: number;
    contactFrame: number;
    followStartFrame: number;
  };
  phases: {
    preparation: [number, number];
    trophy: [number, number];
    acceleration: [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
  // Provenance of the contact timing (see ContactSource). detectPhases itself
  // always produces 'pose' (or 'fallback-time'); the track refinement step in
  // analyzeServe may upgrade it to 'tracks'.
  contactSource: ContactSource;
  // Machine-readable diagnostic explaining a degraded refinement outcome
  // (e.g. 'contact-tracks-sparse', 'contact-track-mismatch'). Always null from
  // detectPhases; the UI translates non-null values via t().
  contactDiagnostic: string | null;
}

export interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  // Every metric may be NaN (or facingSign 0) when it cannot be computed;
  // rules render NaN/0 as status 'unknown' rather than a wrong verdict.
  metrics: {
    // Trophy (existing — C3):
    kneeFlexionAtTrophyDeg: number;
    // Contact (C1, C2):
    elbowExtensionAtContactDeg: number;   // racket shoulder-elbow-wrist @ contactFrame
    contactHeightAboveShoulder: number;   // racketWristH − racketShoulderH @ contactFrame
    contactHorizontalOffset: number;      // racketWrist.x − hipCenter.x @ contactFrame
    // Toss (TO1, TO2, and the apex anchor for T3):
    tossApexFrame: number;                // argmax tossWristHeight over [0, contactFrame)
    tossApexHeightAboveShoulder: number;  // tossWristH − tossShoulderH @ tossApexFrame
    tossApexHorizontalOffset: number;     // tossWrist.x − hipCenter.x @ tossApexFrame
    tossArmDropAtContact: number;         // tossWristH(contact) / tossWristH(apex) ∈ [0,1]
    // Trophy (T1):
    racketDropDepth: number;              // max over [trophy,contact) of (racketElbowH − racketWristH)
    // Timing (T2):
    accelerationPhaseMs: number;          // (contactFrame − trophyFrame) / fps * 1000
    // Follow-through (F1, F2):
    followThroughHorizontalTravel: number; // |Δx| of racket wrist, contactFrame → followEnd
    leanAtFollowEnd: number;              // |hipCenter.x − footCenter.x| @ followEnd
    // Direction (shared by C2 / TO1). 0 = ambiguous → those rules return 'unknown'.
    facingSign: 1 | -1 | 0;
  };
}

// ---- Ball / racket detection layer (see specs/2026-06-22-detection-layer) ----
export interface BoxNorm { x: number; y: number; w: number; h: number; } // normalized [0,1], origin top-left

export interface Detection { box: BoxNorm; score: number; }

export interface DetectionFrame {
  frameIndex: number;
  timestampMs: number;
  ball: Detection | null;   // best ball this frame, else null
  racket: Detection | null; // best racket this frame, else null
}

export interface TrackPoint {
  frameIndex: number;
  timestampMs: number;
  center: { x: number; y: number };
  box: BoxNorm;
  score: number;
  interpolated: boolean; // true = gap-filled, not a real detection
}

export interface ObjectTrack {
  points: (TrackPoint | null)[]; // one slot per input DetectionFrame; null = uncovered
  coverage: number;              // real (non-interpolated) detections / total frames
}
export type BallTrack = ObjectTrack;
export type RacketTrack = ObjectTrack;
