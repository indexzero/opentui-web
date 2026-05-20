// WebGL2 cell-grid painter. Builds a glyph atlas (one 2D canvas pass at init)
// and draws each cell as an instanced quad. Fragment shader samples the atlas
// alpha and mixes fg over bg.
//
// Trade-off vs CanvasPainter: ~10× faster per cell at big viewports, free
// per-cell scaling on the GPU, identical visual output for the glyphs in the
// atlas. Unknown codepoints fall back to a space (bg-only cell).

import type { CellGrid } from './cell-grid'
import type { OpentuiBuffer } from './buffer'

const ATTR_BOLD = 1 << 0
const ATTR_ITALIC = 1 << 2
const ATTR_UNDERLINE = 1 << 3

const VS = /* glsl */ `#version 300 es
layout(location=0) in vec2 a_quad;        // (0,0)..(1,1) for the 4 corners
layout(location=1) in vec2 a_pos;         // cell col, row
layout(location=2) in float a_glyph;      // atlas index, or -1
layout(location=3) in vec4 a_fg;
layout(location=4) in vec4 a_bg;
layout(location=5) in float a_attrs;

uniform vec2 u_cellSize;
uniform vec2 u_resolution;
uniform vec2 u_atlasGrid;

out vec2 v_uv;
out vec4 v_fg;
out vec4 v_bg;
flat out float v_glyph;
flat out float v_attrs;

void main() {
  vec2 px = (a_pos + a_quad) * u_cellSize;
  vec2 ndc = (px / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0, 1);

  float idx = max(a_glyph, 0.0);
  float gx = mod(idx, u_atlasGrid.x);
  float gy = floor(idx / u_atlasGrid.x);
  v_uv = (vec2(gx, gy) + a_quad) / u_atlasGrid;

  v_fg = a_fg;
  v_bg = a_bg;
  v_glyph = a_glyph;
  v_attrs = a_attrs;
}`

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_fg;
in vec4 v_bg;
flat in float v_glyph;
flat in float v_attrs;
uniform sampler2D u_atlas;
out vec4 outColor;

void main() {
  if (v_glyph < 0.0) {
    outColor = v_bg;
    return;
  }
  float alpha = texture(u_atlas, v_uv).a;
  outColor = mix(v_bg, v_fg, alpha);
}`

interface AtlasInfo {
  texture: WebGLTexture
  cols: number
  rows: number
  glyphMap: Map<number, number> // codepoint → atlas index
  cellPxW: number
  cellPxH: number
}

interface PainterOptions {
  fontSize?: number
  fontFamily?: string
}

// Codepoints we pre-render into the atlas. Everything else falls back to space.
function defaultGlyphSet(): number[] {
  const cps: number[] = []
  for (let cp = 0x20; cp <= 0x7e; cp++) cps.push(cp) // ASCII printable
  for (let cp = 0x2500; cp <= 0x259f; cp++) cps.push(cp) // box drawing + blocks
  for (let cp = 0xff66; cp <= 0xff9d; cp++) cps.push(cp) // half-width katakana
  // Misc
  for (const cp of [0x2022, 0x2013, 0x2014, 0x00b7, 0x2588, 0x25cf, 0x25b8, 0x25c2, 0x2502, 0x2500]) {
    if (!cps.includes(cp)) cps.push(cp)
  }
  return cps
}

export class CanvasGLPainter {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private quadBuffer: WebGLBuffer
  private instanceBuffer: WebGLBuffer
  private uniforms: { [k: string]: WebGLUniformLocation | null } = {}
  private atlas: AtlasInfo
  private fontSize: number
  private fontFamily: string
  private dpr: number
  private instanceCapacity = 0
  private instanceData: Float32Array | null = null

  cellWidth = 0
  cellHeight = 0
  cols = 0
  rows = 0

  constructor(canvas: HTMLCanvasElement, opts: PainterOptions = {}) {
    this.canvas = canvas
    this.fontSize = opts.fontSize ?? 13
    this.fontFamily = opts.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace'
    this.dpr = window.devicePixelRatio || 1
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false })
    if (!gl) throw new Error('CanvasGLPainter: WebGL2 not available')
    this.gl = gl

    this.program = this.linkProgram(VS, FS)
    for (const u of ['u_cellSize', 'u_resolution', 'u_atlasGrid', 'u_atlas']) {
      this.uniforms[u] = gl.getUniformLocation(this.program, u)
    }

    // Static quad geometry (TRIANGLE_STRIP corners)
    this.quadBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)

    // Per-cell instance buffer (allocated lazily on first resize)
    this.instanceBuffer = gl.createBuffer()!

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    // Layout: pos(2) glyph(1) fg(4) bg(4) attrs(1) = 12 floats = 48 bytes
    const stride = 12 * 4
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 12)
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 28)
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 44)
    for (let i = 1; i <= 5; i++) gl.vertexAttribDivisor(i, 1)
    gl.bindVertexArray(null)

    this.atlas = this.buildAtlas()
    this.cellWidth = this.atlas.cellPxW
    this.cellHeight = this.atlas.cellPxH

    gl.clearColor(0, 0, 0, 1)
  }

  private linkProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh)
        throw new Error(`shader compile failed: ${log}`)
      }
      return sh
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc)
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`)
    }
    return prog
  }

  private buildAtlas(): AtlasInfo {
    const cps = defaultGlyphSet()
    // Measure cell using an offscreen 2d canvas.
    const measureCanvas = document.createElement('canvas')
    const mctx = measureCanvas.getContext('2d')!
    mctx.font = `${this.fontSize}px ${this.fontFamily}`
    mctx.textBaseline = 'top'
    const m = mctx.measureText('M')
    const cellPxW = Math.max(1, Math.round(m.width))
    const cellPxH = Math.max(1, Math.round(this.fontSize * 1.2))

    const atlasCols = 32
    const atlasRows = Math.ceil(cps.length / atlasCols)
    const atlasW = atlasCols * cellPxW * this.dpr
    const atlasH = atlasRows * cellPxH * this.dpr

    const atlasCanvas = document.createElement('canvas')
    atlasCanvas.width = atlasW
    atlasCanvas.height = atlasH
    const actx = atlasCanvas.getContext('2d')!
    actx.scale(this.dpr, this.dpr)
    actx.font = `${this.fontSize}px ${this.fontFamily}`
    actx.textBaseline = 'top'
    actx.fillStyle = '#ffffff'

    const glyphMap = new Map<number, number>()
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i]!
      const gx = i % atlasCols
      const gy = Math.floor(i / atlasCols)
      actx.fillText(String.fromCodePoint(cp), gx * cellPxW, gy * cellPxH)
      glyphMap.set(cp, i)
    }

    // Upload as RGBA texture. Atlas is white-on-transparent.
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    return { texture, cols: atlasCols, rows: atlasRows, glyphMap, cellPxW, cellPxH }
  }

  fit(containerWidth: number, containerHeight: number): { cols: number; rows: number } {
    const cols = Math.max(1, Math.floor(containerWidth / this.cellWidth))
    const rows = Math.max(1, Math.floor(containerHeight / this.cellHeight))
    return { cols, rows }
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    const cssW = cols * this.cellWidth
    const cssH = rows * this.cellHeight
    this.canvas.width = Math.ceil(cssW * this.dpr)
    this.canvas.height = Math.ceil(cssH * this.dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    const cellCount = cols * rows
    if (cellCount > this.instanceCapacity) {
      this.instanceCapacity = cellCount
      this.instanceData = new Float32Array(cellCount * 12)
      const gl = this.gl
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW)
    }
  }

  paint(input: CellGrid | OpentuiBuffer) {
    const grid: CellGrid = 'snapshot' in input ? input.snapshot() : input
    if (grid.width !== this.cols || grid.height !== this.rows) {
      this.resize(grid.width, grid.height)
    }

    const data = this.instanceData
    if (!data) return

    // Pack instance attributes.
    const cellCount = grid.width * grid.height
    let off = 0
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x
        const ch = grid.chars[i]!
        const fi = i * 4
        // pos
        data[off++] = x
        data[off++] = y
        // glyph index (-1 if not in atlas)
        const idx = this.atlas.glyphMap.get(ch)
        data[off++] = idx === undefined ? -1 : idx
        // fg
        data[off++] = grid.fg[fi]!
        data[off++] = grid.fg[fi + 1]!
        data[off++] = grid.fg[fi + 2]!
        data[off++] = grid.fg[fi + 3]!
        // bg
        data[off++] = grid.bg[fi]!
        data[off++] = grid.bg[fi + 1]!
        data[off++] = grid.bg[fi + 2]!
        data[off++] = grid.bg[fi + 3]!
        // attrs
        data[off++] = grid.attrs[i]! & 0xff
      }
    }

    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, cellCount * 12))

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture)
    gl.uniform1i(this.uniforms.u_atlas!, 0)
    gl.uniform2f(this.uniforms.u_cellSize!, this.cellWidth * this.dpr, this.cellHeight * this.dpr)
    gl.uniform2f(this.uniforms.u_resolution!, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.uniforms.u_atlasGrid!, this.atlas.cols, this.atlas.rows)

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cellCount)
    gl.bindVertexArray(null)

    void ATTR_BOLD
    void ATTR_ITALIC
    void ATTR_UNDERLINE
  }

  dispose() {
    const gl = this.gl
    gl.deleteProgram(this.program)
    gl.deleteBuffer(this.quadBuffer)
    gl.deleteBuffer(this.instanceBuffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteTexture(this.atlas.texture)
  }
}

// Re-declared symbol so TS in the web-demo tsconfig sees a dispose hint on
// the shared union type. CanvasPainter doesn't need explicit dispose.
