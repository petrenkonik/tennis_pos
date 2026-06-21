import { describe, it, expect } from 'vitest';
import { analyzeServe } from '../pipeline/analyzeServe';
import { buildHappyServe } from './fixtures/poses';

describe('pipeline integration (assembled flow)', () => {
  it('runs video→pose→phases→rules without error and returns 4 ordered phases', async () => {
    const extract = async () => ({ poses: buildHappyServe(), fps: 30 });
    const r = await analyzeServe(
      { duration: 5 } as HTMLVideoElement, 'right', undefined, { deps: { extract } },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { trophyFrame, contactFrame, followStartFrame } = r.phases.events;
    expect(trophyFrame).toBeLessThan(contactFrame);
    expect(contactFrame).toBeLessThan(followStartFrame);
    const p = r.phases.phases;
    expect(p.preparation[0]).toBe(0);
    expect(p.followThrough[1]).toBe(buildHappyServe().length - 1);
    expect(Array.isArray(r.findings)).toBe(true);
  });
});
