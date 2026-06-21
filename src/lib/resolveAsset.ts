// Resolve a public/ asset path against Vite's build-time base URL.
//
// Why this exists: Vite rewrites HTML/CSS/JS asset URLs to honor `base`
// (set to '/tennis_pos/' for GitHub Pages in vite.config.ts), but runtime
// `fetch()` calls are NOT rewritten. A clip hardcoded as
// '/demo/clips/foo.mp4' fetched in production resolves against the site
// root and 404s — see the fix for the demo-clip 404 on GitHub Pages.
//
// Contract: `path` is root-relative WITHOUT a leading slash
// ('demo/clips/foo.mp4'). `base` always ends in '/' (Vite guarantees this),
// so concatenation never produces a double slash. A stray leading slash on
// `path` is tolerated (stripped) for defensive callers.
//
// `base` is a parameter (defaulting to import.meta.env.BASE_URL) purely so
// the function is pure and unit-testable without env stubbing.
export function resolveAsset(
  path: string,
  base: string = import.meta.env.BASE_URL,
): string {
  return `${base}${path.replace(/^\/+/, '')}`;
}
