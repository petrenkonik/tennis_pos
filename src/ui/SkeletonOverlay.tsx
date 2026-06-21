import { useEffect, useRef, type RefObject } from 'react';
import i18n from '../i18n';
import type { PoseFrame, Phases } from '../types';
import type { RuleStatus } from '../rules/types';
import { VISIBILITY_THRESHOLD } from '../constants/biomechanics';
import { LM } from '../pose/landmarks';

// Pairs of MediaPipe landmark indices connected by a bone (the skeleton we
// draw). Named via the LM enum so the bones stay readable and a renumbering
// of a landmark flows through automatically.
const BONES: Array<[number, number]> = [
  // arms — shoulder→elbow→wrist, both sides
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  // torso — shoulders, hips, and the shoulder→hip frame
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  // legs — hip→knee→ankle, both sides
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

// Joints we draw as dots and color by visibility (diagnostic).
const JOINTS = [
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW,
  LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP,
  LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
];

// Highlight color per rule status. Canvas can't consume oklch / Tailwind tokens
// directly, so these hex values mirror the design tokens in src/index.css
// (--success / --warning / --error) — kept here as a single source of truth for
// the canvas. Update both if a token changes.
const STATUS_COLOR: Record<RuleStatus, string> = {
  ok: '#22A747',      // ≈ --success oklch(0.62 0.17 150)
  warn: '#E0A83A',    // ≈ --warning oklch(0.75 0.16 75)
  error: '#DC4446',   // ≈ --error oklch(0.577 0.245 27.325)
  unknown: '#8A8A8A',
};

// A bone or joint belongs to a rule when the rule inspects at least one of its
// landmark indices. Highlighted parts are drawn thicker / larger and painted
// by the highlight color; everything else is dimmed so the inspected parts are
// unambiguous. Rules supply `status` (mapped to STATUS_COLOR); phases supply an
// explicit `color` matching the phase bar. If both are given, `color` wins.
export interface SkeletonHighlight {
  landmarks: number[];
  status?: RuleStatus;
  color?: string;
}

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
    highlight = null,
  }: {
    videoRef: RefObject<HTMLVideoElement | null>;
    poses: PoseFrame[];
    phases?: Phases;
    // Same threshold the detection gate used; keeps the red/green coloring in
    // sync with what passed the gate (otherwise joints can look "uncertain"
    // here while the gate accepted them — N4).
    visibilityThreshold?: number;
    // When set, paints the listed landmarks (and the bones touching them) with
    // the rule's status color while a rule card is selected/hovered.
    highlight?: SkeletonHighlight | null;
  },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest highlight reachable from inside the rAF loop without adding
  // it to the effect's dependency array. `highlight` is a fresh object on many
  // renders (selected/hover changes); if it were a dep, the effect would tear
  // down and recreate the rAF loop each time, racing clearRect against draw and
  // leaving the canvas blank. The ref is read every frame instead.
  const highlightRef = useRef<SkeletonHighlight | null>(highlight);
  useEffect(() => {
    highlightRef.current = highlight;
  });

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
      // CSS pins the canvas to the video stage; the drawing buffer must match
      // the rendered pixel size or drawings look blurry/clipped.
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

      // Build the highlighted-landmark set once per frame from the latest value.
      const hl = highlightRef.current;
      const hlSet = hl ? new Set(hl.landmarks) : null;
      const hlColor = hl ? (hl.color ?? (hl.status ? STATUS_COLOR[hl.status] : null)) : null;

      // bones
      for (const [a, b] of BONES) {
        const pa = nearest.landmarks[a], pb = nearest.landmarks[b];
        const isHl = hlSet !== null && hlColor !== null && (hlSet.has(a) || hlSet.has(b));
        // When a rule is active, dim non-relevant bones so the inspected ones
        // stand out regardless of how close their status color is to the default.
        ctx.globalAlpha = isHl || hlSet === null ? 1 : 0.2;
        ctx.strokeStyle = isHl ? hlColor! : '#39FF14';
        ctx.lineWidth = isHl ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }

      // joints: red where MediaPipe is unsure (visibility below threshold),
      // green where it is confident — this is exactly what the gate checks.
      // Highlighted joints override with the rule's status color and a larger dot.
      for (const i of JOINTS) {
        const p = nearest.landmarks[i];
        const isHl = hlSet !== null && hlColor !== null && hlSet.has(i);
        ctx.globalAlpha = isHl || hlSet === null ? 1 : 0.2;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, isHl ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isHl
          ? hlColor!
          : p.visibility < visibilityThreshold ? '#FF2D2D' : '#39FF14';
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '16px sans-serif';
      const label = phases ? phaseAt(nearest.frameIndex, phases) : i18n.t('skeleton.preview');
      ctx.fillText(label, 8, 20);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // videoRef is a stable object; reads of `.current` happen inside the effect
    // (after the video DOM node is mounted), so we do not depend on its value.
    // `highlight` is intentionally NOT a dep — it's read via highlightRef each
    // frame to avoid tearing down the rAF loop on every selected/hover change.
  }, [videoRef, poses, phases, visibilityThreshold]);

  return <canvas ref={canvasRef} className="skeleton-overlay" />;
}
