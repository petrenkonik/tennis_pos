import type { PoseFrame, Landmark } from '../types';
import { SMOOTH_WINDOW_FRAMES } from '../constants/biomechanics';

// Centered moving average over x,y of every landmark. z and visibility are
// passed through untouched (visibility is already a filtered confidence).
export function smooth(poses: PoseFrame[], window = SMOOTH_WINDOW_FRAMES): PoseFrame[] {
  if (poses.length === 0) return [];
  const n = poses.length;
  const numLm = poses[0].landmarks.length;
  const half = Math.floor(window / 2);

  return poses.map((frame, i) => {
    const smoothed: Landmark[] = [];
    for (let l = 0; l < numLm; l++) {
      let sx = 0, sy = 0, count = 0;
      for (let j = -half; j <= half; j++) {
        const k = i + j;
        if (k >= 0 && k < n) {
          sx += poses[k].landmarks[l].x;
          sy += poses[k].landmarks[l].y;
          count++;
        }
      }
      const orig = frame.landmarks[l];
      smoothed.push({ x: sx / count, y: sy / count, z: orig.z, visibility: orig.visibility });
    }
    return { ...frame, landmarks: smoothed };
  });
}
