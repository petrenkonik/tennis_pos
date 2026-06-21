# Сквозной CV-пайплайн MVP («ходячий скелет»)

**Дата:** 2026-06-20
**Статус:** На ревью
**Слои анализа:** Слой 1 (простые советы). Слой 2 — метрики считаются, но не рендерятся. Слой 3 — вне скоупа.

## Контекст

Прототип `tennis_pos` валидирует, что CV-пайплайн умеет разбивать теннисную подачу на фазы и находить ошибки (см. `AGENTS.md`, ADR-0001, ADR-0002). Кодовой базы ещё нет. Это **первая спецификация** — сквозной «ходячий скелет»: минимум на каждой стадии, но сквозь весь поток `видео → поза → фазы → ошибки → фидбек`.

Цель среза — доказать, что связка работает end-to-end на реальном клипе. Точность детекции и калибровка порогов — следующий этап, отдельной спекой.

## Цели / Не цели

### Цели
- Сквозной поток на реальном видео-клипе подачи (сбоку, ≤30с): загрузка → pose-экстракция (MediaPipe) → детекция 4 фаз → одно правило ошибки → фидбек Слоя 1.
- Детектируются все 4 фазы (preparation / trophy / acceleration / follow-through) из трёх событий (trophy, contact, follow-through start).
- Одно работающее правило ошибки — **C3 (недостаточный сгиб коленей)**.
- Чистое, тестируемое на синтетике алгоритмическое ядро (TDD по `task-rules §3`).
- Архитектура, готовая к добавлению правил без изменения ядра.

### Не цели (явный YAGNI)
- Трекинг мяча (YOLO) — contact детектим по руке.
- Слои 2 и 3 в UI (метрики считаются, но не показываются; эталонный скелет — нет).
- Web Worker (обработка синхронно в main thread + прогресс-бар).
- Автодетект handedness (на MVP — ручной тоггл).
- Отдельная детекция начала acceleration (trophy — точечная фаза).
- Несколько подач в одном клипе (ожидаем один сервис на видео).
- Точность ±2 кадра и измерение false positives — критерии следующего этапа.

## Архитектура

Подход A (выбран): стадийный пайплайн из чистых функций с типизированным контрактом данных. Единственный impure-модуль — `extractPoses` (MediaPipe, `<video>`); всё ниже по потоку — чистые функции `(данные) → данные`, тестируемые на синтетических позах без браузера. Ядро спроектировано так, чтобы позже завернуться в Web Worker без переписывания.

### Карта модулей

```
src/
├── pipeline/
│   ├── extractPoses.ts      ⚠️ IMPURE — единственный модуль, знающий о MediaPipe и <video>
│   ├── smooth.ts            ✅ pure — сглаживание траекторий
│   ├── detectPhases.ts      ✅ pure — детекция событий и разбиение на фазы
│   ├── buildPhaseContext.ts ✅ pure — сбор метрик для правил
│   ├── runRules.ts          ✅ pure — прогон правил, сортировка findings
│   └── analyzeServe.ts      🔌 оркестратор: склейка стадий + обработка ошибок (без логики)
├── rules/
│   ├── types.ts             ErrorRule, Finding
│   └── ruleC3.ts            недостаточный сгиб коленей
├── pose/
│   ├── landmarks.ts         именованные индексы 33 landmarks + геттеры racketWrist/tossWrist
│   └── geometry.ts          jointAngle(), localMaxima() и пр. (из cv-pose-estimation)
├── constants/
│   └── biomechanics.ts      ВСЕ пороги с комментарием-источником
├── ui/                      React-компоненты (Слой 1)
└── __tests__/fixtures/      синтетические позы + тестовый видео-клип
```

### Поток данных

```
extractPoses(video) ─► PoseFrame[]           // IMPURE граница (MediaPipe из CDN)
  ─► smooth(poses) ─► PoseFrame[]             // pure
  ─► detectPhases(poses, fps, handedness) ─► Phases
  ─► buildPhaseContext(poses, fps, phases) ─► PhaseContext
  ─► runRules(ctx, [ruleC3]) ─► Finding[]
  ─► <Feedback> (React, Слой 1)
```

Оркестратор `analyzeServe()` вызывает стадии по порядку и преобразует доменные ошибки в состояние UI.

### Ключевые архитектурные решения

1. **Граница impure/pure.** Вся «грязь» (декод видео, MediaPipe, canvas) заперта в `extractPoses.ts`. Делаем X, потому что Y: ядро становится тестируемым на синтетике без видео/браузера (`task-rules §3`).
2. **Метрики считаются в `buildPhaseContext`, правила их только читают.** `kneeFlexionAtTrophyDeg` уже вычислен при детекции trophy (trophy = кадр минимума угла колена) и переносится в `PhaseContext.metrics`. Правило C3 читает готовое значение, не пересчитывает геометрию. Это даёт переиспользование и простые unit-тесты правил (`makeCtx({...})`).
3. **`runRules` принимает массив правил.** Добавить правило = новый файл в `rules/` + (опц.) метрика в `buildPhaseContext`, **без изменения** `detectPhases` и контрактов.
4. **`confidence` протекает сквозь поток.** Низкая visibility / fallback-разбивка → `Phases.confidence = 'low'` → `Finding.confidence = 'low'` → мягкие формулировки в UI.
5. **Handedness локализован в геттерах** `racketWrist/tossWrist` (`pose/landmarks.ts`) — путаница лево/право не расползается по алгоритмам.

### Детекция фаз (алгоритм)

Перед детекцией обязательно `smooth()` (центрированное скользящее среднее, окно `SMOOTH_WINDOW_FRAMES≈5`; `visibility` не сглаживаем). Источник логики — скиллы `tennis-serve-phases` и `cv-pose-estimation`.

- **trophy (опорное событие):** кадр **минимального угла колена** (макс. сгиб; `jointAngle(hip, knee, ankle)`, берём более согнутую ногу) среди кадров, где ракеточное запястье выше носа (`racketWrist.y < nose.y`). Угол колена в этом кадре сохраняется как `kneeFlexionAtTrophyDeg`.
- **contact:** локальный максимум высоты ракеточного запястья (`1 - y`) **после** trophy, где локоть выпрямлен (`elbowAngle ≥ CONTACT_ELBOW_MIN_DEG≈160`). Если нет — глобальный максимум после trophy + `confidence: low`.
- **follow-through start:** первый кадр после contact, где `racketWrist.y > shoulder.y` (запястье ниже плеча).

Сборка фаз (арифметика):
```
preparation:   [0,            trophyFrame]
trophy:        [trophyFrame,  accelStart]      // accelStart = trophyFrame + 1
acceleration:  [accelStart,   contactFrame]
followThrough: [contactFrame, last]
```

**Решение:** граница trophy→acceleration на MVP не детектируется, `accelStart = trophyFrame + 1` (trophy — точечная фаза).
**Альтернатива (future):** детектить начало acceleration по первому кадру после trophy, где угол колена начинает расти (ноги разгибаются → толчок вверх). Отложено: +1 событие и +1 набор тестов, для валидации связки не нужно.

### Fallback и инварианты

- **Trophy не выражен** (нет кадров с ракеткой над головой / сгиб колена почти не меняется) → разбивка по времени (`preparation ~60% / acceleration ~20% / followThrough ~20%` длины клипа) + `confidence: low`.
- **Критичные landmarks ниже `VISIBILITY_THRESHOLD≈0.5` на большой доле кадров** → `confidence: low`; если совсем плохо → доменная ошибка `serve-not-recognized`.
- **Гэп visibility <5 кадров** → интерполяция; длиннее → фаза low-confidence.
- **Инвариант** `0 ≤ trophyFrame < contactFrame < followStartFrame ≤ last`; при нарушении (шум) → `confidence: low` без краша (покрыто тестом).

### Правило C3 и фидбек (Слой 1)

`ruleC3` читает `ctx.metrics.kneeFlexionAtTrophyDeg`, сравнивает с tolerance-зоной `KNEE_FLEXION_NORMAL_RANGE_DEG`:
- угол `≤ max` → `null` (сгиб достаточный или глубже — ошибки нет);
- немного выше `max` → `warn`; выше `max + KNEE_FLEXION_ERROR_MARGIN_DEG` → `error`.

Важно: угол растёт = сгиб уменьшается (180° = прямая нога), поэтому «мало сгиба» = `angle > max` — это сопровождается явным комментарием в коде. Совет — текст без анатомии. `Finding.metric` заполняется (данные Слоя 2), но на Слое 1 UI его не рендерит — правило не знает про слои отображения.

UI (минимальный, React): загрузка файла + тоггл правша/левша; `<video>` с canvas-оверлеем скелета и подписью текущей фазы; прогресс-бар обработки; полоса 4 фаз; список советов из `Finding[]` (отсортирован по severity, с confidence-бейджем). Слои 2/3 в UI скелета не показываются.

### Pose-экстракция, handedness, ошибки

- `extractPoses` использует `@mediapipe/tasks-vision` (`PoseLandmarker`, режим VIDEO); веса грузятся из CDN — единственный разрешённый внешний запрос (ADR-0001). Кадры — через `requestVideoFrameCallback` с фолбэком на seek-цикл. `fps` оценивается из медианы дельт `timestampMs`. `onProgress` → прогресс-бар.
- **Handedness:** ручной тоггл (дефолт «правша»). *Альтернатива (future):* автодетект по тоссовой руке на интервале release.
- **Доменные ошибки** (`AnalysisError`): `pose-extraction-failed`, `serve-not-recognized`, `video-too-long` (> `MAX_CLIP_SECONDS=30`). Оркестратор отдаёт их UI как состояние, не как краш.

## Интерфейсы

```typescript
interface Landmark { x: number; y: number; z: number; visibility: number; }
// x,y нормализованы [0,1]; y растёт вниз (image space): «выше» = меньший y. z ненадёжен, почти не используем.

interface PoseFrame { frameIndex: number; timestampMs: number; landmarks: Landmark[]; } // landmarks.length === 33

type Handedness = 'right' | 'left';
type Confidence = 'low' | 'medium' | 'high';

interface Phases {
  handedness: Handedness;
  events: { trophyFrame: number; contactFrame: number; followStartFrame: number };
  phases: {
    preparation:   [number, number];   // [startFrame, endFrame]
    trophy:        [number, number];
    acceleration:  [number, number];
    followThrough: [number, number];
  };
  confidence: Confidence;
}

interface PhaseContext {
  poses: PoseFrame[];
  fps: number;
  phases: Phases;
  metrics: { kneeFlexionAtTrophyDeg: number; /* + метрики будущих правил */ };
}

interface Finding {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  confidence: Confidence;
  advice: string;                       // Слой 1: текст без анатомии
  metric?: { name: string; value: number; unit: string; referenceRange?: [number, number] };
}

interface ErrorRule {
  id: string;
  phase: keyof Phases['phases'];
  layer: 1 | 2 | 3;
  title: string;
  check: (ctx: PhaseContext) => Finding | null;   // null = ошибки нет / нельзя определить
}

// Стадии пайплайна
function extractPoses(video: HTMLVideoElement, onProgress?: (frac: number) => void)
  : Promise<{ poses: PoseFrame[]; fps: number }>;            // IMPURE
function smooth(poses: PoseFrame[], window?: number): PoseFrame[];
function detectPhases(poses: PoseFrame[], fps: number, handedness: Handedness): Phases;
function buildPhaseContext(poses: PoseFrame[], fps: number, phases: Phases): PhaseContext;
function runRules(ctx: PhaseContext, rules: ErrorRule[]): Finding[];

// Оркестратор
type AnalysisError =
  | { kind: 'pose-extraction-failed'; detail: string }
  | { kind: 'serve-not-recognized';   detail: string }
  | { kind: 'video-too-long';         detail: string };
type AnalysisResult =
  | { ok: true; phases: Phases; findings: Finding[]; poses: PoseFrame[] }
  | { ok: false; error: AnalysisError };
function analyzeServe(video: HTMLVideoElement, handedness: Handedness,
  onProgress?: (frac: number) => void): Promise<AnalysisResult>;

// Геометрия / landmarks (pose/)
function jointAngle(a: Landmark, b: Landmark, c: Landmark): number;   // угол в B, градусы
function racketWrist(f: PoseFrame, h: Handedness): Landmark;
function tossWrist(f: PoseFrame, h: Handedness): Landmark;
```

Все числовые пороги — именованные константы в `src/constants/biomechanics.ts` с комментарием-источником:
`SMOOTH_WINDOW_FRAMES`, `VISIBILITY_THRESHOLD`, `CONTACT_ELBOW_MIN_DEG`, `KNEE_FLEXION_NORMAL_RANGE_DEG`, `KNEE_FLEXION_ERROR_MARGIN_DEG`, `MAX_CLIP_SECONDS`, доли fallback-разбивки.

## Метрики успеха

Критерий выбран: **собранный end-to-end поток** (точность вторична).

1. На реальном тестовом клипе (≤30с, сбоку) `analyzeServe()` отрабатывает без `AnalysisError` и возвращает `Phases` с `trophyFrame < contactFrame < followStartFrame`.
2. UI показывает 4 фазы на полосе и ≥1 совет (или явное «ошибок не найдено»), плюс оверлей-скелет на видео.
3. Все unit-тесты ядра зелёные; интеграционный прогон на клипе-фикстуре проходит.
4. Объяснимость: каждый показанный совет — текст без анатомии; каждый порог — именованная константа с источником в `biomechanics.ts`.

**Явно НЕ метрика этого этапа:** точность детекции в кадрах (±2 кадра) и доля false positives правила C3 — следующий этап (калибровка), отдельной спекой.

### Тестирование (TDD-first, на синтетике)

| Модуль | Пример теста |
|---|---|
| `pose/geometry` | `jointAngle` прямого угла = 90°; вырожденные точки не падают |
| `smooth` | константный ряд неизменен; шумовой пик гасится; края не теряются |
| `detectPhases` | минимум колена на кадре N + ракетка над головой → `trophyFrame === N` |
| `detectPhases` | пик высоты запястья после trophy при выпрямленном локте → `contactFrame === M` |
| `detectPhases` (fallback) | нет выраженного trophy → `confidence: 'low'` + разбивка по времени |
| `detectPhases` (инвариант) | нарушенный порядок событий → `confidence: 'low'`, без краха |
| `ruleC3` | `makeCtx({ kneeFlexionAtTrophyDeg: 12 })` → есть `severity`; `28` → `null`; значение ровно на границе |
| `runRules` | сортировка error→warn→info; null-findings отфильтрованы |

Граничные кейсы: значение на пороге; low-visibility → null/low-confidence; пустая/короткая фаза.
Интеграционный (1 тест): `analyzeServe()` на видео-фикстуре → без ошибок, 4 фазы в правильном порядке, `findings` — массив (кадры не ассертим).
Ручная проверка: dev-сервер, загрузка клипа, визуальная сверка оверлея и подписей фаз.

## Риски / открытые вопросы

- **MediaPipe FPS / производительность** — обработка не real-time; митигируем прогресс-баром и лимитом 30с (ADR-0001).
- **2D-углы при движении в глубину** неточны (`cv-pose-estimation`) — на скелете принимаем, компенсируем tolerance-зонами и confidence; критерий успеха — поток, не точность.
- **Trophy может быть не выражен** у «плоских» подач — есть fallback по времени + low-confidence.
- **Пороги в `biomechanics.ts` пока не калиброваны** — на скелете берём литературные/оценочные значения; калибровка на тестовых подачах — следующий этап.
- **Один тестовый клип** на интеграцию — достаточно для критерия «связка собрана»; для точности понадобится golden-разметка нескольких подач (следующий этап).
- **Лево/право в MediaPipe зеркальны** — convention фиксируется тестами в `pose/landmarks.ts`.

## Связанные
- `AGENTS.md`, `docs/task-rules.md`
- ADR-0001 (стек), ADR-0002 (rule-based)
- Скиллы: `tennis-serve-phases`, `cv-pose-estimation`, `serve-error-detection`
- Биомеханика: `docs/biomechanics/serve-phases.md`
