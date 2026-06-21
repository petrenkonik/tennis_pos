// Demo serve clips bundled with the app. Each entry powers the one-click
// "Try a demo serve" button in App — the .mp4 is fetched from public/ and
// run through the same analyzeServe pipeline as an uploaded file.
// task-rules §6: thresholds are named, not magic.

import type { Handedness } from '../types';

export interface DemoClip {
  // Stable id used as the React key.
  id: string;
  // i18n key for the clip label (NOT a display string — task-rules §8).
  titleKey: string;
  // Path relative to the site base (NO leading slash), e.g.
  // 'demo/clips/foo.mp4' for a file at public/demo/clips/foo.mp4. Resolved
  // against import.meta.env.BASE_URL at fetch time via resolveAsset(), so it
  // works both in dev (base '/') and on GitHub Pages (base '/tennis_pos/').
  path: string;
  // Applied to the handedness toggle when the demo is loaded, so the
  // pipeline and UI agree on which arm is the racket arm.
  handedness: Handedness;
}

// Single starter clip. The manifest is shaped as an array so more clips can be
// added later without touching the UI; App wires only DEMO_CLIPS[0] for now.
// The actual .mp4 is supplied by the user into public/demo/clips/.
export const DEMO_CLIPS: readonly DemoClip[] = [
  {
    id: 'serve-right-side',
    titleKey: 'demo.serveRightSide.title',
    path: 'demo/clips/serve-right-side.mp4',
    handedness: 'right',
  },
];
