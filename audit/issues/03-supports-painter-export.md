Title: feat(browser): export painter capability detection (supportsPainter)

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md`, finding
**F5**).

`canvas-gpu-painter.ts:123` throws when `navigator.gpu` is absent — correct
as a contract, but the gpu → gl → 2d selection burden currently lands on
every embedder, and misuse strands all pre-26 Safari (which, on iOS, is
every browser).

Export capability detection without painter *policy*:

```ts
supportsPainter(kind: 'gpu' | 'gl' | '2d'): boolean
```

Embedders keep the choice; nobody re-implements the probe wrong; the safe
path becomes the paved path. Unit-testable with a mocked `navigator` —
which the current throw-based contract is not, from outside an embedder.
