import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, Landmark } from '../types';
import { walkVideoFrames } from './walkVideoFrames';

// fps fallback when the clip is too short to estimate one. Single source of
// truth for the "~30 fps" intent on the estimateFps side (the sampling-rate
// side now lives in walkVideoFrames.SAMPLE_STEP_SEC). task-rules §6: named, not magic.
const DEFAULT_FPS = 30;

// Pinned to the exact installed npm version (see package.json). `@latest` here
// would let a breaking MediaPipe release silently drift the WASM runtime away
// from the JS API we compile against.
export const MEDIAPIPE_VERSION = '0.10.35';
export const WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_BASE =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
export const MODEL_URLS: Record<PoseModel, string> = {
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

// Shared mapping of a raw MediaPipe landmark list to our Landmark[] (Task 3 reuses it).
export function mapLandmarks(raw: Array<{ x: number; y: number; z: number; visibility?: number }>): Landmark[] {
  return raw.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }));
}

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
// Single impure boundary of the pipeline (MediaPipe + <video> only live here);
// the seek loop itself is shared via walkVideoFrames (Task 3 reuses it for detection).
export async function extractPoses(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
  model: PoseModel = DEFAULT_MODEL,
): Promise<{ poses: PoseFrame[]; fps: number }> {
  const landmarker = await createLandmarker(model);
  const poses: PoseFrame[] = [];
  let poseIndex = 0; // counts kept frames only (33-landmark filter creates gaps)
  await walkVideoFrames(video, ({ timestampMs }) => {
    const result = landmarker.detectForVideo(video, timestampMs);
    const landmarks = mapLandmarks(result.landmarks[0] ?? []);
    if (landmarks.length === 33) poses.push({ frameIndex: poseIndex++, timestampMs, landmarks });
  }, onProgress);
  landmarker.close();
  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)) };
}
