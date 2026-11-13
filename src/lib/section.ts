// 剖面生成：沿俯视折线采样层位面。
// 与三维体素使用同一个 HorizonSurfaces，因此剖面地层界线与三维层位严格对应。
import type { Borehole, HorizonSurfaces, ModelBounds, SectionBoreholeHit, SectionPoint, SectionResult } from '../types';
import { dist, projectPointToSegment } from './math';
import { sampleSurfaces } from './stratigraphy';

export function polylineLength(polyline: SectionPoint[]): number {
  let len = 0;
  for (let i = 1; i < polyline.length; i++) len += dist(polyline[i - 1].x, polyline[i - 1].y, polyline[i].x, polyline[i].y);
  return len;
}

/** 累计里程 -> 折线坐标 */
export function pointAtDistance(polyline: SectionPoint[], distance: number): { x: number; y: number } {
  let remaining = distance;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const segLen = dist(a.x, a.y, b.x, b.y);
    if (remaining <= segLen || i === polyline.length - 1) {
      const t = segLen === 0 ? 0 : Math.min(1, remaining / segLen);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  const last = polyline[polyline.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * 生成剖面。
 * @param corridorWidth 投影到剖面上的钻孔走廊半宽（米）
 */
export function buildSection(
  polyline: SectionPoint[],
  surfaces: HorizonSurfaces,
  boreholes: Borehole[],
  bounds: ModelBounds,
  opts: { verticalExaggeration: number; corridorWidth: number },
): SectionResult {
  const totalLength = polylineLength(polyline);
  // 采样间距 = 体素水平尺寸，保证与三维栅格对齐
  const step = (bounds.maxX - bounds.minX) / surfaces.resolution;
  const sampleCount = Math.max(2, Math.ceil(totalLength / step) + 1);

  const samples: SectionResult['samples'] = [];
  for (let i = 0; i < sampleCount; i++) {
    const d = (i / (sampleCount - 1)) * totalLength;
    const { x, y } = pointAtDistance(polyline, d);
    const s = sampleSurfaces(surfaces, x, y);
    samples.push({
      distance: d,
      x,
      y,
      groundElev: Number.isFinite(s.ground) ? s.ground : bounds.maxZ,
      units: s.units,
    });
  }

  // 走廊内钻孔投影
  const boreholeHits: SectionBoreholeHit[] = [];
  for (const bh of boreholes) {
    let best: { distance: number; t: number; segIndex: number; qx: number; qy: number } | null = null;
    let acc = 0;
    for (let i = 1; i < polyline.length; i++) {
      const a = polyline[i - 1];
      const b = polyline[i];
      const segLen = dist(a.x, a.y, b.x, b.y);
      const pr = projectPointToSegment(bh.x, bh.y, a.x, a.y, b.x, b.y);
      if (!best || pr.distance < best.distance) {
        best = { distance: pr.distance, t: pr.t, segIndex: i - 1, qx: pr.qx, qy: pr.qy };
      }
      acc += segLen;
      void acc;
    }
    if (best && best.distance <= opts.corridorWidth) {
      // 里程 = 之前各段长度 + 当前段 t*段长
      let mileage = 0;
      for (let i = 1; i <= best.segIndex; i++) {
        mileage += dist(polyline[i - 1].x, polyline[i - 1].y, polyline[i].x, polyline[i].y);
      }
      const a = polyline[best.segIndex];
      const b = polyline[best.segIndex + 1];
      mileage += best.t * dist(a.x, a.y, b.x, b.y);
      // 带符号左右偏移
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = dist(a.x, a.y, b.x, b.y) || 1;
      const cross = (dx * (bh.y - a.y) - dy * (bh.x - a.x)) / segLen;
      boreholeHits.push({
        boreholeId: bh.id,
        name: bh.name,
        distance: mileage,
        offset: cross,
        groundElev: bh.groundElev,
        layers: bh.layers,
        x: bh.x,
        y: bh.y,
      });
    }
  }
  boreholeHits.sort((a, c) => a.distance - c.distance);

  return {
    polyline,
    totalLength,
    verticalExaggeration: opts.verticalExaggeration,
    samples,
    boreholeHits,
    bounds,
  };
}
