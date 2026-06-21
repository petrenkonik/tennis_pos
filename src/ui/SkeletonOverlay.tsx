import { useEffect, useRef, type RefObject } from 'react';
import i18n from '../i18n';
import type { PoseFrame, Phases } from '../types';
import { VISIBILITY_THRESHOLD } from '../constants/biomechanics';
const BONES: Array<[number, number]> = [
  [11, 13], [13, 15], [12, 14], [14, 16],     // arms
  [11, 12], [23, 24], [11, 23], [12, 24],     // torso
  [23, 25], [25, 27], [24, 26], [26, 28],     // legs
];

// Joints we draw as dots and color by visibility (diagnostic).
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function phaseAt(frameIndex: number, phases: Phases): string {
  const p = phases.phases;
  // Singleton read (not a hook) because this runs inside a rAF loop.
  if (frameIndex < p.preparation[1]) return i18n.t('phases.preparation');
  if (frameIndex < p.acceleration[0]) return i18n.t('phases.trophy');
  if (frameIndex < p.acceleration[1]) return i18n.t('phases.acceleration');
  return i18n.t('phases.followThrough');
}

export function SkeletonOverlay(
  {
    videoRef,
    poses,
    phases,
    visibilityThreshold = VISIBILITY_THRESHOLD,
  }: {
    videoRef: RefObject<HTMLVideoElement | null>;
    poses: PoseFrame[];
    phases?: Phases;
    // Same threshold the detection gate used; keeps the red/green coloring in
    // sync with what passed the gate (otherwise joints can look "uncertain"
    // here while the gate accepted them — N4).
    visibilityThreshold?: number;
  },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    // rAF loop: always redraw at the current frame, whether the video is
    // playing, paused or being scrubbed (timeupdate only fires while playing).
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.clientWidth, h = video.clientHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      if (poses.length === 0) return;

      // nearest pose frame by time
      const tMs = video.currentTime * 1000;
      let nearest = poses[0];
      for (const f of poses) {
        if (Math.abs(f.timestampMs - tMs) < Math.abs(nearest.timestampMs - tMs)) nearest = f;
      }

      // bones
      ctx.strokeStyle = '#39FF14';
      ctx.lineWidth = 2;
      for (const [a, b] of BONES) {
        const pa = nearest.landmarks[a], pb = nearest.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }

      // joints: red where MediaPipe is unsure (visibility below threshold),
      // green where it is confident — this is exactly what the gate checks.
      for (const i of JOINTS) {
        const p = nearest.landmarks[i];
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.visibility < visibilityThreshold ? '#FF2D2D' : '#39FF14';
        ctx.fill();
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '16px sans-serif';
      const label = phases ? phaseAt(nearest.frameIndex, phases) : i18n.t('skeleton.preview');
      ctx.fillText(label, 8, 20);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // videoRef is a stable object; reads of `.current` happen inside the effect
    // (after the video DOM node is mounted), so we do not depend on its value.
  }, [videoRef, poses, phases, visibilityThreshold]);

  return <canvas ref={canvasRef} className="skeleton-overlay" />;
}
