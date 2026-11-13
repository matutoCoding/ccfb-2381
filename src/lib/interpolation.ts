// 二维散点 -> 规则网格插值：IDW、最近邻、普通克里金（球状变差）
// 采样点可带 NaN 值（表示该孔在此层位尖灭/缺失），NaN 不参与插值。
import { solveLinear } from './math';
import type { InterpMethod, ModelParams } from '../types';

export interface ScatterSample {
  x: number;
  y: number;
  value: number; // NaN = 缺失
}

export interface GridContext {
  resolution: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 可选断层阻隔线（两端点），线两侧的样本不互相参与插值 */
  barrier?: { ax: number; ay: number; bx: number; by: number };
}

/** 网格单元中心坐标 */
export function gridCellCenter(ctx: GridContext, i: number, j: number): { x: number; y: number } {
  const sx = (ctx.maxX - ctx.minX) / ctx.resolution;
  const sy = (ctx.maxY - ctx.minY) / ctx.resolution;
  return { x: ctx.minX + (i + 0.5) * sx, y: ctx.minY + (j + 0.5) * sy };
}

/** 两线段是否相交（含共线重叠） */
function segmentsIntersect(
  p1x: number, p1y: number, p2x: number, p2y: number,
  p3x: number, p3y: number, p4x: number, p4y: number,
): boolean {
  const d = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = d(p3x, p3y, p4x, p4y, p1x, p1y);
  const d2 = d(p3x, p3y, p4x, p4y, p2x, p2y);
  const d3 = d(p1x, p1y, p2x, p2y, p3x, p3y);
  const d4 = d(p1x, p1y, p2x, p2y, p4x, p4y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function kNearest(
  samples: ScatterSample[],
  x: number,
  y: number,
  k: number,
  barrier?: GridContext['barrier'],
): { s: ScatterSample; d2: number }[] {
  const arr: { s: ScatterSample; d2: number }[] = [];
  for (const s of samples) {
    if (barrier && segmentsIntersect(x, y, s.x, s.y, barrier.ax, barrier.ay, barrier.bx, barrier.by)) continue;
    const dx = s.x - x;
    const dy = s.y - y;
    arr.push({ s, d2: dx * dx + dy * dy });
  }
  arr.sort((a, b) => a.d2 - b.d2);
  // 全部被断层阻隔时退化为不使用阻隔，保证断层线附近仍有值
  if (arr.length === 0 && barrier) return kNearest(samples, x, y, k, undefined);
  return arr.slice(0, k);
}

function interpIdw(samples: ScatterSample[], x: number, y: number, power: number, k: number, barrier?: GridContext['barrier']): number {
  const near = kNearest(samples, x, y, k, barrier);
  let weighted = 0;
  let wsum = 0;
  for (const { s, d2 } of near) {
    if (d2 === 0) return s.value;
    const w = 1 / Math.pow(d2, power / 2);
    weighted += w * s.value;
    wsum += w;
  }
  return weighted / wsum;
}

function interpNearest(samples: ScatterSample[], x: number, y: number): number {
  let best: ScatterSample | null = null;
  let bestD = Infinity;
  for (const s of samples) {
    const dx = s.x - x;
    const dy = s.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best!.value;
}

/** 球状变差函数 */
function sphericalVariogram(h: number, range: number, sill: number, nugget = 0): number {
  if (h === 0) return 0;
  if (h >= range) return sill;
  return nugget + (sill - nugget) * (1.5 * (h / range) - 0.5 * (h / range) ** 3);
}

/**
 * 普通克里金：对每个网格点，取最近 k 个样本解 (k+1) 阶克里金方程组。
 * 方程组奇异时回退 IDW。
 */
function interpKriging(
  samples: ScatterSample[],
  x: number,
  y: number,
  k: number,
  range: number,
  sill: number,
  barrier?: GridContext['barrier'],
): number {
  const near = kNearest(samples, x, y, k, barrier);
  const n = near.length;
  const A = new Float64Array((n + 1) * (n + 1));
  const b = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = near[i].s.x - near[j].s.x;
      const dy = near[i].s.y - near[j].s.y;
      A[i * (n + 1) + j] = sphericalVariogram(Math.hypot(dx, dy), range, sill);
    }
    A[i * (n + 1) + n] = 1;
    A[n * (n + 1) + i] = 1;
    const dxp = near[i].s.x - x;
    const dyp = near[i].s.y - y;
    b[i] = sphericalVariogram(Math.hypot(dxp, dyp), range, sill);
  }
  A[(n + 1) * (n + 1) - 1] = 0;
  b[n] = 1;
  const w = solveLinear(A, b, n + 1);
  if (!w) return interpIdw(samples, x, y, 2, k, barrier);
  let est = 0;
  for (let i = 0; i < n; i++) est += w[i] * near[i].s.value;
  return est;
}

/**
 * 散点插值到完整 S×S 网格（行优先，索引 i + j*S）。
 * 有效样本为 0 时返回全 NaN；仅 1 个时返回常量场。
 * maxNeighborDistance：最邻近样本超过该距离（米）的网格单元输出 NaN（用于尖灭外推控制）。
 */
export function interpolateGrid(
  rawSamples: ScatterSample[],
  ctx: GridContext,
  params: ModelParams,
  maxNeighborDistance = Infinity,
): Float64Array {
  const samples = rawSamples.filter((s) => Number.isFinite(s.value));
  const S = ctx.resolution;
  const out = new Float64Array(S * S).fill(NaN);
  if (samples.length === 0) return out;
  if (samples.length === 1) {
    out.fill(samples[0].value);
    return out;
  }
  const k = Math.min(params.idwNeighbors, samples.length);
  const maxD2 = maxNeighborDistance * maxNeighborDistance;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const { x, y } = gridCellCenter(ctx, i, j);
      const nearest = kNearest(samples, x, y, 1, ctx.barrier);
      if (nearest[0].d2 > maxD2) continue; // 超出样本控制范围 → 缺失
      switch (params.method) {
        case 'nearest':
          out[i + j * S] = interpNearest(samples, x, y);
          break;
        case 'kriging':
          out[i + j * S] = interpKriging(samples, x, y, k, params.krigingRange, params.krigingSill, ctx.barrier);
          break;
        case 'idw':
        default:
          out[i + j * S] = interpIdw(samples, x, y, params.idwPower, k, ctx.barrier);
      }
    }
  }
  return out;
}

export const METHOD_LABELS: Record<InterpMethod, string> = {
  idw: '反距离加权 (IDW)',
  kriging: '普通克里金（球状变差）',
  nearest: '最近邻（泰森多边形）',
};
