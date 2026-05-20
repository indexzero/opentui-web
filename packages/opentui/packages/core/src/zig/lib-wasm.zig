//! WASM entry point exposing the pure-compute subset of opentui.
//!
//! This file is a side-experiment to validate the wasm32-freestanding build path.
//! It deliberately excludes terminal.zig, file-logger.zig, and renderer.zig so the
//! module compiles without OS-side imports. The export surface is intentionally
//! small — enough to prove the build works and to exercise the JS shim end-to-end.

const std = @import("std");

const ansi = @import("ansi.zig");
const buffer = @import("buffer.zig");
const text_buffer = @import("text-buffer.zig");
const edit_buffer_mod = @import("edit-buffer.zig");
const gp = @import("grapheme.zig");
const link = @import("link.zig");
const utf8 = @import("utf8.zig");
const utils = @import("utils.zig");

const wasm_allocator = std.heap.wasm_allocator;
var arena = std.heap.ArenaAllocator.init(wasm_allocator);
const arena_allocator = arena.allocator();

export fn opentuiAlloc(len: usize) ?[*]u8 {
    const slice = wasm_allocator.alloc(u8, len) catch return null;
    return slice.ptr;
}

export fn opentuiFree(ptr: [*]u8, len: usize) void {
    wasm_allocator.free(ptr[0..len]);
}

export fn createOptimizedBuffer(
    width: u32,
    height: u32,
    respectAlpha: bool,
    widthMethod: u8,
    idPtr: [*]const u8,
    idLen: usize,
) ?*buffer.OptimizedBuffer {
    if (width == 0 or height == 0) return null;

    const pool = gp.initGlobalPool(arena_allocator);
    const link_pool = link.initGlobalLinkPool(arena_allocator);
    const wMethod: utf8.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;
    const id = idPtr[0..idLen];

    return buffer.OptimizedBuffer.init(wasm_allocator, width, height, .{
        .respectAlpha = respectAlpha,
        .pool = pool,
        .width_method = wMethod,
        .id = id,
        .link_pool = link_pool,
    }) catch null;
}

export fn destroyOptimizedBuffer(bufferPtr: *buffer.OptimizedBuffer) void {
    bufferPtr.deinit();
}

export fn bufferGetWidth(bufferPtr: *buffer.OptimizedBuffer) u32 {
    return bufferPtr.width;
}

export fn bufferGetHeight(bufferPtr: *buffer.OptimizedBuffer) u32 {
    return bufferPtr.height;
}

export fn bufferGetCharPtr(bufferPtr: *buffer.OptimizedBuffer) [*]u32 {
    return bufferPtr.getCharPtr();
}

export fn bufferGetFgPtr(bufferPtr: *buffer.OptimizedBuffer) [*]buffer.RGBA {
    return bufferPtr.getFgPtr();
}

export fn bufferGetBgPtr(bufferPtr: *buffer.OptimizedBuffer) [*]buffer.RGBA {
    return bufferPtr.getBgPtr();
}

export fn bufferGetAttributesPtr(bufferPtr: *buffer.OptimizedBuffer) [*]u32 {
    return bufferPtr.getAttributesPtr();
}

export fn bufferSetCell(
    bufferPtr: *buffer.OptimizedBuffer,
    x: u32,
    y: u32,
    char: u32,
    fg: [*]const f32,
    bg: [*]const f32,
    attributes: u32,
) void {
    bufferPtr.set(x, y, .{
        .char = char,
        .fg = utils.f32PtrToRGBA(fg),
        .bg = utils.f32PtrToRGBA(bg),
        .attributes = attributes,
    });
}

export fn bufferDrawText(
    bufferPtr: *buffer.OptimizedBuffer,
    text: [*]const u8,
    textLen: usize,
    x: u32,
    y: u32,
    fg: [*]const f32,
    attributes: u32,
) void {
    bufferPtr.drawText(text[0..textLen], x, y, utils.f32PtrToRGBA(fg), null, attributes) catch {};
}

export fn bufferClear(bufferPtr: *buffer.OptimizedBuffer, bg: [*]const f32) void {
    bufferPtr.clear(utils.f32PtrToRGBA(bg), null) catch {};
}

export fn bufferResize(bufferPtr: *buffer.OptimizedBuffer, width: u32, height: u32) void {
    bufferPtr.resize(width, height) catch {};
}

// ---- ANSI emitter ---------------------------------------------------------
// Walks the cell grid, emits SGR + cell content into a JS-supplied byte slice.
// Returns the number of bytes written, or 0 if the caller's buffer was too
// small. SGR state is carried across rows; the terminal keeps colors between
// cells separated only by \r\n. A final \x1b[0m resets state at frame end so
// the row below the canvas doesn't inherit a background.

fn appendStr(out: []u8, i: usize, s: []const u8) usize {
    const remaining = if (i >= out.len) 0 else out.len - i;
    const n = @min(s.len, remaining);
    if (n == 0) return i;
    @memcpy(out[i .. i + n], s[0..n]);
    return i + n;
}

fn appendChar(out: []u8, i: usize, c: u8) usize {
    if (i >= out.len) return i;
    out[i] = c;
    return i + 1;
}

fn appendInt(out: []u8, i: usize, n: u32) usize {
    if (n == 0) return appendChar(out, i, '0');
    var tmp: [10]u8 = undefined;
    var ti: usize = 0;
    var v = n;
    while (v > 0) {
        tmp[ti] = @intCast('0' + (v % 10));
        ti += 1;
        v /= 10;
    }
    var idx = i;
    var j: usize = ti;
    while (j > 0) : (j -= 1) {
        idx = appendChar(out, idx, tmp[j - 1]);
    }
    return idx;
}

fn appendCodepoint(out: []u8, i: usize, cp: u32) usize {
    if (cp == 0 or cp > 0x10FFFF) return appendChar(out, i, ' ');
    if (cp < 0x80) return appendChar(out, i, @intCast(cp));
    if (cp < 0x800) {
        var idx = appendChar(out, i, @intCast(0xC0 | (cp >> 6)));
        idx = appendChar(out, idx, @intCast(0x80 | (cp & 0x3F)));
        return idx;
    }
    if (cp < 0x10000) {
        // skip UTF-16 surrogates; treat as space
        if (cp >= 0xD800 and cp <= 0xDFFF) return appendChar(out, i, ' ');
        var idx = appendChar(out, i, @intCast(0xE0 | (cp >> 12)));
        idx = appendChar(out, idx, @intCast(0x80 | ((cp >> 6) & 0x3F)));
        idx = appendChar(out, idx, @intCast(0x80 | (cp & 0x3F)));
        return idx;
    }
    var idx = appendChar(out, i, @intCast(0xF0 | (cp >> 18)));
    idx = appendChar(out, idx, @intCast(0x80 | ((cp >> 12) & 0x3F)));
    idx = appendChar(out, idx, @intCast(0x80 | ((cp >> 6) & 0x3F)));
    idx = appendChar(out, idx, @intCast(0x80 | (cp & 0x3F)));
    return idx;
}

fn clampUnit(v: f32) i32 {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return @intFromFloat(v * 255.0);
}

export fn bufferEncodeAnsi(
    bufferPtr: *buffer.OptimizedBuffer,
    outPtr: [*]u8,
    outLen: usize,
    clearScreen: bool,
) usize {
    const out = outPtr[0..outLen];
    var i: usize = 0;

    i = appendStr(out, i, "\x1b[H");
    if (clearScreen) i = appendStr(out, i, "\x1b[2J");

    var lastFgR: i32 = -1;
    var lastFgG: i32 = -1;
    var lastFgB: i32 = -1;
    var lastBgR: i32 = -1;
    var lastBgG: i32 = -1;
    var lastBgB: i32 = -1;
    var lastAttrs: i32 = -1;

    const width = bufferPtr.width;
    const height = bufferPtr.height;
    const chars = bufferPtr.getCharPtr();
    const fg_arr = bufferPtr.getFgPtr();
    const bg_arr = bufferPtr.getBgPtr();
    const attrs_arr = bufferPtr.getAttributesPtr();

    var y: u32 = 0;
    while (y < height) : (y += 1) {
        var x: u32 = 0;
        while (x < width) : (x += 1) {
            const cell_idx: usize = @as(usize, y) * width + x;
            const ai: i32 = @intCast(attrs_arr[cell_idx] & 0xFF);

            const fg_rgba = fg_arr[cell_idx];
            const bg_rgba = bg_arr[cell_idx];
            const fr = clampUnit(fg_rgba[0]);
            const fgg = clampUnit(fg_rgba[1]);
            const fb = clampUnit(fg_rgba[2]);
            const br = clampUnit(bg_rgba[0]);
            const bgr = clampUnit(bg_rgba[1]);
            const bb = clampUnit(bg_rgba[2]);

            if (ai != lastAttrs) {
                i = appendStr(out, i, "\x1b[0m");
                if (ai & 1 != 0) i = appendStr(out, i, "\x1b[1m");
                if (ai & 2 != 0) i = appendStr(out, i, "\x1b[2m");
                if (ai & 4 != 0) i = appendStr(out, i, "\x1b[3m");
                if (ai & 8 != 0) i = appendStr(out, i, "\x1b[4m");
                if (ai & 32 != 0) i = appendStr(out, i, "\x1b[7m");
                lastAttrs = ai;
                lastFgR = -1; lastFgG = -1; lastFgB = -1;
                lastBgR = -1; lastBgG = -1; lastBgB = -1;
            }

            if (fr != lastFgR or fgg != lastFgG or fb != lastFgB) {
                i = appendStr(out, i, "\x1b[38;2;");
                i = appendInt(out, i, @intCast(fr));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(fgg));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(fb));
                i = appendChar(out, i, 'm');
                lastFgR = fr; lastFgG = fgg; lastFgB = fb;
            }
            if (br != lastBgR or bgr != lastBgG or bb != lastBgB) {
                i = appendStr(out, i, "\x1b[48;2;");
                i = appendInt(out, i, @intCast(br));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(bgr));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(bb));
                i = appendChar(out, i, 'm');
                lastBgR = br; lastBgG = bgr; lastBgB = bb;
            }

            i = appendCodepoint(out, i, chars[cell_idx]);
            if (i >= out.len) return i; // truncated
        }
        i = appendStr(out, i, "\r\n");
    }
    i = appendStr(out, i, "\x1b[0m");
    return i;
}

// ---- Diff-based ANSI emitter ---------------------------------------------
// Compares current cell grid to caller-supplied shadow buffers (chars / fg /
// bg / attrs of the same shape), emits cursor-position + SGR + char only
// for cells that changed, copies current → shadow as it goes.
//
// On `force=true` (first frame, post-resize, or whenever the caller knows
// the shadow is stale) we emit \x1b[H\x1b[2J + every cell. Either way the
// shadow ends up matching the buffer, so subsequent frames are honest diffs.
//
// Cursor model: we track where we believe the terminal cursor is. When we
// emit a char that lands at column == width, the terminal auto-wraps to
// (0, row+1). We mirror that in our model so the next cursor-position skip
// stays correct.

inline fn rgbaEq(a: ansi.RGBA, b: ansi.RGBA) bool {
    return a[0] == b[0] and a[1] == b[1] and a[2] == b[2];
}

export fn bufferEncodeAnsiDiff(
    bufferPtr: *buffer.OptimizedBuffer,
    shadowCharsPtr: [*]u32,
    shadowFgPtr: [*]ansi.RGBA,
    shadowBgPtr: [*]ansi.RGBA,
    shadowAttrsPtr: [*]u32,
    outPtr: [*]u8,
    outLen: usize,
    force: bool,
) usize {
    const out = outPtr[0..outLen];
    var i: usize = 0;

    if (force) i = appendStr(out, i, "\x1b[H\x1b[2J");

    var lastFgR: i32 = -1;
    var lastFgG: i32 = -1;
    var lastFgB: i32 = -1;
    var lastBgR: i32 = -1;
    var lastBgG: i32 = -1;
    var lastBgB: i32 = -1;
    var lastAttrs: i32 = -1;
    var termRow: i32 = -1; // unknown
    var termCol: i32 = -1;

    const width = bufferPtr.width;
    const height = bufferPtr.height;
    const chars = bufferPtr.getCharPtr();
    const fg_arr = bufferPtr.getFgPtr();
    const bg_arr = bufferPtr.getBgPtr();
    const attrs_arr = bufferPtr.getAttributesPtr();

    var y: u32 = 0;
    while (y < height) : (y += 1) {
        var x: u32 = 0;
        while (x < width) : (x += 1) {
            const idx: usize = @as(usize, y) * width + x;
            const cellChar = chars[idx];
            const cellFg = fg_arr[idx];
            const cellBg = bg_arr[idx];
            const cellAttrs = attrs_arr[idx] & 0xFF;

            const changed = force or
                cellChar != shadowCharsPtr[idx] or
                cellAttrs != (shadowAttrsPtr[idx] & 0xFF) or
                !rgbaEq(cellFg, shadowFgPtr[idx]) or
                !rgbaEq(cellBg, shadowBgPtr[idx]);

            if (!changed) continue;

            const wantRow: i32 = @intCast(y);
            const wantCol: i32 = @intCast(x);
            if (termRow != wantRow or termCol != wantCol) {
                i = appendStr(out, i, "\x1b[");
                i = appendInt(out, i, @intCast(wantRow + 1));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(wantCol + 1));
                i = appendChar(out, i, 'H');
                termRow = wantRow;
                termCol = wantCol;
            }

            const fr = clampUnit(cellFg[0]);
            const fgg = clampUnit(cellFg[1]);
            const fb = clampUnit(cellFg[2]);
            const br = clampUnit(cellBg[0]);
            const bgr = clampUnit(cellBg[1]);
            const bb = clampUnit(cellBg[2]);
            const ai: i32 = @intCast(cellAttrs);

            if (ai != lastAttrs) {
                i = appendStr(out, i, "\x1b[0m");
                if (ai & 1 != 0) i = appendStr(out, i, "\x1b[1m");
                if (ai & 2 != 0) i = appendStr(out, i, "\x1b[2m");
                if (ai & 4 != 0) i = appendStr(out, i, "\x1b[3m");
                if (ai & 8 != 0) i = appendStr(out, i, "\x1b[4m");
                if (ai & 32 != 0) i = appendStr(out, i, "\x1b[7m");
                lastAttrs = ai;
                lastFgR = -1; lastFgG = -1; lastFgB = -1;
                lastBgR = -1; lastBgG = -1; lastBgB = -1;
            }
            if (fr != lastFgR or fgg != lastFgG or fb != lastFgB) {
                i = appendStr(out, i, "\x1b[38;2;");
                i = appendInt(out, i, @intCast(fr));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(fgg));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(fb));
                i = appendChar(out, i, 'm');
                lastFgR = fr; lastFgG = fgg; lastFgB = fb;
            }
            if (br != lastBgR or bgr != lastBgG or bb != lastBgB) {
                i = appendStr(out, i, "\x1b[48;2;");
                i = appendInt(out, i, @intCast(br));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(bgr));
                i = appendChar(out, i, ';');
                i = appendInt(out, i, @intCast(bb));
                i = appendChar(out, i, 'm');
                lastBgR = br; lastBgG = bgr; lastBgB = bb;
            }

            i = appendCodepoint(out, i, cellChar);

            // Update cursor model — auto-wrap on right edge.
            termCol += 1;
            if (termCol >= @as(i32, @intCast(width))) {
                termCol = 0;
                termRow += 1;
            }

            // Commit to shadow.
            shadowCharsPtr[idx] = cellChar;
            shadowFgPtr[idx] = cellFg;
            shadowBgPtr[idx] = cellBg;
            shadowAttrsPtr[idx] = cellAttrs;

            if (i >= out.len) return i;
        }
    }

    i = appendStr(out, i, "\x1b[0m");
    return i;
}

export fn createTextBuffer(widthMethod: u8) ?*text_buffer.UnifiedTextBuffer {
    const pool = gp.initGlobalPool(arena_allocator);
    const link_pool = link.initGlobalLinkPool(arena_allocator);
    const wMethod: utf8.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;
    return text_buffer.UnifiedTextBuffer.init(wasm_allocator, pool, link_pool, wMethod) catch null;
}

export fn destroyTextBuffer(tb: *text_buffer.UnifiedTextBuffer) void {
    tb.deinit();
}

export fn textBufferAppend(tb: *text_buffer.UnifiedTextBuffer, dataPtr: [*]const u8, dataLen: usize) void {
    tb.append(dataPtr[0..dataLen]) catch {};
}

export fn createEditBuffer(widthMethod: u8) ?*edit_buffer_mod.EditBuffer {
    const pool = gp.initGlobalPool(arena_allocator);
    const link_pool = link.initGlobalLinkPool(arena_allocator);
    const wMethod: utf8.WidthMethod = if (widthMethod == 0) .wcwidth else .unicode;
    return edit_buffer_mod.EditBuffer.init(wasm_allocator, pool, link_pool, wMethod) catch null;
}

export fn destroyEditBuffer(eb: *edit_buffer_mod.EditBuffer) void {
    eb.deinit();
}

export fn editBufferInsertText(eb: *edit_buffer_mod.EditBuffer, textPtr: [*]const u8, textLen: usize) void {
    eb.insertText(textPtr[0..textLen]) catch {};
}

export fn editBufferGetText(eb: *edit_buffer_mod.EditBuffer, outPtr: [*]u8, maxLen: usize) usize {
    return eb.getText(outPtr[0..maxLen]);
}

export fn editBufferGetCursor(eb: *edit_buffer_mod.EditBuffer, outRow: *u32, outCol: *u32) void {
    const cursor = eb.getPrimaryCursor();
    outRow.* = cursor.row;
    outCol.* = cursor.col;
}

export fn editBufferDeleteCharBackward(eb: *edit_buffer_mod.EditBuffer) void {
    eb.backspace() catch {};
}

export fn editBufferDeleteChar(eb: *edit_buffer_mod.EditBuffer) void {
    eb.deleteForward() catch {};
}

export fn editBufferMoveCursorLeft(eb: *edit_buffer_mod.EditBuffer) void {
    eb.moveLeft();
}

export fn editBufferMoveCursorRight(eb: *edit_buffer_mod.EditBuffer) void {
    eb.moveRight();
}

export fn editBufferMoveCursorUp(eb: *edit_buffer_mod.EditBuffer) void {
    eb.moveUp();
}

export fn editBufferMoveCursorDown(eb: *edit_buffer_mod.EditBuffer) void {
    eb.moveDown();
}

export fn editBufferNewLine(eb: *edit_buffer_mod.EditBuffer) void {
    eb.insertText("\n") catch {};
}

export fn editBufferGetLineCount(eb: *edit_buffer_mod.EditBuffer) u32 {
    return eb.tb.getLineCount();
}
