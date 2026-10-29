# Browser painter package

`@indexzero/opentui-browser` contains the browser painters, buffer wrappers, layout helpers, four visual kernels, and the existing WASM binary.

This package remains private.
The name is provisional.
Publication requires the upstream grant and the owner's package identity and release decision.

Build with the repository's pinned package manager:

```sh
pnpm --filter @indexzero/opentui-browser build
pnpm --filter @indexzero/opentui-browser test
pnpm --filter @indexzero/opentui-browser typecheck
pnpm --filter @indexzero/opentui-browser pack --pack-destination /path/to/artifacts
```

Packing rebuilds the package.
The archive contains ESM JavaScript, TypeScript declarations, and `dist/opentui.wasm`.
The build uses TypeScript and copies the checked-in WASM binary without rebuilding native code.

Use the explicit package exports:

```ts
import { CanvasPainter, loadOpentui, OpentuiBuffer } from '@indexzero/opentui-browser'
import { box, layoutAndDraw } from '@indexzero/opentui-browser/layout'
import { createMatrixDraw } from '@indexzero/opentui-browser/kernels/matrix'
import { createFireDraw } from '@indexzero/opentui-browser/kernels/fire'
import { drawPlasma } from '@indexzero/opentui-browser/kernels/plasma'
import { drawMandelbrot } from '@indexzero/opentui-browser/kernels/mandelbrot'
```

`loadOpentui()` resolves `opentui.wasm` relative to the built loader with `new URL('./opentui.wasm', import.meta.url)`.
Serve that asset over HTTP with the `application/wasm` content type.
Browser bundlers can copy the asset from this package without repository aliases or TypeScript source loaders.
The binary is also available through `@indexzero/opentui-browser/opentui.wasm`.

The demo builds this package before starting its development server or production build.
Each visual kernel lives in the package and is imported directly by the demo and its workers.
