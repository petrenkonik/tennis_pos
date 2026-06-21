import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';
import i18n from '../i18n';

// Tell React this is an act()-compatible environment. Without it React 19
// prints "The current testing environment is not configured to support act(...)"
// whenever a state update happens outside an explicit act() wrapper (e.g.
// inside the mocked analyzeServe resolving and flipping App's status).
// See: https://github.com/facebook/react/blob/main/packages/react/src/ReactAct.js
// @ts-expect-error — the flag is a plain global, not part of the DOM types.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Pin English in every test so assertions match a deterministic locale. The
// import above runs the i18n initializer; we then force the language and clear
// any localStorage detection result before each test for isolation.
beforeEach(() => {
  window.localStorage.clear();
  void i18n.changeLanguage('en');
});
