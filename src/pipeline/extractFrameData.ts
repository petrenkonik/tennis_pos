import { FilesetResolver, PoseLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
import type { PoseFrame, Detection, DetectionFrame } from '../types';
import { walkVideoFrames } from './walkVideoFrames';
import {
  WASM_BASE, MODEL_URLS, mapLandmarks, estimateFps, DEFAULT_MODEL, type PoseModel,
} from './extractPoses';
import {
  OBJECT_MODEL_URL, COCO_BALL, COCO_RACKET, TRACK_SCORE_MIN,
} from '../constants/detection';

// Subset of the MediaPipe ObjectDetector result we consume. boundingBox is in
// pixels of the input frame; we normalize it against the video dimensions.
export interface RawDetection {
  categories: { categoryName: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

// Pure: pick the best ball and the best racket from one frame's raw detections.
export function pickDetections(
  raw: RawDetection[], videoW: number, videoH: number,
): { ball: Detection | null; racket: Detection | null } {
  let ball: Detection | null = null;
  let racket: Detection | null = null;
  if (videoW <= 0 || videoH <= 0) return { ball, racket };
  for (const d of raw) {
    const bb = d.boundingBox;
    if (!bb) continue;
    const det: Detection = {
      box: { x: bb.originX / videoW, y: bb.originY / videoH, w: bb.width / videoW, h: bb.height / videoH },
      score: d.categories[0]?.score ?? 0,
    };
    for (const c of d.categories) {
      const cand: Detection = { ...det, score: c.score };
      if (c.categoryName === COCO_BALL && (!ball || c.score > ball.score)) ball = cand;
      else if (c.categoryName === COCO_RACKET && (!racket || c.score > racket.score)) racket = cand;
    }
  }
  return { ball, racket };
}

// Combined extractor: one shared frame walk, both models per frame. poses and
// detections are appended together only on kept (33-landmark) frames, so the
// arrays stay index- and timestamp-aligned. Impure boundary; validated on the
// demo clip via DetectionOverlay.
export async function extractFrameData(
  video: HTMLVideoElement,
  onProgress?: (frac: number) => void,
  model: PoseModel = DEFAULT_MODEL,
): Promise<{ poses: PoseFrame[]; fps: number; detections: DetectionFrame[] }> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[model] },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  const detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: OBJECT_MODEL_URL },
    runningMode: 'VIDEO',
    scoreThreshold: TRACK_SCORE_MIN,
    categoryAllowlist: [COCO_BALL, COCO_RACKET],
  });

  const poses: PoseFrame[] = [];
  const detections: DetectionFrame[] = [];
  let idx = 0;
  await walkVideoFrames(video, ({ timestampMs }) => {
    const pose = landmarker.detectForVideo(video, timestampMs);
    const landmarks = mapLandmarks(pose.landmarks[0] ?? []);
    if (landmarks.length !== 33) return; // keep poses & detections aligned to kept frames
    const od = detector.detectForVideo(video, timestampMs);
    const picked = pickDetections(od.detections as RawDetection[], video.videoWidth, video.videoHeight);
    poses.push({ frameIndex: idx, timestampMs, landmarks });
    detections.push({ frameIndex: idx, timestampMs, ball: picked.ball, racket: picked.racket });
    idx++;
  }, onProgress);

  landmarker.close();
  detector.close();
  return { poses, fps: estimateFps(poses.map(p => p.timestampMs)), detections };
}
