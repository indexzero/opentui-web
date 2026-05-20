# opentui-web

**[→ Live demo](https://rbby.dev/opentui-web/)**

> **Proof of concept.** Not a library. Not stable. A renderer-comparison lab. Edges are rough, some variants have visible artefacts, the API surface will move. Read the [Status](#status-proof-of-concept) section below before depending on anything in here.

An exploration of [opentui](https://github.com/justjake/opentui)'s Zig core compiled to WebAssembly and driven from the browser through several different rendering pipelines, so the trade-offs can be compared side-by-side. Each demo runs the same kernel through every pipeline; a toolbar at the top of every demo lets you switch between them live and watch the FPS and bytes-per-frame readouts move.

The interesting thing on display is not any single pipeline. It's the gap between them — how much faster a Worker is when paint is cheap, when the diff encoder slashes bandwidth to a few bytes per frame, what you give up by skipping a real terminal emulator.

**Built on**: [`justjake/opentui`](https://github.com/justjake/opentui) — the Node.js-compatible fork of the original [`anomalyco/opentui`](https://github.com/anomalyco/opentui). The Node.js compat work (see [`NODEJS_COMPAT.md`](./packages/opentui/NODEJS_COMPAT.md) in the vendored tree) is what made the WebAssembly target practical here: most of the Bun-specific runtime dependencies had already been factored out of the portable path before we touched it. None of this exists without that upstream work.

---

## Getting the demo running

You'll need [mise](https://mise.jdx.dev) (recommended — pins toolchain versions automatically) or the equivalent toolchain installed yourself: **Zig 0.15.2**, **Node 22.22**, **pnpm 10**, **Bun** (latest — used by the vendored opentui).

```bash
# 1. Toolchain
mise install         # picks up .zig-version + mise.toml; installs everything pinned

# 2. Node deps across the workspace
pnpm install

# 3. Build the WASM artifact (Zig → wasm32-freestanding, ReleaseSmall)
pnpm build:wasm

# 4. Start the demo
pnpm dev             # forwards to packages/web-demo, opens on http://localhost:3000
```

Open the page. The first route is `/plasma`. In the top-right of every demo you'll see two toggles:

- **Encoder** — `full` or `diff`. The full encoder re-emits every cell on every frame. The diff encoder emits only changed cells, with cursor-position escapes between runs. Hidden on the canvas variants because they paint cell grids directly and don't go through ANSI at all.
- **Renderer** — which pipeline paints the result. Nine choices, described below.

Move between demos with the tabs at the top. Switch variants with the toolbar. Each switch fully unmounts the prior variant and remounts a fresh one, so there's no carry-over state — what you see is what each pipeline does from a cold start.

---

## The demos

| Route | What it shows |
| --- | --- |
| `/plasma` | A 4-sine plasma kernel with `upper-half-block` for 2× vertical pixel density. Every cell changes every frame — the worst case for the diff encoder, the showcase for raw paint throughput. |
| `/mandelbrot` | Animated zoom into the seahorse valley, 96 iterations per pixel. The most compute-heavy kernel. Defaults to `ghostty +worker` because parallel compute + paint typically doubles the frame rate here. |
| `/fire` | Classic palette-mapped cellular fire — random hot pixels on the bottom row, cooled and drifted upwards. Heat field lives in the kernel closure (shared between main-thread and worker variants). |
| `/matrix` | Falling katakana columns with bright-leading-character + fading trail. Per-column drop state lives in the kernel. |
| `/counter` | Time-driven counter rendered with a bundled 5×7 bitmap font. Cycles 20×/second. Same kernel runs in every variant. |
| `/dashboard` | A small system-overview scene: animated CPU/MEM/NET/DSK gauges, scrolling sparkline history, mini-plasma panel, log tail. Defaults to the diff encoder; the panel borders and most log lines don't change between frames. |
| `/editor` | An opentui `EditBuffer` (text-buffer with rope storage + cursor) lives in the kernel. Keystrokes from the variant's input source (ghostty/xterm `onData`, browser keyboard events on the canvas variants, postMessage forwarding for the worker variant) feed the buffer; the buffer's text is rendered through the cell grid. Cursor blink, line numbers, status line at the bottom. |
| `/layout` | A flex layout (sidebar + metrics + activity + editor + plasma) computed by yoga, embedded inside the cell grid. Proves yoga-driven scenes work alongside interactive widgets. |
| `/life` | Conway's Game of Life with click-and-drag painting. Canvas2d only — its pointer-to-cell mapping isn't built for the other variants. |

`/` redirects to `/layout`.

---

## The renderer variants

These are the columns of the comparison matrix. Every visual demo offers every variant; the interactive demos (`/editor`, `/layout`, `/life`) offer the ones that can route input to them.

| Variant | What it does |
| --- | --- |
| `ghostty` | [ghostty-web](https://github.com/coder/ghostty-web) on the main thread — Ghostty's VT100 parser compiled to WASM, with an xterm.js-compatible API. The opentui kernel runs each frame, the cell grid is encoded to ANSI bytes, ghostty parses them and paints to its own canvas. |
| `ghostty +worker` | Same renderer but the opentui kernel + ANSI encoder run in a Web Worker. The worker posts the ANSI byte stream back to the main thread, ghostty paints. Two frames are kept in flight so the worker is computing frame N+1 while the main thread paints frame N. |
| `xterm.js` | [xterm.js v6](https://www.npmjs.com/package/@xterm/xterm) with the WebGL renderer addon. Same ANSI pipeline as ghostty; different parser + painter. |
| `canvas2d` | Direct 2D-canvas painter — no terminal emulator at all. The painter reads the cell grid arrays through the WASM module and draws each cell as a filled rect + glyph. Skips the ANSI encode/parse roundtrip entirely. |
| `canvas2d +worker` | The opentui kernel runs in a worker. Instead of encoding to ANSI, the worker copies the four cell-grid typed arrays (`chars`, `fg`, `bg`, `attrs`) into transferable `ArrayBuffer`s and posts them to the main thread. Main thread paints. |
| `canvas-gl` | WebGL2 painter — builds a glyph atlas once at init (ASCII + box-drawing + block elements + half-width katakana, rendered onto a 2D canvas then uploaded as a texture). Each cell is one instance of a quad, drawn with `drawArraysInstanced`. Per-instance attributes carry position, glyph index, fg, bg. |
| `canvas-gl +worker` | Same WebGL painter, cell grid arrives from the worker. |
| `canvas-gpu` | WebGPU painter — same architecture as `canvas-gl` but in WGSL. Requires Chrome / Edge / Safari Technology Preview with WebGPU enabled; shows an error in the variant's status row if `navigator.gpu` is unavailable. |
| `canvas-gpu +worker` | WebGPU painter, worker-computed cells. |

---

## Project layout

```
packages/
  opentui/                          vendored upstream (justjake/opentui)
    packages/core/src/zig/
      lib.zig                       upstream entry, native FFI
      lib-wasm.zig                  the WASM entry, pure-compute subset
      build.zig                     +25 lines for the wasm build step
  opentui-browser/                  JS-side library
    src/
      wasm.ts                       loads opentui.wasm
      buffer.ts                     OpentuiBuffer wrapper
      edit-buffer.ts                OpentuiEditBuffer wrapper
      ansi.ts                       encodeBufferAsAnsi + diff variant
      cell-grid.ts                  CellGrid wire format (used by workers)
      canvas-painter.ts             2D canvas painter
      canvas-gl-painter.ts          WebGL2 painter (instanced + glyph atlas)
      canvas-gpu-painter.ts         WebGPU painter
      layout.ts                     yoga-driven scene-graph DSL
      draw-helpers.ts               fillRect, drawBorder, drawString, drawBar, ...
  web-demo/                         the demo site
    src/
      routes/                       one file per demo
      demo-lib/
        VariantPicker.tsx           toolbar component
        variants.tsx                one component per renderer variant
        plasma-kernel.ts            kernel files (shared between main thread and worker)
        ...
      workers/
        run-worker.ts               generic boilerplate
        plasma-worker.ts            3-line demo-specific workers
        ...
```

The opentui submodule was vendored verbatim from upstream (commit `c8a3f05`); the only edits are two additive files: `lib-wasm.zig` (a portable-compute entry that excludes `terminal.zig` and `file-logger.zig` so it compiles on `wasm32-freestanding`) and ~25 lines added to `build.zig` for the `wasm` build step.

---

## How the pieces fit together

opentui's Zig core is a cell grid plus operations that mutate it (`setCell`, `drawText`, `bufferDrawBox`, `OptimizedBuffer`, `EditBuffer`, etc.). Native opentui ships an emitter that turns that grid into a stream of ANSI escapes — what a terminal expects to see. **In the browser we already have direct access to the cell grid, so we have a choice.** Either we serialise the grid to ANSI, hand it to a terminal emulator running in the page (ghostty-web, xterm.js), and let the emulator paint to a canvas — or we skip the emulator and paint the grid directly. Both routes work. Each gives up something the other has.

**Why the variant matrix exists at all** is to make the trade-offs visible. The fastest demo on plasma will not be the fastest demo on the dashboard; the worker is a 2× win for Mandelbrot and roughly neutral for the editor; the diff encoder turns the editor into a 4-byte-per-frame trickle but does nothing for plasma. The toggle in the toolbar is the whole point — pick a kernel, pick a pipeline, read off the FPS and the bytes-per-frame, and switch.

**Why workers help when they help**: ghostty-web (and xterm.js) parse ANSI on the main thread, on top of also painting to a canvas there. The main thread is paint-bound. By moving the opentui kernel + the ANSI encoder into a worker, we get the worker computing frame N+1 while the main thread is still painting frame N. That works when the kernel itself is expensive (Mandelbrot, plasma), and gives up overhead-without-benefit when the kernel is trivial (counter, editor). Worker variants for interactive demos (editor, layout) add postMessage round-trips on the keystroke path — small, but you can feel them if you look.

**Why the diff encoder helps when it helps**: the cost ghostty-web's parser pays is roughly proportional to the byte count we hand it. The full encoder emits every cell every frame — \~100 KB for the editor at typical viewport sizes. The diff encoder maintains a shadow of the previous frame's cells in WASM memory and emits cursor-position escapes followed by only the cells that changed. For the editor that's typically 4–50 bytes per frame (the cursor blink, the one cell you just typed). For the dashboard / matrix / counter the win is large. For plasma — every cell changes every frame — the diff encoder is overhead, not relief. The toggle defaults to `full` for safety; per-route defaults turn it on where it pays off.

**Why `canvas-gl` and `canvas-gpu` exist**: with no terminal emulator in the way, painting a cell grid is mostly a quad-per-cell loop, which is exactly what GPUs are built for. The WebGL2 painter builds a glyph atlas at init (a 2D canvas with every supported codepoint rendered onto it, uploaded as a texture), then draws every visible cell as one instance of a single quad via `drawArraysInstanced`. The WebGPU painter does the same in WGSL with a modern API. Both scale to much larger viewports than the canvas2d painter without dropping below 60 fps.

---

## Status: proof of concept

This repo is not an opentui distribution and is not a library you'd `pnpm add`. It's an in-flight exploration. Expect rough edges. To set expectations clearly:

**What was added vs. upstream opentui.** Upstream [`justjake/opentui`](https://github.com/justjake/opentui) ships a Zig native lib + a Bun/Node FFI binding + a React reconciler + a docs site. This repo vendors that codebase at commit `c8a3f05` and adds the following on top, all of which are new code, none of which exists upstream:

- A `wasm32-freestanding` build target for the Zig core (`packages/opentui/packages/core/src/zig/lib-wasm.zig` plus ~25 lines added to `build.zig`). Upstream targets darwin/linux/windows; the wasm target is ours.
- A new package `opentui-browser` containing everything JS-side: WASM loader, `OpentuiBuffer` and `OpentuiEditBuffer` wrappers, a Zig-side ANSI emitter (and a diff variant), three custom painters (`CanvasPainter`, `CanvasGLPainter`, `CanvasGPUPainter`), a `CellGrid` wire format for worker transfers, and a yoga-driven layout DSL.
- A new package `web-demo`: the showcase application — TanStack Router app, nine demo kernels (plasma, mandelbrot, fire, matrix, dashboard, counter, editor, layout, life), the variant-picker + encoder-toggle harness, and the per-demo worker files.
- Selection of [ghostty-web](https://github.com/coder/ghostty-web) and [xterm.js v6](https://www.npmjs.com/package/@xterm/xterm) as the terminal-emulator-mediated rendering paths.

**What's not in scope.** Lots of opentui's surface area isn't wired through to the browser. The 3D renderer, the sprite animator, tree-sitter highlighting, the React reconciler (`@opentui/react`), the audio plugin, the solid bindings — all present in `packages/opentui/` because the whole upstream was vendored, but none of them are exposed through `opentui-browser`. The `lib-wasm.zig` entry is a pure-compute subset deliberately picked to compile without `terminal.zig` or `file-logger.zig`.

**Stability.** The Zig WASM ABI, the JS wrapper APIs in `opentui-browser`, the demo route structure — all of these are first-pass and will move. Variant component props will change. The `CellGrid` wire format will probably grow fields. The `encoderMode: 'diff'` path has not been hardened beyond what passes these demos by eye. Don't import any of this and expect it to be stable.

**Use it for**: poking at the Zig→WASM path, comparing what direct cell-grid painters cost you vs. a real terminal emulator, learning what worker offload buys you on different kernel shapes, or as a starting point to fork.

**Don't use it for**: shipping a real terminal in your application. For that, talk directly to [ghostty-web](https://github.com/coder/ghostty-web) — the `ghostty` variant here is the thinnest possible wrapper around it.

---

## Known limitations and gotchas

These exist. Some are fixable; some are intrinsic to the variant.

### Selection / copy on the canvas variants is rudimentary

Terminal emulators (ghostty, xterm) come with a full selection model — you drag to highlight text, Cmd+C copies the selection. The canvas variants (`canvas2d`, `canvas-gl`, `canvas-gpu`, including their `+worker` pairs) have **no selection layer**. As a stopgap, `Cmd+C` (`Ctrl+C` on Linux/Windows) on a focused canvas copies the entire current frame as plain text to the clipboard. Range selection by drag is not implemented; a proper selection overlay is real work (anchor + extent tracking, highlight repaint, copy of the right range) and is deferred.

**Recommendation**: if you're shipping anything that needs real text selection — code, logs, terminal output — use the `ghostty` variant.

### Visual artefacts on the WebGL / WebGPU variants

The GL and GPU painters use a pre-built glyph atlas with linear texture filtering. At certain viewport sizes (especially when device-pixel-ratio doesn't divide cleanly) you can see:

- **Edge bleed** between adjacent glyphs in the atlas — a faint outline of the next character along.
- **Sub-pixel shimmer** on the cell grid when the canvas resizes mid-animation, because cell positions round to integer pixels but the atlas UVs don't.
- **Block-character gaps** at the joints between half-block (`▀`) cells when adjacent cells should appear seamlessly continuous — the font's glyph metrics and the integer cell grid don't perfectly agree.

These are visible mostly on the plasma demo where the entire viewport is half-blocks. The fix is either a packed atlas with explicit padding between glyphs and `NEAREST` filtering, or hand-drawing the half-blocks as untextured quads. Neither is done yet.

### xterm.js is the slowest variant

We use `@xterm/xterm` v6 with the WebGL renderer addon, and at full-redraw demos (plasma) it runs at roughly **half** the framerate of ghostty-web. Some demos also show stray colored dots in the output — those are control-sequence bytes that xterm's parser is treating as glyphs because of escape-sequence-state-machine quirks. Useful as a baseline; not what you want to ship.

### `canvas-gpu` requires browser support

WebGPU is in Chrome, Edge, and Safari Technology Preview as of mid-2026. Firefox has it behind a flag. If `navigator.gpu` is missing or `requestAdapter()` returns `null`, the variant shows an error in its status line and falls back to nothing — switch to another variant.

### Worker variant for interactive demos adds latency

For `/editor` and `/layout`, switching to a worker variant means every keystroke now postMessages to the worker, the worker applies it to its EditBuffer, then the next frame reflects the change. On a fast machine this is barely perceptible. On a slow one, or under load, you can feel it. The main-thread variants are the ones to use for low-latency typing.

### When in doubt, use `ghostty`

For anything beyond a side-by-side comparison demo, the `ghostty` variant is the right default. ghostty-web is a real terminal emulator — selection, scrollback, IME, OSC8 hyperlinks, multi-pass rendering for complex scripts, mouse events, theme handling. The canvas variants are showcases for how fast a thinner stack can be when you don't need those features. They aren't replacements for it.

---

## Other tasks

### Build the WASM

```bash
pnpm build:wasm        # ReleaseSmall — ~290 KB
pnpm build:wasm:dev    # Debug — slower to build but useful for Zig-side iteration
```

The output ends up at `packages/opentui/packages/core/src/zig/lib/wasm/opentui.wasm` and is also copied into `packages/opentui-browser/src/opentui.wasm`. The web-demo references the copy in `opentui-browser`.

### Pre-existing upstream opentui content

`ORIG_README.md` at the repo root is the upstream `opentui` README, preserved here so you can see what the vendored package describes itself as. The upstream project is the source of everything in `packages/opentui/`. Worth reading if you want context for what `OptimizedBuffer`, `TextBuffer`, the renderer plugin model, and the Zig native lib look like outside our browser experiment.

### Re-syncing the vendored opentui

Not wired yet. The intended path is `git subtree pull --prefix=packages/opentui <upstream-remote> main`, which will conflict on `lib-wasm.zig` (additive, easy) and on the `wasm` step added to `build.zig` (small, easy). Decisions about publishing or contributing back upstream are deferred.

---

## Credits

- **opentui** — Zig terminal-UI core. Originally [`anomalyco/opentui`](https://github.com/anomalyco/opentui); the Node.js-compatible fork we vendored is [`justjake/opentui`](https://github.com/justjake/opentui). Everything in `packages/opentui/` is theirs, used under the project's MIT licence. The lazy reading is that opentui = upstream's renderer, text-buffer, edit-buffer, layout (yoga), and animation primitives; we just exposed a compute-only subset as a `wasm32-freestanding` build target and wrote a JS layer on top.
- **ghostty-web** — [`coder/ghostty-web`](https://github.com/coder/ghostty-web). Ghostty's VT100 parser compiled to WebAssembly, with an xterm.js-compatible JS API. Used as the `ghostty` and `ghostty +worker` renderer variants. This is the recommended path for real terminal use.
- **xterm.js** — [`xtermjs/xterm.js`](https://github.com/xtermjs/xterm.js) v6 + the official WebGL renderer addon. Used as the `xterm.js` variant.
- **yoga-layout** — [`facebook/yoga`](https://github.com/facebook/yoga) (the WebAssembly port published as `yoga-layout` on npm). Used by `opentui-browser/layout` for the `/layout` demo's flex scene.
- **TanStack Router** — file-based routing for the demo app.

If you're looking to build a real opentui application in Node.js, go to [`justjake/opentui`](https://github.com/justjake/opentui) directly. If you need a terminal in your browser app, [`ghostty-web`](https://github.com/coder/ghostty-web) is the recommended choice. This repo is a comparison lab for thinking about the trade-offs between them.
