import type { Handedness, PoseFrame, Phases } from '../types';
import type { Finding, RuleResult } from '../rules/types';
import { smooth } from './smooth';
import { detectPhases, ServeNotRecognizedError } from './detectPhases';
import { buildPhaseContext } from './buildPhaseContext';
import { runRules, runRulesReport } from './runRules';
import { ruleC3 } from '../rules/ruleC3';
import { extractPoses, type PoseModel } from './extractPoses';
import { MAX_CLIP_SECONDS } from '../constants/biomechanics';

export type AnalysisError =
  | { kind: 'pose-extraction-failed'; detail: string }
  | { kind: 'serve-not-recognized'; detail: string }
  | { kind: 'analysis-failed'; detail: string }
  | { kind: 'video-too-long'; detail: string };

export type AnalysisResult =
  // ruleResults = every rule's outcome (pass/fail + params); findings = the warn/error subset.
  | { ok: true; phases: Phases; findings: Finding[]; ruleResults: RuleResult[]; poses: PoseFrame[] }
  // poses are carried on failure too (empty if nothing was extracted) so the UI
  // can still draw the detected skeleton for diagnostics.
  | { ok: false; error: AnalysisError; poses: PoseFrame[] };

export interface AnalyzeDeps {
  extract: (v: HTMLVideoElement, onProgress?: (f: number) => void, model?: PoseModel) =>
    Promise<{ poses: PoseFrame[]; fps: number }>;
}
const defaultDeps: AnalyzeDeps = { extract: extractPoses };

// UI-tunable knobs. Omitted fields fall back to calibrated defaults.
export interface AnalyzeOptions {
  model?: PoseModel;
  visibilityThreshold?: number;
  maxLowVisFraction?: number;
  // Test seam: inject a synthetic extract to bypass MediaPipe. Defaults to the
  // real extractPoses. Kept inside options (not a 5th positional arg) so callers
  // never have to pass `undefined` for it in production code.
  deps?: AnalyzeDeps;
}

export async function analyzeServe(
  video: HTMLVideoElement,
  handedness: Handedness,
  onProgress?: (frac: number) => void,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const deps = options.deps ?? defaultDeps;
  if (video.duration > MAX_CLIP_SECONDS) {
    return { ok: false, error: { kind: 'video-too-long', detail: `>${MAX_CLIP_SECONDS}s` }, poses: [] };
  }

  let raw: { poses: PoseFrame[]; fps: number };
  try {
    raw = await deps.extract(video, onProgress, options.model);
  } catch (e) {
    console.error('[analyzeServe] извлечение поз упало:', e);
    return { ok: false, error: { kind: 'pose-extraction-failed', detail: String(e) }, poses: [] };
  }

  // Diagnostics: how much usable pose data did MediaPipe actually yield.
  console.info(
    `[analyzeServe] извлечено кадров с полным скелетом: ${raw.poses.length}, fps≈${raw.fps.toFixed(1)}, ` +
    `длительность видео ${video.duration.toFixed(1)}с, handedness=${handedness}`,
  );

  let smoothed: PoseFrame[] = [];
  try {
    smoothed = smooth(raw.poses);
    const phases = detectPhases(smoothed, handedness, {
      visibilityThreshold: options.visibilityThreshold,
      maxLowVisFraction: options.maxLowVisFraction,
    });
    const ctx = buildPhaseContext(smoothed, raw.fps, phases);
    const findings = runRules(ctx, [ruleC3]);
    const ruleResults = runRulesReport(ctx, [ruleC3]);
    return { ok: true, phases, findings, ruleResults, poses: smoothed };
  } catch (e) {
    if (e instanceof ServeNotRecognizedError) {
      console.warn('[analyzeServe] подача не распознана:', e.detail);
      return { ok: false, error: { kind: 'serve-not-recognized', detail: e.detail }, poses: smoothed };
    }
    // A bug in smooth/detectPhases/buildPhaseContext/runRules — distinct from
    // pose extraction (which already succeeded by this point). Surfacing it as
    // pose-extraction-failed would mislead users and hide the real culprit.
    console.error('[analyzeServe] ошибка в анализе:', e);
    return { ok: false, error: { kind: 'analysis-failed', detail: String(e) }, poses: smoothed };
  }
}
