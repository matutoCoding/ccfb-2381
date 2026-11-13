// 剖面页：俯视平面图上绘制折线 -> 沿折线生成地质剖面 -> 导出 PNG
import type { Project, SectionPoint, SectionResult } from '../../types';
import { appStore } from '../../store/app-store';
import { h, clear, rgbCss } from '../dom';
import { toast } from '../toast';
import { buildSection, polylineLength } from '../../lib/section';

let section: SectionResult | null = null;
let polyline: SectionPoint[] = [];
let ve = 2;
let corridor = 25;

export function renderSectionPage(root: HTMLElement): void {
  const project = appStore.current();
  clear(root);
  if (!project) {
    root.append(h('div.empty', {}, h('div', {}, '请先选择项目')));
    return;
  }
  if (!project.model) {
    root.append(h('div.empty', {},
      h('div', { style: { fontSize: '15px' } }, '还没有模型'),
      h('div.muted', {}, '剖面与三维共用同一套层位面，请先建模'),
      h('button.btn', { onclick: () => (location.hash = '#/params') }, '去建模'),
    ));
    return;
  }

  const viewport = h('div.viewport', { style: { display: 'flex', flexDirection: 'column' } });
  const planHost = h('div', { style: { flex: '1.1', position: 'relative', borderBottom: '1px solid var(--border)' } });
  const sectionHost = h('div', { style: { flex: '1', position: 'relative', overflow: 'hidden' } });
  viewport.append(planHost, sectionHost);

  const planCanvas = document.createElement('canvas');
  planCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
  planHost.append(planCanvas);

  const sectionCanvas = document.createElement('canvas');
  sectionCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  sectionHost.append(sectionCanvas);

  const plan = new PlanView(planCanvas, project, () => polyline, (pts) => {
    polyline = pts;
    recompute(project, sectionCanvas);
  });
  plan.draw();

  viewport.append(
    h('div.section-toolbar', {},
      h('button.btn.small', { onclick: () => { polyline = []; plan.draw(); clear(sectionCanvas); section = null; } }, '清空折线'),
      h('button.btn.small', {
        onclick: () => {
          const b = project.model!.bounds;
          polyline = [
            { x: b.minX + (b.maxX - b.minX) * 0.08, y: (b.minY + b.maxY) / 2 },
            { x: b.maxX - (b.maxX - b.minX) * 0.08, y: (b.minY + b.maxY) / 2 },
          ];
          plan.draw();
          recompute(project, sectionCanvas);
        },
      }, '示例横线'),
      h('button.btn.small', { onclick: () => { ve = Math.max(1, ve - 1); recompute(project, sectionCanvas); toast(`垂直夸张 ×${ve}`); } }, 'VE -'),
      h('button.btn.small', { onclick: () => { ve = Math.min(10, ve + 1); recompute(project, sectionCanvas); toast(`垂直夸张 ×${ve}`); } }, 'VE +'),
      h('button.btn.secondary.small', {
        onclick: () => {
          corridor = corridor >= 60 ? 10 : corridor + 5;
          recompute(project, sectionCanvas);
          toast(`钻孔走廊半宽 ${corridor}m`);
        },
      }, `走廊 ${corridor}m`),
      h('button.btn.secondary.small', { onclick: () => exportPng(project) }, '导出 PNG'),
    ),
    h('div.section-hint', {},
      h('div', {}, '① 在俯视平面图上单击添加折线顶点，双击结束'),
      h('div', {}, '② 剖面与三维视图使用同一层位面，界线严格对应'),
      h('div', {}, '③ 走廊内钻孔按里程投影到剖面，标注左右偏移'),
    ),
  );

  root.append(viewport);
  if (polyline.length >= 2) recompute(project, sectionCanvas);
}

function recompute(project: Project, canvas: HTMLCanvasElement): void {
  if (polyline.length < 2) return;
  section = buildSection(polyline, project.model!.surfaces, project.boreholes, project.model!.bounds, {
    verticalExaggeration: ve,
    corridorWidth: corridor,
  });
  drawSection(canvas, project, section);
}

function exportPng(project: Project): void {
  if (!section) {
    toast('请先绘制剖面折线', 'err');
    return;
  }
  // 离屏 canvas 固定 2400×1100 CSS 像素，按 2.2 倍超采样保证导出清晰度
  const exportCanvas = document.createElement('canvas');
  drawSection(exportCanvas, project, section, 2.2, { w: 2400, h: 1100 });
  const a = document.createElement('a');
  a.download = `${project.name}-剖面-${Math.round(section.totalLength)}m.png`;
  a.href = exportCanvas.toDataURL('image/png');
  a.click();
  toast('剖面 PNG 已导出', 'ok');
}

/** 俯视平面交互视图 */
class PlanView {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private project: Project,
    private getPts: () => SectionPoint[],
    private onChange: (pts: SectionPoint[]) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('click', (e) => this.onClick(e));
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (this.getPts().length >= 2) toast(`剖面折线完成，全长 ${polylineLength(this.getPts()).toFixed(1)} m`, 'ok');
    });
  }

  private toWorld(e: MouseEvent): SectionPoint {
    const r = this.canvas.getBoundingClientRect();
    const dpr = devicePixelRatio;
    const px = (e.clientX - r.left) * dpr - this.ox;
    const py = (e.clientY - r.top) * dpr - this.oy;
    const b = this.project.model!.bounds;
    return {
      x: b.minX + px / this.scale,
      y: b.maxY - py / this.scale,
    };
  }

  private onClick(e: MouseEvent): void {
    const p = this.toWorld(e);
    this.onChange([...this.getPts(), p]);
    this.draw();
  }

  draw(): void {
    const dpr = devicePixelRatio;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;
    const b = this.project.model!.bounds;
    const pad = 40 * dpr;
    this.scale = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
    this.ox = (w - (b.maxX - b.minX) * this.scale) / 2;
    this.oy = (h - (b.maxY - b.minY) * this.scale) / 2;
    const toPx = (p: SectionPoint): [number, number] => [
      this.ox + (p.x - b.minX) * this.scale,
      this.oy + (b.maxY - p.y) * this.scale,
    ];

    ctx.fillStyle = '#121821';
    ctx.fillRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gridStep = 100;
    ctx.font = `${10 * dpr}px system-ui`;
    ctx.fillStyle = '#5a6a7c';
    for (let x = Math.ceil(b.minX / gridStep) * gridStep; x <= b.maxX; x += gridStep) {
      const [px] = toPx({ x, y: b.minY });
      ctx.beginPath(); ctx.moveTo(px, this.oy); ctx.lineTo(px, h - this.oy); ctx.stroke();
      ctx.fillText(`${x}m`, px + 3, h - this.oy + 14 * dpr);
    }
    for (let y = Math.ceil(b.minY / gridStep) * gridStep; y <= b.maxY; y += gridStep) {
      const [, py] = toPx({ x: b.minX, y });
      ctx.beginPath(); ctx.moveTo(this.ox, py); ctx.lineTo(w - this.ox, py); ctx.stroke();
      ctx.fillText(`${y}m`, 4 * dpr, py - 3);
    }

    // 断层
    if (this.project.fault) {
      const f = this.project.fault;
      const [x1, y1] = toPx({ x: f.ax, y: f.ay });
      const [x2, y2] = toPx({ x: f.bx, y: f.by });
      ctx.strokeStyle = '#ff8787';
      ctx.lineWidth = 2.5 * dpr;
      ctx.setLineDash([10 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8787';
      ctx.fillText('断层 F1', (x1 + x2) / 2 + 6 * dpr, (y1 + y2) / 2);
    }

    // 钻孔
    for (const bh of this.project.boreholes) {
      const [px, py] = toPx({ x: bh.x, y: bh.y });
      const hasErr = this.project.validation?.errorBoreholeIds.includes(bh.id);
      ctx.fillStyle = hasErr ? '#ff6b6b' : '#74c0fc';
      ctx.beginPath();
      ctx.arc(px, py, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 折线
    const pts = this.getPts();
    if (pts.length > 0) {
      ctx.strokeStyle = '#ffd43b';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [px, py] = toPx(p);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      pts.forEach((p) => {
        const [px, py] = toPx(p);
        ctx.fillStyle = '#ffd43b';
        ctx.beginPath(); ctx.arc(px, py, 4 * dpr, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.fillStyle = '#8a98a8';
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText('俯视平面图（米）', this.ox, this.oy - 12 * dpr);
  }
}

/** 绘制地质剖面（距离-标高坐标系，含垂直夸张、地层色块、钻孔、标注） */
function drawSection(canvas: HTMLCanvasElement, project: Project, sec: SectionResult, exportScale = 1, exportSize?: { w: number; h: number }): void {
  const dpr = devicePixelRatio * exportScale;
  const cssW = exportSize?.w ?? canvas.clientWidth;
  const cssH = exportSize?.h ?? canvas.clientHeight;
  const w = cssW * dpr;
  const h = cssH * dpr;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0f141b';
  ctx.fillRect(0, 0, w, h);

  const b = sec.bounds;
  const ml = 78 * dpr;
  const mr = 30 * dpr;
  const mt = 30 * dpr;
  const mb = 46 * dpr;
  const plotW = w - ml - mr;
  const plotH = h - mt - mb;

  const zLo = b.minZ;
  const zHi = b.maxZ;
  const zRange = zHi - zLo;
  // 垂直夸张作用于纵向比例尺；若超出绘图画布则整体回缩保证完整显示
  const baseYScale = plotH / zRange;
  const yScale = Math.min(baseYScale * sec.verticalExaggeration, plotH / zRange);
  const usedVE = yScale / baseYScale;
  const sx = (distance: number): number => ml + (distance / sec.totalLength) * plotW;
  const sy = (elev: number): number => mt + ((zHi - elev) / zRange) * (zRange * yScale);
  void usedVE;

  // 坐标网格与刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.fillStyle = '#8a98a8';
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.lineWidth = 1;
  const xStep = niceStep(sec.totalLength / 8);
  for (let d = 0; d <= sec.totalLength + 0.01; d += xStep) {
    const px = sx(d);
    ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + plotH); ctx.stroke();
    ctx.fillText(`${d.toFixed(0)}`, px - 10 * dpr, mt + plotH + 18 * dpr);
  }
  const zStep = niceStep(zRange / 6);
  for (let z = Math.ceil(zLo / zStep) * zStep; z <= zHi; z += zStep) {
    const py = sy(z);
    ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + plotW, py); ctx.stroke();
    ctx.fillText(`${z.toFixed(1)}`, 12 * dpr, py + 4 * dpr);
  }

  // 地层色块：逐采样列绘制，相邻列同岩性合并视觉效果
  const colorOf = new Map(project.lithologies.map((l) => [l.id, l.color]));
  const samples = sec.samples;
  for (let i = 0; i < samples.length - 1; i++) {
    const x0 = sx(samples[i].distance);
    const x1 = sx(samples[i + 1].distance);
    for (const u of samples[i].units) {
      const rgb = colorOf.get(u.lithologyId) ?? [150, 150, 150];
      ctx.fillStyle = rgbCss(rgb as [number, number, number], 0.92);
      const yTop = sy(u.top);
      const yBot = sy(u.bottom);
      ctx.fillRect(x0, yTop, Math.max(1, x1 - x0 + 1), Math.max(1, yBot - yTop));
    }
  }

  // 地层面界线（顶面连线），让透镜体/尖灭边界清晰
  ctx.lineWidth = 1.2 * dpr;
  for (const lithId of project.model!.surfaces.unitIndex) {
    ctx.strokeStyle = 'rgba(20,24,30,0.75)';
    ctx.beginPath();
    let pen = false;
    for (const s of samples) {
      const u = s.units.find((x) => x.lithologyId === lithId);
      const px = sx(s.distance);
      if (!u) { pen = false; continue; }
      const py = sy(u.top);
      if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 地表线
  ctx.strokeStyle = '#e9ecef';
  ctx.lineWidth = 1.8 * dpr;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = sx(s.distance);
    const py = sy(s.groundElev);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // 投影钻孔（走廊内），按真实层序着色
  for (const hit of sec.boreholeHits) {
    const px = sx(hit.distance);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4 * dpr;
    const topY = sy(hit.groundElev);
    const botElev = hit.groundElev - Math.max(...hit.layers.map((l) => l.toDepth));
    ctx.beginPath(); ctx.moveTo(px, topY); ctx.lineTo(px, sy(botElev)); ctx.stroke();
    for (const l of hit.layers) {
      const rgb = colorOf.get(l.lithologyId) ?? [150, 150, 150];
      ctx.strokeStyle = rgbCss(rgb as [number, number, number]);
      ctx.lineWidth = 4 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, sy(hit.groundElev - l.fromDepth));
      ctx.lineTo(px, sy(hit.groundElev - l.toDepth));
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd43b';
    ctx.font = `${10.5 * dpr}px system-ui`;
    ctx.fillText(`${hit.name}${hit.offset >= 0 ? ' R' : ' L'}${Math.abs(hit.offset).toFixed(0)}m`, px - 14 * dpr, topY - 6 * dpr);
  }

  // 边框与标题
  ctx.strokeStyle = '#3a4858';
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect(ml, mt, plotW, plotH);
  ctx.fillStyle = '#d8e0ea';
  ctx.font = `bold ${14 * dpr}px system-ui`;
  ctx.fillText(`${project.name}　工程地质剖面　全长 ${sec.totalLength.toFixed(1)} m　垂直夸张 ×${sec.verticalExaggeration}`, ml, 18 * dpr);
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.fillStyle = '#8a98a8';
  ctx.fillText('里程 (m)', ml + plotW - 60 * dpr, mt + plotH + 34 * dpr);
  ctx.save();
  ctx.translate(16 * dpr, mt + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('标高 (m)', -30 * dpr, 0);
  ctx.restore();

  // 图例
  let lx = ml + 10 * dpr;
  const ly = mt + 10 * dpr;
  ctx.font = `${11 * dpr}px system-ui`;
  for (const lith of project.lithologies) {
    if (!project.model!.lithologyIndex.includes(lith.id)) continue;
    const label = lith.name;
    const tw = ctx.measureText(label).width + 30 * dpr;
    ctx.fillStyle = rgbCss(lith.color);
    ctx.fillRect(lx, ly, 14 * dpr, 14 * dpr);
    ctx.fillStyle = '#d8e0ea';
    ctx.fillText(label, lx + 18 * dpr, ly + 11 * dpr);
    lx += tw;
  }
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return step * pow;
}
