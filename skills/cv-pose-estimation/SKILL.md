---
name: cv-pose-estimation
description: Работа с MediaPipe Pose для трекинга позы в теннисе — индексы 33 landmarks, расчёт углов суставов, сглаживание траекторий, обработка visibility. Читай перед работой с pose data, расчётом метрик по скелету, или интеграцией MediaPipe.
---

# Скилл: CV Pose Estimation (MediaPipe) для тенниса

## Когда использовать

Перед любой задачей, которая:
- Работает с landmarks позы (точки скелета)
- Считает углы суставов, расстояния, скорости
- Интегрирует MediaPipe Pose в код
- Сглаживает / фильтрует pose-trajectory

## MediaPipe Pose: 33 landmarks

MediaPipe BlazePose возвращает **33 landmarks** на кадр, каждый с `{x, y, z, visibility}`.

```
 0: nose
 1-10: face (eyes, ears, mouth)               ← для тенниса почти не нужны
11: left shoulder    12: right shoulder
13: left elbow       14: right elbow
15: left wrist       16: right wrist          ← ракеточная/тоссовая рука
17-22: hands (pinky, index, thumb, kp tips)   ← мелкая моторика, обычно игнорируем
23: left hip         24: right hip
25: left knee        26: right knee
27: left ankle       28: right ankle
29-32: feet
```

### Нормализация координат
- `x, y` — **нормализованные** [0, 1] относительно ширины/высоты кадра
- `z` — глубина, относительно центра бёдер (меньше = ближе к камере). **Менее надёжна**, используем осторожно
- `visibility` — [0, 1], вероятность что landmark виден и не окклюдирован. **Критична** для фильтрации

### Какие landmarks важны для тенниса

| Landmark | Зачем |
|---|---|
| 15, 16 (wrists) | Тоссовая и ракеточная рука; детекция trophy, contact |
| 13, 14 (elbows) | Угол локтя (выпрямление при контакте) |
| 11, 12 (shoulders) | Опорные точки для углов руки, ориентация туловища |
| 23, 24 (hips) | Центр масс, высота прыжка, стабильность |
| 25, 26 (knees) | Угол сгиба колена (knee bend в trophy) |
| 0 (nose), 27/28 (ankles) | Ориентиры «голова» и «ноги» для вертикали |

## Расчёт углов суставов

### Угол в суставе (3 точки)
Угол в точке B для тройки (A, B, C):

```typescript
function jointAngle(a: Point, b: Point, c: Point): number {
  // Вектора от B к A и от B к C
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const cos = (ba.x * bc.x + ba.y * bc.y) /
              (Math.hypot(ba.x, ba.y) * Math.hypot(bc.x, bc.y));
  // Защита от численных ошибок (cos может чуть выйти за [-1,1])
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}
```

### Полезные углы для тенниса
- **Knee flexion (сгиб колена):** hip(23/24) → knee(25/26) → ankle(27/28)
  - 180° = прямая нога, меньше = больше согнут
- **Elbow extension (локоть):** shoulder(11/12) → elbow(13/14) → wrist(15/16)
  - 180° = прямая рука (важно для contact)
- **Shoulder abduction (плечо):** hip → shoulder → elbow (поднята ли рука)

### Нюанс с 2D
- MediaPipe даёт **2D (x,y)** и **z** (глубина)
- Углы, считаемые в 2D, могут быть **неточны** когда движение в глубину (напр. рука уходит к/от камеры)
- На прототипе: **полагаемся на 2D-углы**, помечаем что depth неточен; компенсируем tolerance-зонами в правилах (см. serve-error-detection)

## Сглаживание траекторий

Pose estimation зашумлена. Прежде чем детектить экстремумы/события — **сглаживаем**.

### Рекомендуемый подход: Moving average (простой и достаточный для прототипа)
```typescript
function smooth(values: number[], windowSize = 5): number[] {
  // центрированное скользящее среднее
  const out = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < values.length) { sum += values[k]; count++; }
    }
    out.push(sum / count);
  }
  return out;
}
```

### Когда рассматривать Kalman / One-Euro
- Moving average вводит **задержку** пиков (~windowSize/2 кадров)
- Для детекции фаз это обычно приемлемо (tolerance ±2 кадра)
- Если пики «плывут» — переключаемся на **One-Euro filter** (адаптивный, low lag для быстрых движений)

### Что сглаживать
- Координаты ключевых landmarks (wrists, knees, hips) — да
- Visibility — нет (это already-фильтрованная уверенность)
- Производные метрики (углы) — можно считать **после** сглаживания координат, либо сглаживать сами углы. Сначала сглаживать координаты обычно лучше.

## Фильтрация по visibility

Не все landmarks надёжны каждый кадр. Правила:

1. **Порог visibility** — если `visibility < THRESHOLD`, помечаем landmark как ненадёжный
   - `THRESHOLD ≈ 0.5` — типичный эмпирический минимум для анализа
2. **Гэпы** — если landmark пропал на несколько кадров, интерполируем (если гэп короткий, <5 кадров) либо помечаем фазу как low-confidence
3. **Отказ от анализа** — если критичные landmarks (wrists, shoulders) ненадёжны на большей части подачи → не анализируем, показываем «не удалось распознать подачу, переснимите»

## Локальные экстремумы (для детекции событий)

Детекция trophy/contact основана на **локальных максимумах/минимумах** сглаженных траекторий.

```typescript
function localMaxima(values: number[], minProminence = 0): number[] {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i-1] && values[i] >= values[i+1]) {
      // prominence-фильтр: пик должен выделяться
      peaks.push(i);
    }
  }
  return peaks;
}
```

- `minProminence` отсекает шум (мелкие дрожания не должны считаться пиками)
- Для **контактного пика** ракеточной руки prominence должен быть существенным (рука поднимается заметно)

## Интеграция MediaPipe в браузере

### Рекомендуемый пакет
- `@mediapipe/tasks-vision` — современный Tasks API (PoseLandmarker)
- Альтернатива: legacy `@mediapipe/pose`

### Поток обработки видео-файла
```
1. <video> element загружает файл
2. Для каждого кадра (через requestVideoFrameCallback или по таймеру):
   a. Извлекаем ImageBitmap / рисуем на canvas
   b. poseLandmarker.detectForVideo(bitmap, timestamp)
   c. Сохраняем landmarks в массив
3. После прохода всего видео: сглаживание → расчёт метрик → детекция фаз
```

### FPS / производительность
- `detectForVideo` на mid-range устройстве: ~20-30 FPS
- Для видео-файла это **не real-time** — обрабатываем кадр-за-кадром, показываем progress
- Не гонимся за 60fps, важно **сэмплировать все кадры** (или ≥30fps) чтобы не пропустить быстрые события (contact)

## Типичные ошибки при работе с pose data

1. **Забыть сглаживать** → детектор фаз находит «пики» от шума
2. **Считать угол в 2D для движения в глубину** → неверный угол. Проверять visibility и помечать low-confidence
3. **Игнорировать visibility** → анализ окклюдированных landmarks даёт бред
4. **Перепутать лево/право** → MediaPipe даёт landmarks относительно **зеркального** отображения (как видит камера). Проверить convention в тестах.
5. **Магические пороги без источника** → см. `docs/task-rules.md` §6, все пороги в именованные константы

## Связанные
- Полный референс биомеханики: `docs/biomechanics/serve-phases.md`
- Детекция фаз по landmarks: скилл `tennis-serve-phases`
- Правила ошибок: скилл `serve-error-detection`
- Источник порогов: эмпирически + Chow et al., MDPI/Frontiers 2024 (см. research/)
