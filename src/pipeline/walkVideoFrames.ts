// Single source of truth for the "~30 fps" sampling intent (was in extractPoses).
export const SAMPLE_STEP_SEC = 1 / 30;

// Integer-indexed sample times in [0, duration). Integer loop, not float
// accumulation: adding a float STEP would drift over a 30s clip.
export function frameSampleTimes(durationSec: number, stepSec: number): number[] {
  const times: number[] = [];
  for (let i = 0; i * stepSec < durationSec; i++) times.push(i * stepSec);
  return times;
}

// Seek-and-wait per sample time, invoking onFrame once the frame is ready.
// Impure boundary (drives the <video> element); intended to be validated via
// the demo overlay.
const SEEK_TIMEOUT_MS = 5000;
export async function walkVideoFrames(
  video: HTMLVideoElement,
  onFrame: (frame: { timestampMs: number; index: number }) => void | Promise<void>,
  onProgress?: (frac: number) => void,
): Promise<void> {
  const duration = video.duration;
  const times = frameSampleTimes(duration, SAMPLE_STEP_SEC);
  for (let i = 0; i < times.length; i++) {
    await seekTo(video, times[i]);
    await onFrame({ timestampMs: video.currentTime * 1000, index: i });
    onProgress?.(Math.min(1, times[i] / duration));
  }
  onProgress?.(1);
}

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
