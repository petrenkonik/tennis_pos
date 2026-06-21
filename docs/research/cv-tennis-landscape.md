# Исследование: CV и Pose Tracking в теннисе

> Сохранено из исследования, проведённого 2026-06-20 перед стартом разработки.
> Цель — зафиксировать контекст рынка, технологий и конкурентов, чтобы не пересобирать его заново.

## 1. Академическая база: фазы подачи

Золотой стандарт — **8-стадийная модель** (Chow et al., PMC/NIH), которая группируется в **3 макро-фазы**:

| Макро-фаза | Стадии | Что происходит |
|---|---|---|
| **Preparation** | Stance → Release → Toss → Knee flexion | Исходная стойка, подброс мяча, сгибание коленей |
| **Acceleration** | Hip/trunk rotation → External shoulder rotation (**Trophy position**) → Internal rotation → **Contact** | Кинематическая цепь, разгон, удар |
| **Follow-through** | Follow-through | Торможение, завершение |

Подтверждено свежими систематическими обзорами (Frontiers 2024, MDPI 2024, JSAMS 2023). Это даёт готовую таксономию для разбиения подачи по фазам.

См. подробнее: [`docs/biomechanics/serve-phases.md`](../biomechanics/serve-phases.md).

## 2. Ключевые метрики для оценки

Что реально измеряют существующие решения (OnCourtAI, APOPT):

- **Ball toss height** — высота подброса
- **Trophy position** — позиция «трофея» (ракетка за головой, колени согнуты)
- **Knee bend angle** — угол сгиба коленей
- **Contact point** — точка контакта (высота + положение)
- **Serve speed estimation** — скорость подачи

## 3. Технологии CV

| Задача | Инструмент | Зачем |
|---|---|---|
| **Pose tracking (33 точки)** | MediaPipe BlazePose | 30+ FPS на mid-range телефоне, on-device |
| **Ball/racket detection** | YOLO + PyTorch | Трекинг мяча и ракетки |
| **Детекция ошибок по траектории** | Feature-point trajectory algorithms | Поиск ошибок в подаче |

### MediaPipe BlazePose

- Выводит **33 2D/3D landmarks** с одного кадра
- On-device, real-time, оптимизирован для мобильных
- Граф-ориентированный perception framework
- Репозиторий: google-ai-edge/mediapipe

### On-device vs Cloud

| | On-device (MediaPipe) | Cloud |
|---|---|---|
| Latency | Очень низкая, 30+ FPS | Зависит от сети |
| Privacy | Видео не покидает телефон | Нужно загружать |
| Offline | Работает | Нет |
| Battery | Грузит CPU/GPU/NPU | Меньше локально, но сеть жрёт |

**Вывод исследования:** on-device — стандарт для спортивных приложений в 2025. Соответствует нашему выбору «всё в браузере».

## 4. Конкуренты

- **SwingVision** (swing.vision) — лидер рынка. AI-статы, скорость подачи, line calling. **Слабое место:** фокус на *матчевой* аналитике, а не детальном разборе *техники тела*. iOS.
- **adeeteya/Tennis-Serve-Analysis** — open-source, прямо наша идея. На Google Play. Хороший референс для архитектуры.
- **PlaySight** — нужны спец. камеры/court (smart court). B2B.
- **Sportretina** — pose estimation без сенсоров.
- **Spintip** — AI-нарезка хайлайтов матча.
- **Zenniz SmartView** — видео-аналитика матча.

## 5. Ниша (белое пятно)

Из сравнения конкурентов: SwingVision и большинство решений сильны в **match analytics** (статы, счёт, скорость), но слабы в **stroke technique / body mechanics**.

> Приложение, которое **разбивает подачу на фазы + показывает конкретные ошибки в движении тела по биомеханике** — это недозаполненная ниша.

Идея tennis_pos прямо попадает в это белое пятно.

### Что просят пользователи (Reddit r/10s)

Из обсуждений самодельного serve-analysis приложения:
- Трекинг **вариативности тайминга** между подачами
- Анализ **подброса** (consistency)
- **Траектория ракетки** по серии подач
- Сравнение подач друг с другом

Это — кандидаты на будущие фичи (layer 2/3).

## 6. Источники

### Академические
- [An 8-Stage Model for Evaluating the Tennis Serve — PMC/NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC3445225/)
- [Kinematics Characteristics During Tennis Serve — Frontiers 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1432030/full)
- [Influence of Kinematics on Tennis Serve Speed — MDPI 2024](https://www.mdpi.com/2306-5354/11/10/971)
- [Biophysical Characterization of the Tennis Serve — JSAMS 2023](https://www.jsams.org/article/S1440-2440(23)00460-7/fulltext)
- [Detection Algorithm of Tennis Serve Mistakes Based on Feature Point Trajectory — ResearchGate](https://www.researchgate.net/publication/360831841)

### Технологии
- [BlazePose — Google Research](https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/)
- [BlazePose — arXiv](https://arxiv.org/abs/2006.10204)
- [MediaPipe for Sports Apps — it-jim](https://www.it-jim.com/blog/mediapipe-for-sports-apps/)
- [MediaPipe Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)

### Конкуренты
- [SwingVision](https://swing.vision/)
- [adeeteya/Tennis-Serve-Analysis (GitHub)](https://github.com/adeeteya/Tennis-Serve-Analysis)
- [OnCourtAI serve metrics](https://www.oncourtai.co.uk/tennis-serve-analysis)
- [Sportretina: Pose Estimation for Tennis](https://sportretina.com/blog/pose-estimation-utilising-ai-to-improve-tennis-technique/)
- [SportsReflector vs SwingVision](https://sportsreflector.com/vs/swingvision)

### User research
- [Reddit: r/10s — самодельное serve analysis приложение](https://www.reddit.com/r/10s/comments/1pu2tis/built_a_serve_analysis_app_for_myself_would_this/)
