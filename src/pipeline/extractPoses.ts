import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, Landmark } from '../types';

// Sampling step (seconds) and the fps fallback when the clip is too short to
// estimate one. Both are the single source of truth for the "~30 fps" intent:
// the step defines our effective sample rate, and estimateFps returns this when
// it cannot derive a real value. task-rules §6: named, not magic.
const SAMPLE_STEP_SEC = 1 / 30;
const DEFAULT_FPS = 30;

// Pinned to the exact installed npm version (see package.json). `@latest` here
// would let a breaking MediaPipe release silently drift the WASM runtime away
// from the JS API we compile against.
const MEDIAPIPE_VERSION = '0.10.35';
const WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODEL_URLS: Record<PoseModel, string> = {
  lite: `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  full: `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  heavy: `${MODEL_BASE}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
};

// MediaPipe pose model accuracy tiers. lite = fastest/least accurate,
// heavy = most accurate but a large download and slow on CPU.
// Default 'heavy' matches the UI default; a direct extractPoses() call without
// UI should still pick the calibrated-for-amateurs tier, not the lightest one.
export type PoseModel = 'lite' | 'full' | 'heavy';
export const DEFAULT_MODEL: PoseModel = 'heavy';

async function createLandmarker(model: PoseModel): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[model] },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

// Median frame-to-frame delta → fps (browser does not expose fps directly).
export function estimateFps(timestampsMs: number[]): number {
  if (timestampsMs.length < 2) return DEFAULT_FPS;
  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) deltas.push(timestampsMs[i] - timestampsMs[i - 1]);
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? 1000 / median : DEFAULT_FPS;
}

// Walks the video frame-by-frame, runs PoseLandmarker, returns one PoseFrame per frame.
// Single impure boundary of the pipeline (MediaPipe + <video> only live here).
export async function extractPoses(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
  model: PoseModel = DEFAULT_MODEL,
): Promise<{ poses: PoseFrame[]; fps: number }> {
  const landmarker = await createLandmarker(model);
  const poses: PoseFrame[] = [];
  const duration = video.duration;

  // Integer-indexed loop: accumulating float STEP would drift over a 30s clip
  // and cause the last samples to over/undershoot `duration`.
  // `poseIndex` counts successful detections only, so it is NOT the video frame
  // index — frames dropped by the `landmarks.length === 33` filter create gaps.
  let poseIndex = 0;
  for (let i = 0; i * SAMPLE_STEP_SEC < duration; i++) {
    const t = i * SAMPLE_STEP_SEC;
    await seekTo(video, t);
    const tsMs = video.currentTime * 1000;
    const result = landmarker.detectForVideo(video, tsMs);
    const landmarks: Landmark[] = (result.landmarks[0] ?? []).map(p => ({
      x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0,
    }));
    if (landmarks.length === 33) {
      poses.push({ frameIndex: poseIndex++, timestampMs: tsMs, landmarks });
    }
    onProgress?.(Math.min(1, t / duration));
  }
  onProgress?.(1);
  landmarker.close();

  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)) };
}

// Seek and wait for the frame to be ready. Without a timeout a corrupt frame
// or codec hiccup that never fires `seeked` would hang the whole pipeline.
const SEEK_TIMEOUT_MS = 5000;
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      reject(new Error(`seek to ${time.toFixed(3)}s timed out after ${SEEK_TIMEOUT_MS}ms`));
    }, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}
