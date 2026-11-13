// 三维视图页：引擎单例挂载、轨道交互、图层显隐/透明度、三向剖切盒
import type { Project } from '../../types';
import { appStore } from '../../store/app-store';
import { h, clear, rgbCss } from '../dom';
import { toast } from '../toast';
import { FULL_CLIP, type ClipBox, type LayerStyleState } from '../../render/gpu-engine';
import { getEngine, initEngine } from '../../render/engine-singleton';

export async function renderView3dPage(root: HTMLElement): Promise<void> {
  const project = appStore.current();
  clear(root);
  if (!project) {
    root.append(h('div.empty', {}, h('div', {}, '请先选择项目')));
    return;
  }
  if (!project.model) {
    root.append(h('div.empty', {},
      h('div', { style: { fontSize: '15px' } }, '还没有模型'),
      h('div.muted', {}, '请先到「建模参数」页执行建模'),
      h('button.btn', { onclick: () => (location.hash = '#/params') }, '去建模'),
    ));
    return;
  }

  const viewport = h('div.viewport') as HTMLElement;
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const overlay = h('canvas', {}) as HTMLCanvasElement;
  viewport.append(canvas, overlay);
  root.append(viewport, sidePanel(project));

  if (appStore.getState().gpuAvailable === true) {
    await startGpu(viewport, canvas, overlay, project);
  } else {
    startCpuFallback(viewport, project);
  }
}

export function detachView(): void {
  getEngine()?.attach(null, null);
}

async function startGpu(viewport: HTMLElement, canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, project: Project): Promise<void> {
  try {
    const engine = await initEngine();
    engine.attach(canvas, overlay);
    engine.setLithologies(project.lithologies);
    engine.setBoreholes(project.boreholes);
    const m = project.model!;
    // 已有同尺寸模型数据则直接复用纹理，否则从保存的体素上传
    engine.uploadVoxels(m.voxels, m.lithologyIndex, m.bounds, m.gridSize);
    engine.syncLayerStyles();
    bindMouse(canvas, engine);
    viewport.append(hud(project, m.backend === 'webgpu' ? 'WebGPU compute · DDA 光线步进' : 'CPU 建模结果 · WebGPU 渲染'));
  } catch (err) {
    console.error(err);
    toast(`WebGPU 启动失败，切换 CPU 渲染：${(err as Error).message}`, 'err');
    appStore.setGpuAvailable(false);
    startCpuFallback(viewport, project);
  }
}

/** CPU 回退渲染：体素水平切片 + 剖切盒控制切片位置 */
function startCpuFallback(viewport: HTMLElement, project: Project): void {
  const c = document.createElement('canvas');
  c.style.position = 'absolute';
  c.style.inset = '0';
  c.style.width = '100%';
  c.style.height = '100%';
  viewport.querySelector('canvas')?.remove();
  viewport.prepend(c);
  const clip: ClipBox = structuredClone(FULL_CLIP);
  const draw = (): void => drawCpuSlice(c, project, clip);
  (viewport as unknown as { _redraw: () => void })._redraw = draw;
  draw();
  viewport.append(hud(project, 'CPU 回退渲染（体素切片，剖切盒可用）'));
  toast('当前浏览器/环境不支持 WebGPU，已启用 CPU 回退视图', 'warn', 6000);
}

function drawCpuSlice(c: HTMLCanvasElement, project: Project, clip: ClipBox): void {
  const m = project.model!;
  const N = m.gridSize;
  const dpr = devicePixelRatio;
  const w = c.clientWidth * dpr;
  const hgt = c.clientHeight * dpr;
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#121821';
  ctx.fillRect(0, 0, w, hgt);
  const colorOf = new Map(project.lithologies.map((l) => [l.id, l.color]));
  const iz = Math.min(N - 1, Math.max(0, Math.floor(clip.max[2] * N) - 1));
  const cell = Math.max(1, Math.floor(Math.min(w, hgt) / N));
  const ox = (w - cell * N) / 2;
  const oy = (hgt - cell * N) / 2;
  const i0 = Math.floor(clip.min[0] * N);
  const i1 = Math.ceil(clip.max[0] * N);
  const j0 = Math.floor(clip.min[1] * N);
  const j1 = Math.ceil(clip.max[1] * N);
  for (let iy = j0; iy < j1; iy++) {
    for (let ix = i0; ix < i1; ix++) {
      const code = m.voxels[ix + iy * N + iz * N * N];
      if (code === 0) continue;
      const id = m.lithologyIndex[code - 1];
      const rgb = colorOf.get(id) ?? [150, 150, 150];
      ctx.fillStyle = rgbCss(rgb as [number, number, number]);
      ctx.fillRect(ox + ix * cell, oy + iy * cell, cell, cell);
    }
  }
  ctx.strokeStyle = 'rgba(120,220,255,0.9)';
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(ox + i0 * cell, oy + j0 * cell, (i1 - i0) * cell, (j1 - j0) * cell);
  ctx.fillStyle = '#8a98a8';
  ctx.font = `${12 * dpr}px system-ui`;
  ctx.fillText(`水平切片 z=${iz}/${N - 1}（拖动剖切盒 Z 上限改变切片位置）`, 16 * dpr, hgt - 16 * dpr);
}

function hud(project: Project, backend: string): HTMLElement {
  const m = project.model!;
  return h('div.hud', {},
    h('div', {}, h('b', {}, backend)),
    h('div', {}, `网格 ${m.gridSize}³　体素 ${(m.gridSize ** 3).toLocaleString()}　层位 ${m.lithologyIndex.length} 个`),
    h('div', {}, `建模总耗时 ${m.buildMs.toFixed(0)} ms（${m.backend}）`),
    h('div.muted', { style: { marginTop: '4px' } }, '左键旋转 · 右键平移 · 滚轮缩放'),
  );
}

function bindMouse(canvas: HTMLCanvasElement, eng: NonNullable<ReturnType<typeof getEngine>>): void {
  let dragging: 'rotate' | 'pan' | null = null;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    dragging = e.button === 2 ? 'pan' : 'rotate';
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragging === 'rotate') eng.camera.rotate(-dx * 0.008, -dy * 0.008);
    else eng.camera.pan(dx, dy);
  });
  canvas.addEventListener('pointerup', () => { dragging = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    eng.camera.zoom(e.deltaY > 0 ? 1.12 : 0.89);
  }, { passive: false });
}

function sidePanel(project: Project): HTMLElement {
  const panel = h('div.sidebar', { style: { width: '300px' } });
  const m = project.model!;
  const engine = getEngine();

  // 图层控制
  const layerCard = h('div.card', {}, h('h3', {}, '图层显隐 / 透明度'));
  const colorOf = new Map(project.lithologies.map((l) => [l.id, l]));
  m.lithologyIndex.forEach((id, idx) => {
    const litho = colorOf.get(id);
    const rgb = litho?.color ?? [150, 150, 150];
    const name = litho?.name ?? id;
    const state: LayerStyleState = engine?.layerStyles[idx] ?? { visible: true, alpha: 1 };
    const checkbox = h('input', { type: 'checkbox', ...(state.visible ? { checked: true } : {}) }) as HTMLInputElement;
    const range = h('input', { type: 'range', min: '0.05', max: '1', step: '0.05', value: String(state.alpha) }) as HTMLInputElement;
    const row = h('div.layer-row', {},
      h('span.swatch', { style: { background: rgbCss(rgb as [number, number, number]) } }),
      h('span.name', {}, name),
      checkbox,
      range,
    );
    const apply = (): void => {
      if (!engine) return;
      engine.layerStyles[idx] = { visible: checkbox.checked, alpha: Number(range.value) };
      engine.syncLayerStyles();
    };
    checkbox.addEventListener('change', apply);
    range.addEventListener('input', apply);
    layerCard.append(row);
  });

  // 剖切盒
  const clipCard = h('div.card', {}, h('h3', {}, '三向剖切盒（切口自动封面）'));
  const axes: { key: 0 | 1 | 2; label: string }[] = [
    { key: 0, label: 'X' }, { key: 1, label: 'Y' }, { key: 2, label: 'Z' },
  ];
  const clip: ClipBox = engine ? structuredClone(engine.clip) : structuredClone(FULL_CLIP);
  for (const ax of axes) {
    const lo = h('input', { type: 'number', min: '0', max: '1', step: '0.02', value: clip.min[ax.key].toFixed(2) }) as HTMLInputElement;
    const hi = h('input', { type: 'number', min: '0', max: '1', step: '0.02', value: clip.max[ax.key].toFixed(2) }) as HTMLInputElement;
    const apply = (): void => {
      clip.min[ax.key] = Math.min(Number(lo.value), Number(hi.value) - 0.01);
      clip.max[ax.key] = Math.max(Number(hi.value), Number(lo.value) + 0.01);
      engine?.setClip(structuredClone(clip));
      const vp = document.querySelector('.viewport') as unknown as { _redraw?: () => void } | null;
      vp?._redraw?.();
    };
    lo.addEventListener('change', apply);
    hi.addEventListener('change', apply);
    clipCard.append(h('div.clip-row', {}, h('span', {}, ax.label), lo, hi));
  }
  clipCard.append(
    h('div.row', { style: { marginTop: '8px' } },
      h('button.btn.secondary.small', {
        onclick: () => {
          Object.assign(clip, structuredClone(FULL_CLIP));
          engine?.setClip(structuredClone(FULL_CLIP));
          renderView3dPage(document.querySelector<HTMLElement>('#page-root')!);
        },
      }, '复位剖切'),
      h('button.btn.secondary.small', {
        onclick: () => {
          if (engine) engine.showBoreholes = !engine.showBoreholes;
        },
      }, '钻孔柱 开/关'),
      h('button.btn.secondary.small', {
        onclick: () => engine?.resetView(),
      }, '复位视角'),
    ),
  );

  panel.append(layerCard, clipCard);
  return panel;
}
