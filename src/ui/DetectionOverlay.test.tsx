import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { DetectionOverlay } from './DetectionOverlay';
import type { BallTrack, RacketTrack } from '../types';

const empty: BallTrack = { points: [], coverage: 0 };

describe('DetectionOverlay', () => {
  it('renders a canvas without crashing on empty tracks and a null video ref', () => {
    const ref = createRef<HTMLVideoElement>();
    const { container } = render(
      <DetectionOverlay
        videoRef={ref}
        ballTrack={empty}
        racketTrack={empty as RacketTrack}
        poses={[]}
        handedness="right"
      />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
