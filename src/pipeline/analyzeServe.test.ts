import { describe, it, expect } from 'vitest';
import { analyzeServe } from './analyzeServe';
import { buildHappyServe, makeFrame, makeLandmarks } from '../__tests__/fixtures/poses';
import { LM } from '../pose/landmarks';

const video = (duration: number) => ({ duration }) as HTMLVideoElement;

describe('analyzeServe', () => {
  it('returns a full result on a clean serve', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { trophyFrame, contactFrame, followStartFrame } = r.phases.events;
      expect(trophyFrame).toBeLessThan(contactFrame);
      expect(contactFrame).toBeLessThan(followStartFrame);
      expect(Array.isArray(r.findings)).toBe(true);
    }
  });

  it('rejects clips longer than MAX_CLIP_SECONDS', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(99), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('video-too-long');
  });

  it('maps unrecognized serves to a domain error', async () => {
    const poses = Array.from({ length: 6 }, (_, i) =>
      makeFrame(i, makeLandmarks({ [LM.R_WRIST]: { visibility: 0 } })));
    const extract = async () => ({ poses, fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('serve-not-recognized');
  });

  it('maps extraction failures to pose-extraction-failed', async () => {
    const extract = async () => { throw new Error('mediapipe boom'); };
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('pose-extraction-failed');
  });

  it('maps a bug in the analysis stage (non-ServeNotRecognized) to analysis-failed, not pose-extraction-failed', async () => {
    // #1: extraction succeeds (poses returned), but a downstream stage throws a
    // non-ServeNotRecognized error. We trigger it by returning frames with
    // mismatched landmark counts: smooth reads poses[0].landmarks.length, then
    // tries poses[k].landmarks[l] for l beyond the shorter frame's length →
    // throws TypeError. The catch must label this analysis-failed.
    const poses = [
      { frameIndex: 0, timestampMs: 0, landmarks: makeLandmarks({}) },
      { frameIndex: 1, timestampMs: 33, landmarks: [] }, // mismatched length
    ];
    const extract = async () => ({ poses, fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('analysis-failed');
  });

  it('builds ball/racket tracks from the extractor detections', async () => {
    const poses = buildHappyServe();
    const detections = poses.map(p => ({
      frameIndex: p.frameIndex, timestampMs: p.timestampMs,
      ball: { box: { x: 0.5, y: 0.3, w: 0.05, h: 0.05 }, score: 0.9 },
      racket: null,
    }));
    const extract = async () => ({ poses, fps: 30, detections });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ballTrack.points.length).toBe(detections.length);
      expect(r.ballTrack.coverage).toBeCloseTo(1, 5);
      expect(r.racketTrack.coverage).toBe(0);
    }
  });

  it('returns empty tracks when the extractor yields no detections', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ballTrack.points).toEqual([]);
      expect(r.ballTrack.coverage).toBe(0);
    }
  });

  it('refines contact timing when ball and racket tracks converge at the hit', async () => {
    const poses = buildHappyServe();
    // Ball flying toward the racket, closest at f3 — the contact frame the
    // pose detector finds on this fixture AFTER trajectory smoothing (the
    // smoothing shifts the wrist peak one frame earlier) — then flying away.
    // Distances shrink strictly monotonically into f3 so the min-distance
    // scan has a unique winner.
    const ballY = [0.60, 0.50, 0.38, 0.20, 0.16, 0.30, 0.45];
    const rackY = [0.45, 0.40, 0.33, 0.20, 0.30, 0.45, 0.60];
    const detections = poses.map((p, i) => ({
      frameIndex: p.frameIndex, timestampMs: p.timestampMs,
      ball: { box: { x: 0.5 - 0.02, y: ballY[i] - 0.02, w: 0.04, h: 0.04 }, score: 0.9 },
      racket: { box: { x: 0.5 - 0.02, y: rackY[i] - 0.02, w: 0.04, h: 0.04 }, score: 0.9 },
    }));
    const extract = async () => ({ poses, fps: 30, detections });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.phases.contactSource).toBe('tracks');
      expect(r.phases.contactDiagnostic).toBeNull();
      expect(r.phases.confidence).toBe('high');
      expect(r.phases.events.contactFrame).toBe(3);
      expect(r.phases.events.contactFrame).toBeGreaterThan(r.phases.events.trophyFrame);
    }
  });

  it('keeps pose timing and reports sparse tracks when detections are scarce', async () => {
    const poses = buildHappyServe();
    // Only 2 of 7 frames have detections on each class → coverage < 0.5.
    const detections = poses.map((p, i) => ({
      frameIndex: p.frameIndex, timestampMs: p.timestampMs,
      ball: i % 3 === 0 ? { box: { x: 0.4, y: 0.3, w: 0.04, h: 0.04 }, score: 0.9 } : null,
      racket: i % 3 === 0 ? { box: { x: 0.5, y: 0.3, w: 0.04, h: 0.04 }, score: 0.9 } : null,
    }));
    const extract = async () => ({ poses, fps: 30, detections });
    const r = await analyzeServe(video(5), 'right', undefined, { deps: { extract } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.phases.contactSource).toBe('pose');
      expect(r.phases.contactDiagnostic).toBe('contact-tracks-sparse');
    }
  });
});
