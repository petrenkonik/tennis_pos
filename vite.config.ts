import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import path from 'node:path'

// When building for GitHub Pages the site is served from a sub-path
// (https://petrenkonik.github.io/tennis_pos/), so Vite must emit
// asset URLs relative to that base. Locally we keep root "/".
const base = process.env.GITHUB_ACTIONS === 'true' ? '/tennis_pos/' : '/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
