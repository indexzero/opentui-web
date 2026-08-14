Title: fix(browser): render U+2580–U+259F procedurally in WebGPU

Follow-up to Hack 11's Canvas2D phase
(`washe/hack/11:hacks/11-render-neutral-block-element.md`, Phase C).

The WebGPU painter still obtains Block Element coverage from the font atlas.
It therefore does not yet satisfy the fork's font-independent terminal-graphics
contract for U+2580–U+259F.

1. Consume the canonical 32-entry model from
   `packages/opentui-browser/src/block-elements.ts`.
2. Mirror the WebGL render-token and cell-local procedural mask design in WGSL.
   An eager texture sample may remain where uniform-control-flow rules require
   it, but the sample must not determine a Block Element's coverage.
3. Generate the WGSL mapping from, or exhaustively verify it against, the
   canonical decoder. Do not maintain an unaudited second semantic table.
4. Preserve the text atlas, `CellGrid`, workers, and ANSI encoders unchanged.
5. Compare the shared fixture across Canvas2D, WebGL, and WebGPU at odd cell
   sizes and fractional DPR. Hard edges have zero tolerance for missing pixels;
   shades retain 25/50/75 percent coverage.
6. Record repeated-block throughput against Hack 11's performance budget.

Canvas2D consumption is intentionally not blocked on this issue.
