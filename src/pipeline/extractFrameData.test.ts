import { describe, it, expect } from 'vitest';
import { pickDetections, type RawDetection } from './extractFrameData';

const raw = (name: string, score: number, x = 0, y = 0, w = 100, h = 100): RawDetection => ({
  categories: [{ categoryName: name, score }],
  boundingBox: { originX: x, originY: y, width: w, height: h },
});

describe('pickDetections', () => {
  it('normalizes the bounding box by the video dimensions', () => {
    const { ball } = pickDetections([raw('sports ball', 0.8, 100, 50, 40, 40)], 400, 200);
    expect(ball).not.toBeNull();
    expect(ball!.box).toEqual({ x: 0.25, y: 0.25, w: 0.1, h: 0.2 });
    expect(ball!.score).toBe(0.8);
  });

  it('keeps the highest-scoring detection per class', () => {
    const { racket } = pickDetections(
      [raw('tennis racket', 0.4), raw('tennis racket', 0.7)], 100, 100);
    expect(racket!.score).toBe(0.7);
  });

  it('buckets ball and racket separately and ignores other classes', () => {
    const { ball, racket } = pickDetections(
      [raw('sports ball', 0.6), raw('tennis racket', 0.9), raw('person', 0.99)], 100, 100);
    expect(ball!.score).toBe(0.6);
    expect(racket!.score).toBe(0.9);
  });

  it('returns nulls when nothing relevant is detected', () => {
    expect(pickDetections([], 100, 100)).toEqual({ ball: null, racket: null });
  });

  it('skips detections with no bounding box or bad video dimensions', () => {
    const noBox: RawDetection = { categories: [{ categoryName: 'sports ball', score: 0.9 }] };
    expect(pickDetections([noBox], 100, 100).ball).toBeNull();
    expect(pickDetections([raw('sports ball', 0.9)], 0, 0).ball).toBeNull();
  });
});
