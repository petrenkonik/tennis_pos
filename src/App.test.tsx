import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalysisResult } from './pipeline/analyzeServe';
import { buildHappyServe } from './__tests__/fixtures/poses';

import App from './App';

/*
 * App is a single component with a lot of behavior and, as of the UI redesign,
 * zero test coverage. The single most important user flow is:
 *
 *     (idle) → pick a file → (processing) → (done | error)
 *
 * That flow was broken by the redesign: the <video> element was conditionally
 * rendered only when `status !== 'idle'`, but `onFile` reads `videoRef.current`
 * synchronously — so in `idle` the ref was null and the handler silently
 * returned. This regression slipped through because no test ever simulated a
 * file upload against the real <App/> (only pure-function pipeline tests
 * existed). This file fills that gap so the same bug can't come back unnoticed.
 *
 * `analyzeServe` is mocked at the module level (vi.mock) so the test does not
 * depend on MediaPipe or a real decodable <video>. The mock is what lets us
 * assert the upload actually reached the pipeline — that assertion is the one
 * that fails if the ref-was-null regression returns.
 */

const successResult: AnalysisResult = {
  ok: true,
  phases: {
    handedness: 'right',
    events: { trophyFrame: 2, contactFrame: 4, followStartFrame: 6 },
    phases: {
      preparation: [0, 2],
      trophy: [2, 3],
      acceleration: [3, 4],
      followThrough: [4, 6],
    },
    confidence: 'high',
  },
  findings: [],
  ruleResults: [],
  poses: buildHappyServe(),
};

// vi.mock is hoisted by Vitest above every import, so the real module is
// replaced before App.tsx pulls it in. We import the (now mocked) function
// afterwards and drive its return value per-test via vi.mocked(...).
vi.mock('./pipeline/analyzeServe', () => ({
  analyzeServe: vi.fn(),
}));

import { analyzeServe } from './pipeline/analyzeServe';

/*
 * jsdom does not implement media playback: assigning <video src="blob:...">
 * never fires `loadedmetadata`, so the `await new Promise(...)` inside onFile
 * would hang forever and the test would time out. We patch the src setter on
 * HTMLVideoElement to dispatch `loadedmetadata` (and set a sane duration)
 * synchronously on assignment, which mirrors what a real browser does once it
 * has parsed the header. Patching the prototype (not one element) means it
 * works no matter when the <video> mounts.
 */
function installJsdomVideoShim() {
  const desc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src',
  );
  Object.defineProperty(HTMLVideoElement.prototype, 'src', {
    configurable: true,
    set(this: HTMLVideoElement, value: string) {
      desc?.set?.call(this, value);
      // duration is read inside onFile via video.duration (5s, within limits).
      Object.defineProperty(this, 'duration', {
        configurable: true,
        value: 5,
      });
      // Fire async so the `await` in onFile can attach onloadedmetadata first.
      // A microtask runs after the current synchronous block completes, which
      // is exactly when onFile has just registered its handler.
      queueMicrotask(() => {
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    },
    get(this: HTMLVideoElement) {
      return desc?.get?.call(this);
    },
  });
}

/*
 * SkeletonOverlay draws on a <canvas> via a requestAnimationFrame loop. jsdom
 * does not implement canvas (getContext returns null), which would throw inside
 * the rAF callback as an unhandled error after the test passes — noisy and a
 * source of future false positives. We stub a 2D context with no-op drawing
 * methods so the overlay mounts cleanly; the rAF loop is a noop in jsdom
 * anyway (it never fires without a real frame budget).
 */
function installCanvasStub() {
  const noop = () => {};
  const ctx = {
    clearRect: noop,
    drawImage: noop,
    fillRect: noop,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
    fillText: noop,
  } as unknown as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
}

describe('<App/> upload flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installJsdomVideoShim();
    installCanvasStub();
  });
  afterEach(() => {
    // Restore the native src accessor so other suites are unaffected.
    vi.restoreAllMocks();
  });

  it('renders in idle state with the hero subtitle and no results yet', () => {
    render(<App />);
    expect(
      screen.getByText(/Upload a side-view clip of a single serve/i),
    ).toBeInTheDocument();
    // No results section yet. reportTitle renders "Rules (N)" on success.
    expect(screen.queryByText(/^Rules \(\d+\)$/i)).toBeNull();
  });

  it('analyzes the chosen file and renders the rules report', async () => {
    vi.mocked(analyzeServe).mockResolvedValue(successResult);
    const user = userEvent.setup();

    render(<App />);
    const input = screen.getByLabelText(/upload serve video/i) as HTMLInputElement;

    await act(async () => {
      await user.upload(
        input,
        new File(['dummy'], 'serve.mp4', { type: 'video/mp4' }),
      );
    });

    // THE regression guard: onFile must reach analyzeServe. If the ref is null
    // (the bug), onFile returns early and this assertion fails.
    await waitFor(() => {
      expect(analyzeServe).toHaveBeenCalledTimes(1);
    });

    // On success the report title appears: "Rules ({{n}})" with n=0 in the fixture.
    await waitFor(() => {
      expect(screen.getByText(/^Rules \(0\)$/i)).toBeInTheDocument();
    });
  });

  it('shows an error card when the serve is not recognized', async () => {
    vi.mocked(analyzeServe).mockResolvedValue({
      ok: false,
      error: {
        kind: 'serve-not-recognized',
        detail: { code: 'too-few-frames', params: { n: 1 } },
      },
      poses: [],
    });
    const user = userEvent.setup();

    render(<App />);
    const input = screen.getByLabelText(/upload serve video/i) as HTMLInputElement;

    await act(async () => {
      await user.upload(
        input,
        new File(['dummy'], 'serve.mp4', { type: 'video/mp4' }),
      );
    });

    // serve-not-recognized headline (en.json: errors.serve-not-recognized).
    await waitFor(() => {
      expect(screen.getByText(/Could not recognize the serve/i)).toBeInTheDocument();
    });
  });

  it('clicking a phase block seeks the video to the phase start and slows playback', async () => {
    vi.mocked(analyzeServe).mockResolvedValue(successResult);
    const user = userEvent.setup();

    render(<App />);
    const input = screen.getByLabelText(/upload serve video/i) as HTMLInputElement;
    await act(async () => {
      await user.upload(input, new File(['dummy'], 'serve.mp4', { type: 'video/mp4' }));
    });
    await waitFor(() => {
      expect(screen.getByText(/^Rules \(0\)$/i)).toBeInTheDocument();
    });

    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();

    // trophy phase = [2, 3]; frameToMs(2) uses poses[2].timestampMs.
    const expectedStartSec = successResult.poses[2].timestampMs / 1000;

    await act(async () => {
      await user.click(screen.getByText('Trophy'));
    });

    // Seeked to the trophy phase start and slowed to the default 0.5× rate.
    expect(video.currentTime).toBeCloseTo(expectedStartSec, 3);
    expect(video.playbackRate).toBeCloseTo(0.5, 2);

    // Clicking the same block again clears the selection and restores 1×.
    await act(async () => {
      await user.click(screen.getByText('Trophy'));
    });
    expect(video.playbackRate).toBeCloseTo(1, 2);
  });
});
