# ADR-0001: Prototype Technology Stack

**Date:** 2026-06-20
**Status:** Accepted

## Context

We need to pick the platform, video source, and CV stack for the serve-analysis prototype.

## Options considered

### Platform
- iOS native (Swift, Core ML)
- Android native (Kotlin, ML Kit)
- Cross-platform (RN/Flutter)
- **Web prototype (CV validation)** ✅

### Video source
- Live camera streaming
- **Video file upload** ✅

### CV stack
- Python backend + MediaPipe/YOLO
- **All in the browser (MediaPipe JS / TF.js)** ✅
- Notebook/Streamlit

## Decision

**Web prototype, everything in the browser via MediaPipe JS / TF.js, video-file upload.**

## Rationale

1. The **web prototype** lets us iterate quickly on CV algorithms without the pain of mobile integration, builds, and device deploys. The prototype's goal is to validate *algorithms*, not UX.
2. **Everything in the browser** — zero server infrastructure. Matches the future mobile product (on-device processing), simplifies deployment (static files), and removes privacy concerns (video never leaves the device).
3. **Video-file upload** — the user controls the shooting conditions, there are no browser real-time limits, and the device doesn't have to be held still. Easier to debug on known test videos.

## Consequences

### Positive
- No backend → no hosting cost, no privacy questions
- Deployment = static hosting (GitHub Pages / any CDN)
- Close to the final mobile UX (on-device)
- Fast iteration on algorithms

### Negative / risks
- MediaPipe JS may have a **lower FPS** than a native mobile SDK — acceptable for video-file analysis (not real-time)
- Less control over model detail than in a Python pipeline — compensated by careful landmark processing
- Browser memory limits for long videos — for the prototype we cap length (e.g. ≤30s of a single serve)

### Constraints this imposes
- **No server calls, API keys, or backend.** Loading MediaPipe model weights from a CDN is allowed.
- ML classifiers and LLMs (future-work) will require revisiting this ADR when they come up.

## Related
- [ADR-0002: Rule-based phase analysis](./0002-rule-based-approach.md)
