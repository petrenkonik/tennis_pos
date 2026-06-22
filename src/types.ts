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

export interface Phases {
  handedness: Handedness;
  events: { trophyFrame: number; contactFrame: number; followStartFrame: number };
  phases: {
    preparation: [number, number];
    trophy: [number, number];
    acceleration: [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
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
