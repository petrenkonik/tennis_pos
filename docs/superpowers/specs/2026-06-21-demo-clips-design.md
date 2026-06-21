# Demo Clips — one-click sample serve

**Date:** 2026-06-21
**Status:** Under review
**Analysis layers:** Layer 1 (UI + upload flow). No change to layers 2 or 3.

## Context

The prototype (`docs/superpowers/specs/2026-06-20-cv-pipeline-mvp-design.md`) currently requires the user to upload their own serve video before anything happens. For demos, onboarding, and tester handoff we want a **one-click "Try a demo serve"** button that loads a pre-bundled `.mp4` from `public/demo/clips/` and runs the exact same `analyzeServe` pipeline as an upload.

This slice adds **no new logic**. The CV pipeline, phase detection, and error rules are reused as-is. Only the input source changes: instead of an uploaded `File`, the demo path fetches a `Blob` from `public/`, wraps it in a `File`, and feeds the existing upload handler.

## Goals / Non-goals

### Goals
- A "Try a demo serve" button in the existing upload card that loads a bundled `.mp4` and runs the full `video → pose → phases → rules → UI` flow with no file picker.
- The demo path reuses the upload code path (`loadVideoFile`) — single source of truth for object-URL lifecycle, metadata-load timeout, and error mapping.
- A manifest (`src/constants/demoClips.ts`) shaped as an array so additional clips can be added later without touching the UI.
- Bilingual labels (en/ru) for the button and the clip — no inline display strings.
- The pipeline is untouched; if the demo clip is missing from `public/`, the UI surfaces a clean `video-read-failed` error instead of crashing.

### Non-goals (explicit YAGNI)
- A clip-picker UI / multiple simultaneous demo clips — the manifest holds one clip for now; the UI wires only `DEMO_CLIPS[0]`. Iterating over the array is a future change that needs no UI restructuring.
- A skeleton-snapshot fast path (pre-extracted poses as JSON) — deferred; the demo runs the real MediaPipe pipeline so the user sees the real behavior.
- Git LFS — the single short `.mp4` is committed directly to git.
- Auto-selection of the demo clip based on the user's handedness toggle — the clip's own `handedness` is applied when it loads.
- A backend / CDN for the clips — `public/` is served statically by Vite.

## Architecture

```
public/demo/clips/serve-right-side.mp4   ← static asset served at /demo/clips/…
                 │
                 │  fetch(resolveAsset(path)) → Blob → new File([blob], name)
                 ▼
src/constants/demoClips.ts   ← manifest: [{ id, titleKey, path, handedness }]
                              path is relative ('demo/clips/…'), no leading slash
                 │
                 ▼
src/lib/resolveAsset.ts      ← path → BASE_URL + path (handles sub-path deploys)
                 │
                 ▼
src/App.tsx
   loadDemo(clip)            ← fetch + wrap + setHandedness(clip.handedness)
        │
        ▼
   loadVideoFile(file, hand) ← extracted from onFile; reused by both paths
        │
        ▼
   analyzeServe(video, hand, …)   ← UNCHANGED pipeline
```

The only new module is `src/constants/demoClips.ts` (manifest + `DemoClip` type). `src/App.tsx` gains two functions: `loadVideoFile` (a mechanical extraction of the existing `onFile` body, parametrized on handedness) and `loadDemo` (fetch → `File` → `loadVideoFile`).

### Why `hand` is a parameter, not the closure var

`loadDemo` must apply the clip's handedness *before* analysis runs. Calling `setHandedness(clip.handedness)` and then reading the `handedness` closure would race — React hasn't flushed the state update when the closure captures the stale value. Passing `hand` as an explicit parameter sidesteps the race with no `useEffect` plumbing.

## Interfaces

```ts
// src/constants/demoClips.ts
import type { Handedness } from '../types';

export interface DemoClip {
  id: string;          // stable React key
  titleKey: string;    // i18n key, NOT a display string (task-rules §8)
  path: string;        // relative path (no leading slash), e.g. 'demo/clips/serve-right-side.mp4'
  handedness: Handedness; // applied to the toggle when the clip loads
}

export const DEMO_CLIPS: readonly DemoClip[];
```

```ts
// src/App.tsx — extracted + new
async function loadVideoFile(file: Blob, hand: Handedness): Promise<void>;
async function loadDemo(clip: DemoClip): Promise<void>;
```

## Success metrics

- Clicking "Try a demo serve" with a valid `.mp4` in `public/demo/clips/` runs `analyzeServe` exactly once and renders the phase bar + rules report (same as a manual upload of the same file).
- Clicking the button when the `.mp4` is **absent** shows the `errors.video-read-failed` error card within the metadata timeout — no uncaught promise rejection, no hung "Processing…".
- The existing 19 unit/integration tests still pass unchanged.
- Two new `App.test.tsx` tests cover the success path (fetch → analyzeServe called) and the failure path (HTTP 404 → error card), mirroring the existing upload-flow test pattern.
- `npm run build` (TypeScript + Vite) succeeds.

## Risks / open questions

- **Missing `.mp4` until the user supplies it.** Mitigated: `public/demo/clips/.gitkeep` reserves the directory; the failure path renders a clean error; covered by the 404 test.
- **`fetch` of a same-origin `public/` asset in dev vs prod.** Vite serves `public/` at `/` in dev, but GitHub Pages deploys under a sub-path base (`/tennis_pos/`). Vite rewrites HTML/CSS/JS asset URLs to honor `base`, but **runtime `fetch()` is not rewritten** — so the clip path must be resolved against `import.meta.env.BASE_URL` via `src/lib/resolveAsset.ts`. Holding the path relative (no leading slash) in the manifest makes this concat safe and keeps the catalog deploy-agnostic.
- **jsdom does not serve `public/`.** Tests stub `globalThis.fetch` explicitly (`vi.stubGlobal`) rather than relying on the dev server.
- **Demo clip quality.** If the user's `.mp4` is a poor side view, `analyzeServe` may return `serve-not-recognized` — but that is the *correct* pipeline behavior, not a bug in this feature.
