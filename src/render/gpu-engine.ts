// WebGPU 引擎：compute shader 体素化 + 片元 DDA 光线步进渲染 + Canvas2D 覆盖层
import type { HorizonSurfaces, Lithology, ModelBounds } from '../types';
import { OrbitCamera, mat4Invert, worldToScreen, type Mat4 } from './camera';
import voxelizeWgsl from './voxelize.wgsl?raw';
import raymarchWgsl from './raymarch.wgsl?raw';

export interface LayerStyleState {
  visible: boolean;
  alpha: number; // 0..1
}

export interface ClipBox {
  min: [number, number, number]; // 归一化 0..1
  max: [number, number, number];
}

export const FULL_CLIP: ClipBox = { min: [0, 0, 0], max: [1, 1, 1] };

const PARAMS_FIELDS = 16; // 渲染 Params uniform 缓冲大小 64 字节（含 WGSL vec3 对齐填充）
const CAM_FLOATS = 16 + 4; // invViewProj + camPos + pad

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export class GpuEngine {
  device!: GPUDevice;
  context: GPUCanvasContext | null = null;
  format!: GPUTextureFormat;
  private pipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bindGroupLayout!: GPUBindGroupLayout;
  private renderBindLayout!: GPUBindGroupLayout;
  private voxelTex!: GPUTexture;
  private layerBuffer!: GPUBuffer;
  private camBuffer!: GPUBuffer;
  private paramBuffer!: GPUBuffer;
  private viewportBuffer!: GPUBuffer;
  private bgBuffer!: GPUBuffer;
  private renderBind!: GPUBindGroup;

  readonly camera = new OrbitCamera();
  clip: ClipBox = structuredClone(FULL_CLIP);
  layerStyles: LayerStyleState[] = [];
  private lithologies: Lithology[] = [];
  private unitIndex: string[] = [];
  private bounds: ModelBounds | null = null;
  private N = 0;
  private canvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private disposed = false;
  showBoreholes = true;
  private boreholeData: { x: number; y: number; layers: { from: number; to: number; color: string }[]; ground: number }[] = [];
  private captureResolve: ((r: { data: Uint8ClampedArray; width: number; height: number }) => void) | null = null;

  constructor() {}

  /** 绑定/更换渲染画布（页面切换时调用）；传 null 表示脱离 DOM，RAF 空转 */
  attach(canvas: HTMLCanvasElement | null, overlayCanvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.overlayCanvas = overlayCanvas;
    this.overlay = overlayCanvas?.getContext('2d') ?? null;
    if (canvas) {
      this.context = canvas.getContext('webgpu');
      this.context?.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    } else {
      this.context = null;
    }
  }

  static async isSupported(): Promise<boolean> {
    return typeof navigator !== 'undefined' && !!navigator.gpu && (await navigator.gpu.requestAdapter()) != null;
  }

  async init(): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到 WebGPU 适配器');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (!this.disposed) console.error('WebGPU device lost:', info.message);
    });
    this.format = navigator.gpu.getPreferredCanvasFormat();

    const computeModule = this.device.createShaderModule({ code: voxelizeWgsl });
    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
              { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
              { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
              { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
              {
                binding: 4,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: { access: 'write-only', format: 'r32uint', viewDimension: '3d' },
              },
            ],
          }),
        ],
      }),
      compute: { module: computeModule, entryPoint: 'main' },
    });

    const rayModule = this.device.createShaderModule({ code: raymarchWgsl });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.device.createBindGroupLayout({
            entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
              {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'uint', viewDimension: '3d', multisampled: false },
              },
              { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
              { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
              { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ],
          }),
        ],
      }),
      vertex: { module: rayModule, entryPoint: 'vsMain' },
      fragment: { module: rayModule, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.bindGroupLayout = this.pipeline.getBindGroupLayout(0);
    this.renderBindLayout = this.renderPipeline.getBindGroupLayout(0);

    this.camBuffer = this.device.createBuffer({ size: CAM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.paramBuffer = this.device.createBuffer({ size: PARAMS_FIELDS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.viewportBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bgBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.bgBuffer, 0, new Float32Array([0.07, 0.09, 0.12, 1]));

    this.loop();
  }

  /** 上传层位面并运行 compute shader 体素化；返回 GPU 端耗时（ms） */
  async voxelize(surfaces: HorizonSurfaces, bounds: ModelBounds, N: number): Promise<number> {
    const S = surfaces.resolution;
    const unitCount = surfaces.unitIndex.length;
    this.N = N;
    this.unitIndex = [...surfaces.unitIndex];
    this.bounds = bounds;

    // uniform 参数（48 字节，12 个 u32/f32 槽位）
    const params = new ArrayBuffer(12 * 4);
    const u32 = new Uint32Array(params);
    const f32 = new Float32Array(params);
    u32[0] = N;
    u32[1] = S;
    u32[2] = unitCount;
    f32[4] = bounds.minX; f32[5] = bounds.maxX; f32[6] = bounds.minY; f32[7] = bounds.maxY;
    f32[8] = bounds.minZ; f32[9] = bounds.maxZ;
    const paramBuf = this.device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuf, 0, params);

    const makeStorage = (grids: Float64Array[]): GPUBuffer => {
      const data = new Float32Array(grids.length * S * S);
      grids.forEach((g, gi) => {
        for (let k = 0; k < S * S; k++) {
          const v = g[k];
          data[gi * S * S + k] = Number.isFinite(v) ? v : NaN;
        }
      });
      const buf = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buf, 0, data);
      return buf;
    };
    const groundBuf = makeStorage([surfaces.ground]);
    const topBuf = makeStorage(surfaces.top);
    const botBuf = makeStorage(surfaces.bottom);

    this.voxelTex?.destroy();
    this.voxelTex = this.device.createTexture({
      size: { width: N, height: N, depthOrArrayLayers: N },
      dimension: '3d',
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const computeBind = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: { buffer: groundBuf } },
        { binding: 2, resource: { buffer: topBuf } },
        { binding: 3, resource: { buffer: botBuf } },
        { binding: 4, resource: this.voxelTex.createView({ dimension: '3d' }) },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, computeBind);
    pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8), 1);
    pass.end();
    this.device.pushErrorScope('validation');
    const start = performance.now();
    this.device.queue.submit([encoder.finish()]);
    const gpuErr = await this.device.popErrorScope();
    if (gpuErr) {
      throw new Error(`GPU compute 校验失败: ${gpuErr.message}`);
    }
    await this.device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - start;

    // 渲染资源
    this.layerBuffer?.destroy();
    this.layerBuffer = this.device.createBuffer({
      size: Math.max(1, unitCount) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.layerStyles = this.unitIndex.map(() => ({ visible: true, alpha: 1 }));
    this.syncLayerStyles();

    const renderParams = new ArrayBuffer(PARAMS_FIELDS * 4);
    void renderParams;
    this.updateRenderParams();

    this.renderBind = this.device.createBindGroup({
      layout: this.renderBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
        { binding: 2, resource: this.voxelTex.createView({ dimension: '3d' }) },
        { binding: 3, resource: { buffer: this.layerBuffer } },
        { binding: 4, resource: { buffer: this.bgBuffer } },
        { binding: 5, resource: { buffer: this.viewportBuffer } },
      ],
    });
    return gpuMs;
  }

  /** 回读体素纹理（供 CPU 一致性校验 / 保存模型），压缩为每体素 1 字节 */
  async readVoxels(): Promise<Uint8Array> {
    const N = this.N;
    const bytesPerRow = N * 4;
    const buf = this.device.createBuffer({
      size: N * N * N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.voxelTex },
      { buffer: buf, bytesPerRow, rowsPerImage: N },
      { width: N, height: N, depthOrArrayLayers: N },
    );
    this.device.queue.submit([encoder.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u32 = new Uint32Array(buf.getMappedRange().slice(0));
    const out = new Uint8Array(N * N * N);
    out.set(u32);
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** 从已保存的体素数据直接上传（无需重跑 compute） */
  uploadVoxels(voxels: Uint8Array, unitIndex: string[], bounds: ModelBounds, N: number): void {
    this.N = N;
    this.unitIndex = [...unitIndex];
    this.bounds = bounds;
    this.voxelTex?.destroy();
    this.voxelTex = this.device.createTexture({
      size: { width: N, height: N, depthOrArrayLayers: N },
      dimension: '3d',
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const data = new Uint32Array(N * N * N);
    data.set(voxels);
    this.device.queue.writeTexture(
      { texture: this.voxelTex },
      data.buffer,
      { bytesPerRow: N * 4, rowsPerImage: N },
      { width: N, height: N, depthOrArrayLayers: N },
    );
    this.layerBuffer?.destroy();
    this.layerBuffer = this.device.createBuffer({
      size: Math.max(1, unitIndex.length) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.layerStyles = this.unitIndex.map(() => ({ visible: true, alpha: 1 }));
    this.syncLayerStyles();
    this.updateRenderParams();
    this.renderBind = this.device.createBindGroup({
      layout: this.renderBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.camBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
        { binding: 2, resource: this.voxelTex.createView({ dimension: '3d' }) },
        { binding: 3, resource: { buffer: this.layerBuffer } },
        { binding: 4, resource: { buffer: this.bgBuffer } },
        { binding: 5, resource: { buffer: this.viewportBuffer } },
      ],
    });
  }

  setLithologies(lithologies: Lithology[]): void {
    this.lithologies = lithologies;
  }

  setBoreholes(boreholes: { x: number; y: number; groundElev: number; layers: { fromDepth: number; toDepth: number; lithologyId: string }[] }[]): void {
    const colorOf = new Map(this.lithologies.map((l) => [l.id, `rgb(${l.color.join(',')})`]));
    this.boreholeData = boreholes.map((b) => ({
      x: b.x,
      y: b.y,
      ground: b.groundElev,
      layers: b.layers.map((l) => ({
        from: l.fromDepth,
        to: l.toDepth,
        color: colorOf.get(l.lithologyId) ?? '#888',
      })),
    }));
  }

  syncLayerStyles(): void {
    if (!this.layerBuffer || this.unitIndex.length === 0) return;
    const colorOf = new Map(this.lithologies.map((l) => [l.id, l.color]));
    const data = new Float32Array(this.unitIndex.length * 4);
    this.unitIndex.forEach((id, i) => {
      const rgb = colorOf.get(id) ?? [150, 150, 150];
      const st = this.layerStyles[i] ?? { visible: true, alpha: 1 };
      data[i * 4 + 0] = srgbToLinear(rgb[0]);
      data[i * 4 + 1] = srgbToLinear(rgb[1]);
      data[i * 4 + 2] = srgbToLinear(rgb[2]);
      data[i * 4 + 3] = st.visible ? st.alpha : 0;
    });
    this.device.queue.writeBuffer(this.layerBuffer, 0, data);
  }

  private updateRenderParams(): void {
    // 与 raymarch.wgsl 的 Params 内存布局一致：
    // 0:N(u32) | 16:clipMin.xyz | 32:clipMax.xyz | 44:maxLayers | 48:ambient
    const p = new ArrayBuffer(64);
    const u = new Uint32Array(p);
    const f = new Float32Array(p);
    u[0] = this.N;
    f[4] = this.clip.min[0]; f[5] = this.clip.min[1]; f[6] = this.clip.min[2];
    f[8] = this.clip.max[0]; f[9] = this.clip.max[1]; f[10] = this.clip.max[2];
    u[11] = this.unitIndex.length;
    f[12] = 0.35; // ambient @48
    this.device.queue.writeBuffer(this.paramBuffer, 0, p);
  }

  setClip(clip: ClipBox): void {
    this.clip = clip;
    this.updateRenderParams();
  }
  resetView(): void {
    this.camera.azimuth = -Math.PI * 0.25;
    this.camera.polar = Math.PI * 0.32;
    this.camera.distance = 1.9;
    this.camera.target = [0.5, 0.5, 0.35];
  }

  /** 工程坐标 -> 单位立方体归一化坐标 */
  private normalize(x: number, y: number, z: number): [number, number, number] {
    const b = this.bounds!;
    return [
      (x - b.minX) / (b.maxX - b.minX),
      (y - b.minY) / (b.maxY - b.minY),
      (z - b.minZ) / (b.maxZ - b.minZ),
    ];
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.render();
  };

  private render(): void {
    if (!this.canvas || !this.context) return;
    const canvas = this.canvas;
    const w = canvas.clientWidth * devicePixelRatio;
    const h = canvas.clientHeight * devicePixelRatio;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (this.overlayCanvas) {
        this.overlayCanvas.width = w;
        this.overlayCanvas.height = h;
      }
    }
    const aspect = w / h;
    const vp = this.camera.viewProj(aspect);
    const cam = new Float32Array(CAM_FLOATS);
    cam.set(mat4Invert(vp), 0);
    const eye = this.camera.eye();
    cam.set(eye, 16);
    this.device.queue.writeBuffer(this.camBuffer, 0, cam);
    this.device.queue.writeBuffer(this.viewportBuffer, 0, new Float32Array([w, h, 0, 0]));

    this.device.pushErrorScope('validation');
    const encoder = this.device.createCommandEncoder();

    // 需要截帧时渲染到离屏纹理，再在同一 encoder 内复制到 canvas 和读回缓冲
    let captureTex: GPUTexture | null = null;
    let captureBuf: GPUBuffer | null = null;
    let captureBytesPerRow = 0;
    if (this.captureResolve) {
      captureTex = this.device.createTexture({
        size: { width: w, height: h, depthOrArrayLayers: 1 },
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      captureBytesPerRow = Math.ceil((w * 4) / 256) * 256;
      captureBuf = this.device.createBuffer({
        size: captureBytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    const drawScene = (view: GPUTextureView): void => {
      const rp = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.07, g: 0.09, b: 0.12, a: 1 }, loadOp: 'clear', storeOp: 'store',
        }],
      });
      if (this.renderBind) {
        rp.setPipeline(this.renderPipeline);
        rp.setBindGroup(0, this.renderBind);
        rp.draw(6);
      }
      rp.end();
    };

    // 截帧：先渲染离屏纹理用于回读，再渲染 canvas 用于显示；普通帧只渲染 canvas
    if (captureTex) drawScene(captureTex.createView());
    drawScene(this.context.getCurrentTexture().createView());

    if (captureTex && captureBuf) {
      encoder.copyTextureToBuffer(
        { texture: captureTex },
        { buffer: captureBuf, bytesPerRow: captureBytesPerRow, rowsPerImage: h },
        [w, h, 1],
      );
    }
    this.device.queue.submit([encoder.finish()]);
    this.device.popErrorScope().then((err) => {
      if (err) console.error('WebGPU render validation error:', err.message);
    });

    if (captureTex && captureBuf && this.captureResolve) {
      const resolve = this.captureResolve;
      this.captureResolve = null;
      const tex = captureTex;
      const buf = captureBuf;
      const bytesPerRow = captureBytesPerRow;
      void this.mapCaptureBuffer(buf, tex, w, h, bytesPerRow).then(resolve);
    }

    this.drawOverlay(vp, w, h);
  }

  /** 映射截帧缓冲并转换为 RGBA */
  private async mapCaptureBuffer(
    buf: GPUBuffer,
    tex: GPUTexture,
    width: number,
    height: number,
    bytesPerRow: number,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange().slice(0));
    buf.unmap();
    buf.destroy();
    tex.destroy();
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const si = y * bytesPerRow + x * 4;
        const di = (y * width + x) * 4;
        out[di] = raw[si + 2];
        out[di + 1] = raw[si + 1];
        out[di + 2] = raw[si];
        out[di + 3] = 255;
      }
    }
    return { data: out, width, height };
  }

  private drawOverlay(vp: Mat4, w: number, h: number): void {
    const ctx = this.overlay;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!this.bounds || this.N === 0) return;
    const dpr = devicePixelRatio;
    ctx.save();
    ctx.scale(dpr, dpr);
    const cw = w / dpr;
    const ch = h / dpr;
    const project = (p: [number, number, number]) => worldToScreen(vp, p, cw, ch);

    // 剖切盒线框（12 条棱）
    const { min, max } = this.clip;
    const corners: [number, number, number][] = [];
    for (const z of [min[2], max[2]])
      for (const y of [min[1], max[1]])
        for (const x of [min[0], max[0]]) corners.push([x, y, z]);
    const edges: [number, number][] = [
      [0, 1], [0, 2], [1, 3], [2, 3],
      [4, 5], [4, 6], [5, 7], [6, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    ctx.strokeStyle = 'rgba(120,220,255,0.9)';
    ctx.lineWidth = 1.2;
    for (const [a, b] of edges) {
      const pa = project(corners[a]);
      const pb = project(corners[b]);
      if (pa && pb) {
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }

    // 钻孔柱（按层着色的线段）
    if (this.showBoreholes) {
      for (const bh of this.boreholeData) {
        const top = this.normalize(bh.x, bh.y, bh.ground);
        const bot = this.normalize(bh.x, bh.y, bh.ground - Math.max(...bh.layers.map((l) => l.to), 1));
        const pTop = project(top);
        const pBot = project(bot);
        if (!pTop || !pBot) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(pTop.x, pTop.y);
        ctx.lineTo(pBot.x, pBot.y);
        ctx.stroke();
        for (const l of bh.layers) {
          const z1 = this.normalize(bh.x, bh.y, bh.ground - l.from)[2];
          const z2 = this.normalize(bh.x, bh.y, bh.ground - l.to)[2];
          const p1 = project([top[0], top[1], z1]);
          const p2 = project([top[0], top[1], z2]);
          if (p1 && p2) {
            ctx.strokeStyle = l.color;
            ctx.lineWidth = 3.4;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    }

    // 坐标轴（左下角小工具）
    this.drawAxisGizmo(ctx, cw, ch);
    ctx.restore();
  }

  private drawAxisGizmo(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
    const cx = cw - 64;
    const cy = ch - 64;
    const R = 34;
    const eye = this.camera.eye();
    const dir: [number, number, number] = [0.5 - eye[0], 0.5 - eye[1], 0.5 - eye[2]];
    const l = Math.hypot(...dir) || 1;
    const f: Vec3Like = [dir[0] / l, dir[1] / l, dir[2] / l];
    const right: Vec3Like = [f[1], -f[0], 0];
    const rl = Math.hypot(...right) || 1;
    right[0] /= rl; right[1] /= rl;
    const up: Vec3Like = [
      f[1] * 0 - f[2] * right[1],
      f[2] * right[0] - f[0] * 0,
      f[0] * right[1] - f[1] * right[0],
    ];
    const axes: { v: Vec3Like; color: string; label: string }[] = [
      { v: [1, 0, 0], color: '#ff6b6b', label: 'X' },
      { v: [0, 1, 0], color: '#51cf66', label: 'Y' },
      { v: [0, 0, 1], color: '#74c0fc', label: 'Z' },
    ];
    ctx.font = 'bold 12px system-ui';
    for (const ax of axes) {
      const sx = cx + (ax.v[0] * right[0] + ax.v[1] * right[1] + ax.v[2] * right[2]) * R;
      const sy = cy - (ax.v[0] * up[0] + ax.v[1] * up[1] + ax.v[2] * up[2]) * R;
      ctx.strokeStyle = ax.color;
      ctx.fillStyle = ax.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.fillText(ax.label, sx + (sx > cx ? 3 : -8), sy + 4);
    }
  }

  /** 读回当前渲染画面（WebGPU canvas 无法用 2D drawImage 读取，必须走 copyTextureToBuffer） */
  /** 请求下一渲染帧的像素（与屏幕显示同帧同源，避免读到已 present 的空纹理） */
  readPixels(): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    if (!this.canvas || !this.context) return Promise.reject(new Error('引擎未挂载画布'));
    return new Promise((resolve) => {
      this.captureResolve = resolve;
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.voxelTex?.destroy();
    this.layerBuffer?.destroy();
    this.camBuffer?.destroy();
    this.paramBuffer?.destroy();
    this.viewportBuffer?.destroy();
    this.bgBuffer?.destroy();
    this.device?.destroy();
  }
}

type Vec3Like = [number, number, number];
