//! WASM entry point exposing the pure-compute subset of opentui.
//!
//! This file is a side-experiment to validate the wasm32-freestanding build path.
//! It deliberately excludes terminal.zig, file-logger.zig, and renderer.zig so the
//! module compiles without OS-side imports. The export surface is intentionally
//! small — enough to prove the build works and to exercise the JS shim end-to-end.

const std = @import("std");

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
