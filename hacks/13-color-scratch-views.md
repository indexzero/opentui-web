# Patch 13: reuse WASM color scratch views

Part of indexzero/charlie.dev#567. Color scratch memory was already allocated
once per buffer, but every color write created another four-element
Float32Array view. The wrapper now retains foreground/background views and
refreshes both when the WASM memory buffer changes. Each call still copies
the current tuple values with `.set`; colors and WASM calls are unchanged.

Both constructor allocations finish before the initial views are created.
Text scratch allocation happens before checking the cached views. Resize or
allocation by another buffer can also grow memory, so every clear, cell write,
and text write checks the current memory identity. Snapshot views keep their
existing lifetime rules; this patch does not cache them or change the WASM ABI.

`buffer.test.ts` exercises the real WASM module, all grid channels, mutable
colors, memory growth including `grow(0)`, constructor/text allocations,
another buffer's allocation, and resize. Node types are a test dependency.
