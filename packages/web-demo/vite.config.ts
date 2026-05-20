import { defineConfig } from 'vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves under https://USER.github.io/REPO/. The deploy workflow
// sets VITE_BASE_PATH to that prefix so asset URLs (wasm, workers, css) resolve.
// Defaults to '/' for local dev.
const base = process.env.VITE_BASE_PATH || '/'

const config = defineConfig({
  base,
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
})

export default config
