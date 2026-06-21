# Research: CV and Pose Tracking in Tennis

> Saved from the research done on 2026-06-20 before development started.
> Goal — to lock in the market, technology, and competitor context so we don't reassemble it later.

## 1. Academic basis: serve phases

The gold standard is the **8-stage model** (Chow et al., PMC/NIH), grouped into **3 macro-phases**:

| Macro-phase | Stages | What happens |
|---|---|---|
| **Preparation** | Stance → Release → Toss → Knee flexion | Initial stance, ball toss, knee bend |
| **Acceleration** | Hip/trunk rotation → External shoulder rotation (**Trophy position**) → Internal rotation → **Contact** | Kinematic chain, acceleration, hit |
| **Follow-through** | Follow-through | Deceleration, finish |

Corroborated by recent systematic reviews (Frontiers 2024, MDPI 2024, JSAMS 2023). This gives a ready-made taxonomy for splitting a serve into phases.

See more: [`docs/biomechanics/serve-phases.md`](../biomechanics/serve-phases.md).

## 2. Key metrics to evaluate

What existing solutions (OnCourtAI, APOPT) actually measure:

- **Ball toss height** — toss height
- **Trophy position** — the "trophy" position (racket behind the head, knees bent)
- **Knee bend angle** — knee flexion angle
- **Contact point** — contact point (height + placement)
- **Serve speed estimation** — serve speed

## 3. CV technologies

| Task | Tool | Why |
|---|---|---|
| **Pose tracking (33 points)** | MediaPipe BlazePose | 30+ FPS on a mid-range phone, on-device |
| **Ball/racket detection** | YOLO + PyTorch | Track the ball and racket |
| **Trajectory-based error detection** | Feature-point trajectory algorithms | Find errors in the serve |

### MediaPipe BlazePose

- Outputs **33 2D/3D landmarks** from a single frame
- On-device, real-time, optimized for mobile
- A graph-based perception framework
- Repo: google-ai-edge/mediapipe

### On-device vs Cloud

| | On-device (MediaPipe) | Cloud |
|---|---|---|
| Latency | Very low, 30+ FPS | Network-dependent |
| Privacy | Video never leaves the phone | Has to be uploaded |
| Offline | Works | No |
| Battery | Loads CPU/GPU/NPU | Less locally, but the network drains it |

**Research conclusion:** on-device is the standard for sports apps in 2025. Matches our "everything in the browser" choice.

## 4. Competitors

- **SwingVision** (swing.vision) — market leader. AI stats, serve speed, line calling. **Weak spot:** focuses on *match* analytics, not a detailed breakdown of *body technique*. iOS.
- **adeeteya/Tennis-Serve-Analysis** — open-source, exactly our idea. On Google Play. A good architecture reference.
- **PlaySight** — needs special cameras/court (smart court). B2B.
- **Sportretina** — pose estimation without sensors.
- **Spintip** — AI highlight clipping for a match.
- **Zenniz SmartView** — match video analytics.

## 5. The niche (white space)

From comparing competitors: SwingVision and most solutions are strong in **match analytics** (stats, score, speed) but weak in **stroke technique / body mechanics**.

> An app that **splits a serve into phases + shows concrete errors in body motion via biomechanics** is an underserved niche.

The tennis_pos idea lands squarely in this white space.

### What users ask for (Reddit r/10s)

From discussions about a DIY serve-analysis app:
- Tracking **timing variability** between serves
- **Toss** analysis (consistency)
- **Racket trajectory** across a serve series
- Comparing serves to one another

These are candidates for future features (layer 2/3).

## 6. Sources

### Academic
- [An 8-Stage Model for Evaluating the Tennis Serve — PMC/NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC3445225/)
- [Kinematics Characteristics During Tennis Serve — Frontiers 2024](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1432030/full)
- [Influence of Kinematics on Tennis Serve Speed — MDPI 2024](https://www.mdpi.com/2306-5354/11/10/971)
- [Biophysical Characterization of the Tennis Serve — JSAMS 2023](https://www.jsams.org/article/S1440-2440(23)00460-7/fulltext)
- [Detection Algorithm of Tennis Serve Mistakes Based on Feature Point Trajectory — ResearchGate](https://www.researchgate.net/publication/360831841)

### Technologies
- [BlazePose — Google Research](https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/)
- [BlazePose — arXiv](https://arxiv.org/abs/2006.10204)
- [MediaPipe for Sports Apps — it-jim](https://www.it-jim.com/blog/mediapipe-for-sports-apps/)
- [MediaPipe Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)

### Competitors
- [SwingVision](https://swing.vision/)
- [adeeteya/Tennis-Serve-Analysis (GitHub)](https://github.com/adeeteya/Tennis-Serve-Analysis)
- [OnCourtAI serve metrics](https://www.oncourtai.co.uk/tennis-serve-analysis)
- [Sportretina: Pose Estimation for Tennis](https://sportretina.com/blog/pose-estimation-utilising-ai-to-improve-tennis-technique/)
- [SportsReflector vs SwingVision](https://sportsreflector.com/vs/swingvision)

### User research
- [Reddit: r/10s — DIY serve analysis app](https://www.reddit.com/r/10s/comments/1pu2tis/built_a_serve_analysis_app_for_myself_would_this/)
