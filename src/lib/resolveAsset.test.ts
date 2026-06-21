import { describe, it, expect } from 'vitest';
import { resolveAsset } from './resolveAsset';

// resolveAsset prepends Vite's BASE_URL so a runtime fetch() of a public/
// asset lands on the right URL in both dev (base='/') and GitHub Pages
// production (base='/tennis_pos/'). Without it the demo clip 404s in prod.

describe('resolveAsset', () => {
  it('prefixes a relative path with the dev base "/"', () => {
    expect(resolveAsset('demo/clips/serve-right-side.mp4', '/')).toBe(
      '/demo/clips/serve-right-side.mp4',
    );
  });

  it('prefixes a relative path with the prod base "/tennis_pos/"', () => {
    // This is the regression that caused the 404 on GitHub Pages: the catalog
    // held '/demo/clips/...' which dropped the '/tennis_pos/' sub-path.
    expect(resolveAsset('demo/clips/serve-right-side.mp4', '/tennis_pos/')).toBe(
      '/tennis_pos/demo/clips/serve-right-side.mp4',
    );
  });

  it('strips a stray leading slash so no double slash is produced', () => {
    expect(resolveAsset('/demo/clips/serve-right-side.mp4', '/tennis_pos/')).toBe(
      '/tennis_pos/demo/clips/serve-right-side.mp4',
    );
  });

  it('handles a deeper nested asset', () => {
    expect(resolveAsset('foo/bar/baz.json', '/tennis_pos/')).toBe(
      '/tennis_pos/foo/bar/baz.json',
    );
  });
});
