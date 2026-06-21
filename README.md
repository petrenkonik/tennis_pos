# tennis_pos

A web prototype of a tennis serve analysis app using computer vision and pose tracking.

## What it is

A recreational player (level 3.0–4.0) uploads a video of their serve. The app:

1. **Recognizes the pose** via MediaPipe Pose (33 skeleton keypoints, frame by frame)
2. **Splits the serve into phases** by key events (preparation → trophy → contact → follow-through)
3. **Finds movement errors** through rule-based biomechanics rules
4. **Shows feedback** at three depth levels — from simple tips to comparing the skeleton against a pro reference

The goal of the prototype is to validate that the CV pipeline can actually split a serve into phases and find errors.

## Stack

- **Platform:** web, everything runs in the browser
- **Pose tracking:** MediaPipe Pose (JS / TF.js), on-device
- **Analysis:** rule-based, no server infrastructure
- **Video source:** file upload (not real-time)

## Status

🟢 Research, architecture decisions, and an MVP CV pipeline (in `src/`) are done.

## Documentation

- [`AGENTS.md`](./AGENTS.md) — instructions for AI agents (entry point)
- [`docs/research/`](./docs/research/) — market and technology research
- [`docs/biomechanics/`](./docs/biomechanics/) — domain: serve phases, metrics
- [`docs/decisions/`](./docs/decisions/) — architecture decision records (ADR)
- [`docs/task-rules.md`](./docs/task-rules.md) — task workflow rules
- [`skills/`](./skills/) — domain skills (subject-matter knowledge)

## Running the prototype

```bash
npm install
npm run dev      # open the printed localhost address
npm test         # run the core tests
```

### Manual check of the end-to-end flow (MVP success criterion)
1. `npm run dev`, open the app.
2. Pick a serve clip (side view, player fully in frame, ≤30s) and handedness.
3. Wait for the processing progress bar.
4. Verify that:
   - a skeleton and the current-phase label are drawn over the video;
   - the phase bar shows 4 segments (Preparation/Trophy/Acceleration/Follow-through);
   - at least one piece of advice or a "No errors found" message is shown.
