// Phase-playback knobs. task-rules §6: thresholds are named, not magic.
//
// Applied only while a phase block is selected in the PhaseBar — the video is
// seeked to the phase start and played at this slowed rate so the user can
// study the movement. When no phase is selected the native 1.0× rate is used.

// Slowest selectable rate. 0.1× gives a near frame-by-frame review of a phase.
export const PHASE_PLAYBACK_SPEED_MIN = 0.1;

// Full speed (native). Selecting this makes phase playback identical to normal.
export const PHASE_PLAYBACK_SPEED_MAX = 1.0;

// Slider step. Fine enough for 0.1→1.0 without bloating the option count.
export const PHASE_PLAYBACK_SPEED_STEP = 0.05;

// Default rate for reviewing a phase — slow enough to see the movement clearly
// but not so slow that short phases feel frozen.
export const DEFAULT_PHASE_PLAYBACK_SPEED = 0.5;
