import { execFileSync } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
rmSync(dist, { recursive: true, force: true })
execFileSync(process.execPath, [
  fileURLToPath(import.meta.resolve('typescript/bin/tsc')),
  '-p', fileURLToPath(new URL('tsconfig.build.json', root)),
], { stdio: 'inherit' })
copyFileSync(new URL('src/opentui.wasm', root), new URL('opentui.wasm', dist))
