import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Exclude git worktrees and other local working spaces so `npm test`
    // only runs the tests of THIS checkout. Worktrees (e.g. feature
    // branches under .worktrees/) carry their own WIP test state and must
    // not leak into the main run or CI.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/coverage/**',
    ],
  },
});
