import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGS, type SupportedLang } from './i18n';
import type { Handedness } from './types';
import { analyzeServe, type AnalysisResult } from './pipeline/analyzeServe';
import { DEFAULT_MODEL, type PoseModel } from './pipeline/extractPoses';
import {
  DEFAULT_UI_VISIBILITY_THRESHOLD,
  DEFAULT_UI_MAX_LOW_VIS_FRACTION,
} from './constants/biomechanics';
import { DEMO_CLIPS, type DemoClip } from './constants/demoClips';
import { resolveAsset } from './lib/resolveAsset';
import {
  PHASE_PLAYBACK_SPEED_MIN,
  PHASE_PLAYBACK_SPEED_MAX,
  PHASE_PLAYBACK_SPEED_STEP,
  DEFAULT_PHASE_PLAYBACK_SPEED,
} from './constants/playback';
import { frameToMs, type PhaseKey } from './lib/phaseTime';
import { PhaseBar } from './ui/PhaseBar';
import { AdviceList } from './ui/AdviceList';
import { RulesReport } from './ui/RulesReport';
import { SkeletonOverlay } from './ui/SkeletonOverlay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Upload,
  Settings2,
  Loader2,
  AlertCircle,
  ChevronDown,
  PlayCircle,
} from 'lucide-react';

type Status = 'idle' | 'processing' | 'done' | 'error';

// task-rules §6: thresholds are named, not magic.
// If `loadedmetadata` does not fire within this window, assume the file is
// corrupt/unsupported rather than hanging the UI on "Processing…".
const METADATA_TIMEOUT_MS = 8000;

export default function App() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Track the object URL so we can revoke it before assigning a new one on
  // re-upload; otherwise each createObjectURL leaks a blob until page reload.
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  // Defaults tuned for amateur side-view clips: accurate model + lenient gate.
  const [model, setModel] = useState<PoseModel>(DEFAULT_MODEL);
  const [visTh, setVisTh] = useState(DEFAULT_UI_VISIBILITY_THRESHOLD);
  const [maxLowVis, setMaxLowVis] = useState(DEFAULT_UI_MAX_LOW_VIS_FRACTION);

  // Phase review: clicking a phase block seeks the video to its start and plays
  // it slowly to the phase end, then pauses. `selectedPhase` is the highlighted
  // block; `phasePlayback` is the active bounded playback (cleared on pause).
  const [selectedPhase, setSelectedPhase] = useState<PhaseKey | null>(null);
  const [phaseSpeed, setPhaseSpeed] = useState(DEFAULT_PHASE_PLAYBACK_SPEED);
  const [phasePlayback, setPhasePlayback] = useState<{ endMs: number } | null>(null);

  // Seek the video to a rule's measurement moment; the skeleton overlay
  // (rAF loop) redraws at that frame automatically.
  function seekTo(timestampMs: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = timestampMs / 1000;
  }

  // Reset playback-rate + selection state to "whole video at 1×". Called on
  // toggle-off, double-click, and re-upload.
  function clearPhaseSelection(video?: HTMLVideoElement) {
    setSelectedPhase(null);
    setPhasePlayback(null);
    const v = video ?? videoRef.current;
    if (v) v.playbackRate = 1;
  }

  // Clicking a phase block: seek to its start, play slowly to its end, pause.
  // Clicking the already-selected block (key === null) clears the selection.
  function handlePhaseSelect(key: PhaseKey | null) {
    const video = videoRef.current;
    if (key === null || !video || !result?.ok) {
      clearPhaseSelection(video ?? undefined);
      return;
    }
    const [startFrame, endFrame] = result.phases.phases[key];
    const startMs = frameToMs(startFrame, result.poses);
    const endMs = frameToMs(endFrame, result.poses);
    setSelectedPhase(key);
    video.playbackRate = phaseSpeed;
    video.currentTime = startMs / 1000;
    void video.play();
    setPhasePlayback({ endMs });
  }

  // Native timeupdate: when bounded phase playback reaches the phase end, stop.
  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || !phasePlayback) return;
    if (video.currentTime * 1000 >= phasePlayback.endMs) {
      video.pause();
      setPhasePlayback(null);
    }
  }

  // Double-click the video: drop any phase selection, rewind and play whole.
  function selectAllVideo() {
    const video = videoRef.current;
    if (!video) return;
    clearPhaseSelection(video);
    video.currentTime = 0;
    void video.play();
  }

  // Keep the video's playbackRate in sync with the slider while a phase is
  // selected; restore 1× when nothing is selected.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = selectedPhase ? phaseSpeed : 1;
  }, [selectedPhase, phaseSpeed]);

  // Core load+analyze routine, shared by the file input and the demo button.
  // Accepts a Blob (File extends Blob) and the handedness to analyze with —
  // passed explicitly so loadDemo can apply the clip's handedness without
  // waiting for a React state flush (which would race the closure). Clears any
  // active phase-playback selection so playbackRate/selection state from a
  // previous clip doesn't leak into the new one.
  async function loadVideoFile(file: Blob, hand: Handedness) {
    const video = videoRef.current;
    if (!video) return;

    setResult(null);
    setStatus('processing');
    setProgress(0);
    clearPhaseSelection(video);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    video.src = url;
    try {
      // Guard against corrupt/unsupported files where `loadedmetadata` never
      // fires — without a timeout the UI would hang on "Processing…" forever.
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error('metadata load timed out')),
          METADATA_TIMEOUT_MS,
        );
        video.onloadedmetadata = () => { clearTimeout(timer); res(); };
        video.onerror = () => { clearTimeout(timer); rej(new Error('video decode error')); };
      });

      const r = await analyzeServe(video, hand, setProgress, {
        model,
        visibilityThreshold: visTh,
        maxLowVisFraction: maxLowVis,
      });
      setResult(r);
      if (r.ok) {
        setStatus('done');
      } else {
        setStatus('error');
        setErrorMsg(translateError(r.error, t));
        setErrorDetail(renderErrorDetail(r.error, t));
      }
    } catch (err) {
      // metadata load / decode failure from the await above
      setStatus('error');
      setErrorMsg(t('errors.video-read-failed'));
      setErrorDetail(String(err));
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadVideoFile(file, handedness);
  }

  // Fetch a bundled demo .mp4 from public/ and run it through the same pipeline
  // as an uploaded file. The clip's handedness overrides the toggle so the UI
  // and the analysis agree on which arm is the racket arm. A failed fetch
  // (e.g. the .mp4 is not yet in public/demo/clips/) surfaces as a clean
  // video-read-failed error instead of crashing.
  async function loadDemo(clip: DemoClip) {
    setHandedness(clip.handedness);
    try {
      // Resolve against BASE_URL so the fetch works under a sub-path base
      // (GitHub Pages serves at /tennis_pos/, not /). clip.path is relative.
      const resp = await fetch(resolveAsset(clip.path));
      if (!resp.ok) throw new Error(`demo fetch failed: ${resp.status}`);
      const blob = await resp.blob();
      const name = clip.path.split('/').pop() ?? 'demo.mp4';
      const file = new File([blob], name, { type: blob.type || 'video/mp4' });
      await loadVideoFile(file, clip.handedness);
    } catch (err) {
      setStatus('error');
      setErrorMsg(t('errors.video-read-failed'));
      setErrorDetail(String(err));
    }
  }

  const isBusy = status === 'processing';

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Sticky header with title + language toggle. */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-label="🎾">🎾</span>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              {t('app.title')}
            </h1>
          </div>
          <LangToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Upload + handedness controls — always visible so the user can
            re-upload without scrolling after seeing a result. */}
        <Card className="mb-4">
          <CardContent className="grid gap-4 p-4 sm:p-5">
            {/* Dropzone / file picker.
                The <input> is visually hidden (the dropzone button triggers it
                via a click), but kept in the DOM and given an accessible label
                so screen readers and tests can target it. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={onFile}
              className="sr-only"
              aria-label={t('controls.upload')}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className={cn(
                'group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors',
                'hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isBusy && 'pointer-events-none opacity-60',
              )}
            >
              {isBusy ? (
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              ) : (
                <Upload className="h-7 w-7 text-muted-foreground transition-colors group-hover:text-primary" />
              )}
              <span className="text-sm font-medium text-foreground">
                {isBusy
                  ? t('status.processing', { n: Math.round(progress * 100) })
                  : t('controls.upload')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('controls.videoFormats')}
              </span>
            </button>

            {/* One-click demo: fetch a bundled serve clip from public/ and run
                the full pipeline without the user picking a file. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mx-auto"
              onClick={() => void loadDemo(DEMO_CLIPS[0])}
              disabled={isBusy}
            >
              <PlayCircle className="h-4 w-4" />
              {t('controls.tryDemo')}
            </Button>

            {/* Handedness toggle. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={handedness === 'right' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHandedness('right')}
                disabled={isBusy}
              >
                {t('controls.rightHanded')}
              </Button>
              <Button
                variant={handedness === 'left' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHandedness('left')}
                disabled={isBusy}
              >
                {t('controls.leftHanded')}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setShowSettings(s => !s)}
                aria-expanded={showSettings}
              >
                <Settings2 className="h-4 w-4" />
                {t('controls.settings')}
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', showSettings && 'rotate-180')}
                />
              </Button>
            </div>

            {/* Collapsible recognition settings. */}
            {showSettings && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t('controls.mpModel')}</span>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as PoseModel)}
                    disabled={isBusy}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="lite">{t('controls.mpLite')}</option>
                    <option value="full">{t('controls.mpFull')}</option>
                    <option value="heavy">{t('controls.mpHeavy')}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    {t('controls.visThreshold', { n: visTh.toFixed(2) })}
                  </span>
                  <input
                    type="range" min={0.1} max={0.9} step={0.05} value={visTh}
                    onChange={(e) => setVisTh(Number(e.target.value))}
                    disabled={isBusy}
                    className="accent-primary"
                  />
                  <small className="text-xs text-muted-foreground">
                    {t('controls.visThresholdHelp')}
                  </small>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    {t('controls.maxLowVis', { n: `${Math.round(maxLowVis * 100)}%` })}
                  </span>
                  <input
                    type="range" min={0.3} max={0.95} step={0.05} value={maxLowVis}
                    onChange={(e) => setMaxLowVis(Number(e.target.value))}
                    disabled={isBusy}
                    className="accent-primary"
                  />
                  <small className="text-xs text-muted-foreground">
                    {t('controls.maxLowVisHelp')}
                  </small>
                </label>
              </div>
            )}

            {/* Collapsible playback settings — slow-motion rate for phase review. */}
            {showSettings && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">
                    {t('controls.phaseSpeed', { n: phaseSpeed.toFixed(2) })}
                  </span>
                  <input
                    type="range"
                    min={PHASE_PLAYBACK_SPEED_MIN}
                    max={PHASE_PLAYBACK_SPEED_MAX}
                    step={PHASE_PLAYBACK_SPEED_STEP}
                    value={phaseSpeed}
                    onChange={(e) => setPhaseSpeed(Number(e.target.value))}
                    disabled={isBusy}
                    className="accent-primary"
                  />
                  <small className="text-xs text-muted-foreground">
                    {t('controls.phaseSpeedHelp')}
                  </small>
                </label>
              </div>
            )}

            {/* Processing progress bar. */}
            {isBusy && (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('status.processing', { n: Math.round(progress * 100) })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Video stage. The <video> element must stay mounted in every state
            (including idle) so its ref is live when onFile() runs — onFile
            assigns video.src synchronously and would no-op on a null ref.
            We hide the stage with `hidden` (display:none) until a file is
            picked; the element stays in the DOM and loadedmetadata still
            fires. */}
        <div
          className={cn(
            'relative mb-4 aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-sm',
            status === 'idle' && 'hidden',
          )}
          onDoubleClick={selectAllVideo}
        >
          <video
            ref={videoRef}
            controls
            onTimeUpdate={onTimeUpdate}
            className="absolute inset-0 h-full w-full"
          />
          {(status === 'done' || status === 'error') && result && result.poses.length > 0 && (
            <SkeletonOverlay
              videoRef={videoRef}
              poses={result.poses}
              phases={result.ok ? result.phases : undefined}
              visibilityThreshold={visTh}
            />
            )}
          </div>

        {/* Error block. */}
        {status === 'error' && (
          <Card className="mb-4 border-destructive/40 bg-destructive/5">
            <CardContent className="flex gap-3 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-destructive">{errorMsg}</p>
                {errorDetail && (
                  <p className="text-xs text-muted-foreground">
                    {t('status.detail', { value: errorDetail })}
                  </p>
                )}
                {result && !result.ok && result.poses.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('skeleton.errorHint')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analysis results. */}
        {status === 'done' && result?.ok && (
          <div className="space-y-6">
            <section className="space-y-2">
              <SectionLabel>{t('report.colPhase')}</SectionLabel>
              <PhaseBar
                phases={result.phases}
                selected={selectedPhase}
                onSelect={handlePhaseSelect}
              />
              <p className="text-xs text-muted-foreground">{t('controls.phaseHint')}</p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {t('app.reportTitle', { n: result.ruleResults.length })}
                </h2>
                <Badge variant="secondary">
                  {result.ruleResults.length}
                </Badge>
              </div>
              <RulesReport results={result.ruleResults} onSeek={seekTo} />
            </section>

            {result.findings.length > 0 && (
              <section className="space-y-3">
                <SectionLabel>{t('report.colStatus')}</SectionLabel>
                <AdviceList findings={result.findings} />
              </section>
            )}
          </div>
        )}

        {/* Hero / empty state — shown before the first upload. */}
        {status === 'idle' && (
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg">{t('app.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('app.heroSubtitle')}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

// Resolve the user-facing headline message for an AnalysisError.
function translateError(
  error: Extract<AnalysisResult, { ok: false }>['error'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return t(`errors.${error.kind}`);
}

// Render the per-error "Detail:" tail. serve-not-recognized carries a machine
// code ({ code, params }) that we translate; the others surface raw dev strings
// (stack traces / low-level messages) verbatim.
function renderErrorDetail(
  error: Extract<AnalysisResult, { ok: false }>['error'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (error.kind === 'serve-not-recognized') {
    const { code, params } = error.detail;
    if (code === 'low-visibility') {
      const worst = Array.isArray(params.worst) && params.worst.length > 0
        ? (params.worst as Array<{ key: string; pct: number }>)
            .map(w => t('detect.jointFrames', {
              joint: t(`detect.joint.${w.key}`),
              pct: w.pct,
            }))
            .join(', ')
        : t('detect.worst-none');
      return t('detect.low-visibility', { ...params, worst });
    }
    return t(`detect.${code}`, params);
  }
  return error.detail;
}

// EN/РУ toggle. The active language is i18n.language; clicking persists the
// choice to localStorage via LanguageDetector, overriding browser detection.
function LangToggle() {
  const { t, i18n: i18nInstance } = useTranslation();
  const current = i18nInstance.language?.split('-')[0] as SupportedLang;
  const switchTo = (lng: SupportedLang) => {
    void i18n.changeLanguage(lng);
  };
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border"
      aria-label={t('app.title')}
    >
      {SUPPORTED_LANGS.map(lng => (
        <button
          key={lng}
          type="button"
          className={cn(
            'px-2.5 py-1 text-xs font-medium transition-colors',
            lng === current
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-muted-foreground hover:bg-accent',
            lng !== SUPPORTED_LANGS[0] && 'border-l',
          )}
          onClick={() => switchTo(lng)}
        >
          {t(`lang.${lng}`)}
        </button>
      ))}
    </div>
  );
}
