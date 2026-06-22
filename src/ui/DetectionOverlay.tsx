import { useEffect, useRef, type RefObject } from 'react';
import type { BallTrack, RacketTrack, PoseFrame, Handedness, TrackPoint } from '../types';
import { racketWrist } from '../pose/landmarks';

const BALL_COLOR = '#22D3EE';   // cyan — distinct from the green skeleton
const RACKET_COLOR = '#F472B6'; // pink — distinct from ball and skeleton

// Nearest track point to a video time, or null if the slot is uncovered.
function nearestPoint(points: (TrackPoint | null)[], tMs: number): TrackPoint | null {
  let best: TrackPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (!p) continue;
    const d = Math.abs(p.timestampMs - tMs);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

function nearestPose(poses: PoseFrame[], tMs: number): PoseFrame | null {
  if (poses.length === 0) return null;
  let best = poses[0];
  for (const f of poses) {
    if (Math.abs(f.timestampMs - tMs) < Math.abs(best.timestampMs - tMs)) best = f;
  }
  return best;
}

export function DetectionOverlay({
  videoRef, ballTrack, racketTrack, poses, handedness,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  ballTrack: BallTrack;
  racketTrack: RacketTrack;
  poses: PoseFrame[];
  handedness: Handedness;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported: render nothing, do not crash
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.clientWidth, h = video.clientHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);

      const tMs = video.currentTime * 1000;

      // Ball: filled circle at the (smoothed) center, radius from the box.
      const ball = nearestPoint(ballTrack.points, tMs);
      if (ball) {
        const r = Math.max(ball.box.w, ball.box.h) * 0.5 * w;
        ctx.beginPath();
        ctx.arc(ball.center.x * w, ball.center.y * h, Math.max(4, r), 0, Math.PI * 2);
        ctx.fillStyle = BALL_COLOR;
        ctx.globalAlpha = ball.interpolated ? 0.4 : 0.85; // dim gap-filled points
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Racket: bounding box + long-axis line from the racket-hand wrist to the
      // box center (the in-plane orientation proxy that sub-project C builds on).
      const racket = nearestPoint(racketTrack.points, tMs);
      if (racket) {
        ctx.strokeStyle = RACKET_COLOR;
        ctx.lineWidth = racket.interpolated ? 1 : 2;
        ctx.globalAlpha = racket.interpolated ? 0.5 : 1;
        ctx.strokeRect(racket.box.x * w, racket.box.y * h, racket.box.w * w, racket.box.h * h);

        const pose = nearestPose(poses, tMs);
        if (pose) {
          const wrist = racketWrist(pose, handedness);
          ctx.beginPath();
          ctx.moveTo(wrist.x * w, wrist.y * h);
          ctx.lineTo(racket.center.x * w, racket.center.y * h);
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, ballTrack, racketTrack, poses, handedness]);

  return <canvas ref={canvasRef} className="skeleton-overlay" />;
}
