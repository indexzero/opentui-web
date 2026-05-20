// WebGPU cell-grid painter. Same shape as CanvasGLPainter — glyph atlas,
// instanced per-cell draws — but in WGSL with a modern API.
//
// Browser support: Chrome / Edge / Safari TP. Throws on init if
// navigator.gpu is unavailable, so callers can fall back to the WebGL
// or 2d painter.

import type { CellGrid } from './cell-grid'
import type { OpentuiBuffer } from './buffer'

const WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) fg: vec4f,
  @location(2) bg: vec4f,
  // All 4 vertices of a quad share the same glyph value (instance attribute),
  // so interpolation choice is moot. Use the default to avoid Chrome's
  // 'flat needs sampling' validation that some versions require.
  @location(3) glyph: f32,
};

struct Uniforms {
  cellSize: vec2f,
  resolution: vec2f,
  atlasGrid: vec2f,
  pad0: vec2f,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@vertex
fn vs_main(
  @location(0) quad: vec2f,
  @location(1) pos: vec2f,
  @location(2) glyph: f32,
  @location(3) fg: vec4f,
  @location(4) bg: vec4f,
) -> VsOut {
  var out: VsOut;
  let px = (pos + quad) * U.cellSize;
  var ndc = (px / U.resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  out.pos = vec4f(ndc, 0.0, 1.0);

  let idx = max(glyph, 0.0);
  let gx = idx - floor(idx / U.atlasGrid.x) * U.atlasGrid.x;
  let gy = floor(idx / U.atlasGrid.x);
  out.uv = (vec2f(gx, gy) + quad) / U.atlasGrid;
  out.fg = fg;
  out.bg = bg;
  out.glyph = glyph;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  // textureSample must be called from uniform control flow — i.e. before
  // any branch on per-fragment data. Sample first, branch second.
  let a = textureSample(atlas, samp, in.uv).a;
  if (in.glyph < 0.0) { return in.bg; }
  return mix(in.bg, in.fg, a);
}
`

interface AtlasInfo {
  texture: GPUTexture
  cols: number
  rows: number
  glyphMap: Map<number, number>
  cellPxW: number
  cellPxH: number
}

interface PainterOptions {
  fontSize?: number
  fontFamily?: string
}

function defaultGlyphSet(): number[] {
  const cps: number[] = []
  for (let cp = 0x20; cp <= 0x7e; cp++) cps.push(cp)
  for (let cp = 0x2500; cp <= 0x259f; cp++) cps.push(cp)
  for (let cp = 0xff66; cp <= 0xff9d; cp++) cps.push(cp)
  for (const cp of [0x2022, 0x2013, 0x2014, 0x00b7, 0x2588, 0x25cf, 0x25b8, 0x25c2]) {
    if (!cps.includes(cp)) cps.push(cp)
  }
  return cps
}

export class CanvasGPUPainter {
  readonly canvas: HTMLCanvasElement
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat
  private pipeline!: GPURenderPipeline
  private quadBuffer!: GPUBuffer
  private instanceBuffer!: GPUBuffer
  private uniformBuffer!: GPUBuffer
  private bindGroup!: GPUBindGroup
  private atlas!: AtlasInfo
  private sampler!: GPUSampler
  private fontSize: number
  private fontFamily: string
  private dpr: number
  private instanceCapacity = 0
  private instanceData: Float32Array | null = null
  private ready = false

  cellWidth = 0
  cellHeight = 0
  cols = 0
  rows = 0

  constructor(canvas: HTMLCanvasElement, opts: PainterOptions = {}) {
    this.canvas = canvas
    this.fontSize = opts.fontSize ?? 13
    this.fontFamily = opts.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace'
    this.dpr = window.devicePixelRatio || 1
    if (!('gpu' in navigator)) {
      throw new Error('CanvasGPUPainter: navigator.gpu unavailable (no WebGPU)')
    }
  }

  // Two-phase init: constructor is sync (so React can hold onto an instance),
  // init() is async (does adapter/device setup). Call before resize/paint.
  async init() {
    if (this.ready) return
    const gpu = navigator.gpu
    const adapter = await gpu.requestAdapter()
    if (!adapter) throw new Error('CanvasGPUPainter: no adapter')
    this.device = await adapter.requestDevice()
    this.device.lost.then((info) => {
      // eslint-disable-next-line no-console
      console.error('[CanvasGPUPainter] device lost:', info.reason, info.message)
    })
    this.device.addEventListener('uncapturederror', (event: Event) => {
      const err = (event as GPUUncapturedErrorEvent).error
      // eslint-disable-next-line no-console
      console.error('[CanvasGPUPainter] uncaptured error:', err.message ?? err)
    })
    this.format = gpu.getPreferredCanvasFormat()
    this.context = this.canvas.getContext('webgpu') as unknown as GPUCanvasContext
    if (!this.context) throw new Error('CanvasGPUPainter: webgpu context unavailable')
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })

    this.atlas = this.buildAtlas()
    this.cellWidth = this.atlas.cellPxW
    this.cellHeight = this.atlas.cellPxH

    const module = this.device.createShaderModule({ code: WGSL })
    // Surface compile errors from the shader (would be silent otherwise).
    const compInfo = await module.getCompilationInfo()
    if (compInfo.messages.some((m) => m.type === 'error')) {
      const msgs = compInfo.messages.map((m) => `${m.type} L${m.lineNum}: ${m.message}`).join('\n')
      throw new Error(`WGSL shader compile failed:\n${msgs}`)
    }
    this.device.pushErrorScope('validation')
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
          },
          {
            arrayStride: 48,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, format: 'float32x2', offset: 0 },
              { shaderLocation: 2, format: 'float32', offset: 8 },
              { shaderLocation: 3, format: 'float32x4', offset: 12 },
              { shaderLocation: 4, format: 'float32x4', offset: 28 },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-strip' },
    })
    const pipelineError = await this.device.popErrorScope()
    if (pipelineError) {
      throw new Error(`createRenderPipeline failed: ${pipelineError.message}`)
    }

    this.quadBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.quadBuffer, 0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))

    this.uniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

    this.rebuildBindGroup()
    this.ready = true
  }

  private buildAtlas(): AtlasInfo {
    const cps = defaultGlyphSet()
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

    const texture = this.device.createTexture({
      size: [atlasCanvas.width, atlasCanvas.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.device.queue.copyExternalImageToTexture(
      { source: atlasCanvas },
      { texture },
      [atlasCanvas.width, atlasCanvas.height],
    )

    return { texture, cols: atlasCols, rows: atlasRows, glyphMap, cellPxW, cellPxH }
  }

  private rebuildBindGroup() {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.atlas.texture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    })
  }

  fit(containerWidth: number, containerHeight: number): { cols: number; rows: number } {
    const cols = Math.max(1, Math.floor(containerWidth / this.cellWidth))
    const rows = Math.max(1, Math.floor(containerHeight / this.cellHeight))
    return { cols, rows }
  }

  resize(cols: number, rows: number) {
    if (!this.ready) return
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    const cssW = cols * this.cellWidth
    const cssH = rows * this.cellHeight
    this.canvas.width = Math.ceil(cssW * this.dpr)
    this.canvas.height = Math.ceil(cssH * this.dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`

    const cellCount = cols * rows
    if (cellCount > this.instanceCapacity) {
      this.instanceCapacity = cellCount
      this.instanceData = new Float32Array(cellCount * 12)
      this.instanceBuffer?.destroy()
      this.instanceBuffer = this.device.createBuffer({
        size: cellCount * 48,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
    }
  }

  paint(input: CellGrid | OpentuiBuffer) {
    if (!this.ready) return
    const grid: CellGrid = 'snapshot' in input ? input.snapshot() : input
    if (grid.width !== this.cols || grid.height !== this.rows) {
      this.resize(grid.width, grid.height)
    }
    const data = this.instanceData
    if (!data) return

    const cellCount = grid.width * grid.height
    let off = 0
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = y * grid.width + x
        const ch = grid.chars[i]!
        const fi = i * 4
        data[off++] = x
        data[off++] = y
        const idx = this.atlas.glyphMap.get(ch)
        data[off++] = idx === undefined ? -1 : idx
        data[off++] = grid.fg[fi]!
        data[off++] = grid.fg[fi + 1]!
        data[off++] = grid.fg[fi + 2]!
        data[off++] = grid.fg[fi + 3]!
        data[off++] = grid.bg[fi]!
        data[off++] = grid.bg[fi + 1]!
        data[off++] = grid.bg[fi + 2]!
        data[off++] = grid.bg[fi + 3]!
        data[off++] = grid.attrs[i]! & 0xff
      }
    }

    this.device.queue.writeBuffer(this.instanceBuffer, 0, data.buffer, 0, cellCount * 48)

    const uniforms = new Float32Array(8)
    uniforms[0] = this.cellWidth * this.dpr
    uniforms[1] = this.cellHeight * this.dpr
    uniforms[2] = this.canvas.width
    uniforms[3] = this.canvas.height
    uniforms[4] = this.atlas.cols
    uniforms[5] = this.atlas.rows
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms.buffer)

    const encoder = this.device.createCommandEncoder()
    const view = this.context.getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.setVertexBuffer(0, this.quadBuffer)
    pass.setVertexBuffer(1, this.instanceBuffer)
    pass.draw(4, cellCount, 0, 0)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  dispose() {
    if (!this.ready) return
    this.instanceBuffer?.destroy()
    this.quadBuffer?.destroy()
    this.uniformBuffer?.destroy()
    this.atlas?.texture.destroy()
  }
}
