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
});
