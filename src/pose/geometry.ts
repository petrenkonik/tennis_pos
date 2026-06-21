import type { Landmark } from '../types';

// Angle (degrees) at vertex b for the triple (a, b, c).
export function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const bax = a.x - b.x, bay = a.y - b.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const denom = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (denom === 0) return 0; // degenerate (coincident points)
  const cos = (bax * bcx + bay * bcy) / denom;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// Indices of strict local maxima whose rise over the smaller neighbour
// is at least minProminence (filters out noise wiggles).
export function localMaxima(values: number[], minProminence = 0): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] >= values[i + 1]) {
      const prominence = values[i] - Math.min(values[i - 1], values[i + 1]);
      if (prominence >= minProminence) peaks.push(i);
    }
  }
  return peaks;
}
