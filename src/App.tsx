import { useRef, useState, type ChangeEvent } from 'react';
import type { Handedness } from './types';
import { analyzeServe, type AnalysisResult } from './pipeline/analyzeServe';
import { DEFAULT_MODEL, type PoseModel } from './pipeline/extractPoses';
import {
  DEFAULT_UI_VISIBILITY_THRESHOLD,
  DEFAULT_UI_MAX_LOW_VIS_FRACTION,
} from './constants/biomechanics';
import { PhaseBar } from './ui/PhaseBar';
import { AdviceList } from './ui/AdviceList';
import { RulesReport } from './ui/RulesReport';
import { SkeletonOverlay } from './ui/SkeletonOverlay';
import './App.css';

type Status = 'idle' | 'processing' | 'done' | 'error';

// task-rules §6: thresholds are named, not magic.
// If `loadedmetadata` does not fire within this window, assume the file is
// corrupt/unsupported rather than hanging the UI on "Обработка…".
const METADATA_TIMEOUT_MS = 8000;

const ERROR_TEXT: Record<string, string> = {
  'video-too-long': 'Видео длиннее 30 секунд. Загрузите короткий клип одной подачи.',
  'serve-not-recognized': 'Не удалось распознать подачу. Снимите сбоку, игрок целиком в кадре.',
  'pose-extraction-failed': 'Не удалось запустить распознавание. Попробуйте другой браузер/файл.',
  'analysis-failed': 'Внутренняя ошибка при разборе поз. Скелет показан для диагностики.',
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Track the object URL so we can revoke it before assigning a new one on
  // re-upload; otherwise each createObjectURL leaks a blob until page reload.
  const objectUrlRef = useRef<string | null>(null);
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  // Defaults tuned for amateur side-view clips: accurate model + lenient gate.
  const [model, setModel] = useState<PoseModel>(DEFAULT_MODEL);
  const [visTh, setVisTh] = useState(DEFAULT_UI_VISIBILITY_THRESHOLD);
  const [maxLowVis, setMaxLowVis] = useState(DEFAULT_UI_MAX_LOW_VIS_FRACTION);

  // Seek the video to a rule's measurement moment; the skeleton overlay
  // (rAF loop) redraws at that frame automatically.
  function seekTo(timestampMs: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = timestampMs / 1000;
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const video = videoRef.current;
    if (!file || !video) return;

    setResult(null);
    setStatus('processing');
    setProgress(0);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    video.src = url;
    try {
      // Guard against corrupt/unsupported files where `loadedmetadata` never
      // fires — without a timeout the UI would hang on "Обработка…" forever.
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error('metadata load timed out')),
          METADATA_TIMEOUT_MS,
        );
        video.onloadedmetadata = () => { clearTimeout(timer); res(); };
        video.onerror = () => { clearTimeout(timer); rej(new Error('video decode error')); };
      });

      const r = await analyzeServe(video, handedness, setProgress, {
        model,
        visibilityThreshold: visTh,
        maxLowVisFraction: maxLowVis,
      });
      setResult(r);
      if (r.ok) {
        setStatus('done');
      } else {
        setStatus('error');
        setErrorMsg(ERROR_TEXT[r.error.kind] ?? r.error.detail);
        setErrorDetail(r.error.detail);
      }
    } catch (err) {
      // metadata load / decode failure from the await above
      setStatus('error');
      setErrorMsg('Не удалось прочитать видео. Попробуйте другой файл.');
      setErrorDetail(String(err));
    }
  }

  return (
    <main className="app">
      <h1>Анализ подачи</h1>
      <div className="controls">
        <input type="file" accept="video/*" onChange={onFile} />
        <label>
          <input
            type="radio" name="hand" checked={handedness === 'right'}
            onChange={() => setHandedness('right')}
          /> Правша
        </label>
        <label>
          <input
            type="radio" name="hand" checked={handedness === 'left'}
            onChange={() => setHandedness('left')}
          /> Левша
        </label>
      </div>

      <details className="settings" open>
        <summary>Настройки распознавания</summary>
        <div className="settings-grid">
          <label>
            Модель MediaPipe
            <select value={model} onChange={(e) => setModel(e.target.value as PoseModel)}>
              <option value="lite">lite — быстрая, менее точная</option>
              <option value="full">full — точнее, чуть медленнее</option>
              <option value="heavy">heavy — самая точная, большой объём/медленно</option>
            </select>
          </label>
          <label>
            Порог видимости сустава: {visTh.toFixed(2)}
            <input
              type="range" min={0.1} max={0.9} step={0.05} value={visTh}
              onChange={(e) => setVisTh(Number(e.target.value))}
            />
            <small>Ниже — терпимее к «неуверенным» суставам.</small>
          </label>
          <label>
            Доля «плохих» кадров для отказа: {Math.round(maxLowVis * 100)}%
            <input
              type="range" min={0.3} max={0.95} step={0.05} value={maxLowVis}
              onChange={(e) => setMaxLowVis(Number(e.target.value))}
            />
            <small>Выше — пытаться анализировать даже шумные клипы.</small>
          </label>
        </div>
      </details>

      <div className="stage">
        <video ref={videoRef} controls className="video" />
        {(status === 'done' || status === 'error') && result && result.poses.length > 0 && (
          <SkeletonOverlay
            videoRef={videoRef}
            poses={result.poses}
            phases={result.ok ? result.phases : undefined}
            visibilityThreshold={visTh}
          />
        )}
      </div>

      {status === 'processing' && <p>Обработка: {Math.round(progress * 100)}%</p>}
      {status === 'error' && (
        <div className="error">
          <p>{errorMsg}</p>
          {errorDetail && <p className="error-detail">Подробно: {errorDetail}</p>}
          {result && !result.ok && result.poses.length > 0 && (
            <p className="error-detail">
              Скелет показан поверх видео (предпросмотр). Перематывайте видео, чтобы осмотреть детекцию:
              красные точки — суставы, в которых MediaPipe не уверен.
            </p>
          )}
        </div>
      )}

      {status === 'done' && result?.ok && (
        <>
          <PhaseBar phases={result.phases} />
          <h2 className="report-title">Правила ({result.ruleResults.length})</h2>
          <RulesReport results={result.ruleResults} onSeek={seekTo} />
          <AdviceList findings={result.findings} />
        </>
      )}
    </main>
  );
}
