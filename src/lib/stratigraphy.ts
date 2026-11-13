// 地层层序推断与层位顶/底面构建
// 关键约束（对应需求 7：透镜体和尖灭层别插穿）：
//  - 层序按各岩性在钻孔中出现深度的中位数全局排序；
//  - 每个层位用“存在指示值 + 顶/底标高”三组散点分别插值，指示值低于阈值处尖灭（NaN）；
//  - 逐网格单元自上而下做顺序钳制：顶不超过上一层底，厚度小于尖灭容差则该单元尖灭，
//    透镜体（中间层局部缺失）时上下层自动贴合，杜绝插穿。
import type { Borehole, Fault, HorizonSurfaces, ModelBounds, ModelParams } from '../types';
import { interpolateGrid, type GridContext, type ScatterSample } from './interpolation';

const ORDER_EPS = 0.01; // 层间最小间距（米），防止共面闪烁

/** 全局地层层序（自上而下）：按出现深度的中位数排序 */
export function inferUnitOrder(boreholes: Borehole[]): string[] {
  const depths = new Map<string, number[]>();
  for (const b of boreholes) {
    for (const l of b.layers) {
      const mid = (l.fromDepth + l.toDepth) / 2;
      const arr = depths.get(l.lithologyId);
      if (arr) arr.push(mid);
      else depths.set(l.lithologyId, [mid]);
    }
  }
  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, c) => a - c);
    return s[Math.floor(s.length / 2)];
  };
  return [...depths.keys()].sort((a, c) => median(depths.get(a)!) - median(depths.get(c)!));
}

export function computeBounds(boreholes: Borehole[], params: ModelParams): ModelBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxElev = -Infinity;
  let minDepthElev = Infinity;
  for (const b of boreholes) {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
    maxElev = Math.max(maxElev, b.groundElev);
    for (const l of b.layers) {
      minDepthElev = Math.min(minDepthElev, b.groundElev - l.toDepth);
    }
  }
  const padXY = Math.max((maxX - minX), (maxY - minY)) * 0.02 + 1;
  return {
    minX: minX - padXY,
    maxX: maxX + padXY,
    minY: minY - padXY,
    maxY: maxY + padXY,
    minZ: minDepthElev - params.baseDepthBelowMin,
    maxZ: maxElev + params.topBuffer,
  };
}

/** 钻孔某岩性的顶/底标高（同一孔多次出现时合并取最浅顶、最深底） */
function boreholeUnitElevations(
  b: Borehole,
  unitId: string,
): { present: boolean; top: number; bottom: number } {
  let top = -Infinity;
  let bottom = Infinity;
  let present = false;
  for (const l of b.layers) {
    if (l.lithologyId !== unitId) continue;
    present = true;
    top = Math.max(top, b.groundElev - l.fromDepth);
    bottom = Math.min(bottom, b.groundElev - l.toDepth);
  }
  return { present, top, bottom };
}

export interface BuildSurfacesResult {
  surfaces: HorizonSurfaces;
  /** 每个层位在多少个孔中出现（供 UI 显示透镜体/尖灭信息） */
  presenceCounts: Record<string, number>;
}

/** 构建全部层位面 */
export function buildHorizonSurfaces(
  boreholes: Borehole[],
  params: ModelParams,
  bounds?: ModelBounds,
  fault?: Fault | null,
): BuildSurfacesResult {
  const bds = bounds ?? computeBounds(boreholes, params);
  const unitIndex = inferUnitOrder(boreholes);
  const S = params.surfaceResolution;
  const ctx: GridContext = {
    resolution: S,
    minX: bds.minX,
    maxX: bds.maxX,
    minY: bds.minY,
    maxY: bds.maxY,
    barrier: fault ? { ax: fault.ax, ay: fault.ay, bx: fault.bx, by: fault.by } : undefined,
  };

  // 地表标高（所有孔都参与）
  const groundSamples: ScatterSample[] = boreholes.map((b) => ({
    x: b.x,
    y: b.y,
    value: b.groundElev,
  }));
  const ground = interpolateGrid(groundSamples, ctx, params);

  const top: Float64Array[] = [];
  const bottom: Float64Array[] = [];
  const presenceCounts: Record<string, number> = {};
  const presenceThreshold = 0.5;
  // 样本控制半径：取场区短边的 12%，超出该距离的网格按尖灭/缺失处理，避免无限外推
  const controlRadius = Math.min(bds.maxX - bds.minX, bds.maxY - bds.minY) * 0.12;

  for (const unitId of unitIndex) {
    const topSamples: ScatterSample[] = [];
    const botSamples: ScatterSample[] = [];
    const indSamples: ScatterSample[] = [];
    let count = 0;
    for (const b of boreholes) {
      const e = boreholeUnitElevations(b, unitId);
      indSamples.push({ x: b.x, y: b.y, value: e.present ? 1 : 0 });
      if (e.present) {
        count++;
        topSamples.push({ x: b.x, y: b.y, value: e.top });
        botSamples.push({ x: b.x, y: b.y, value: e.bottom });
      }
    }
    presenceCounts[unitId] = count;

    // 指示场（存在/缺失）是类别变量，用最近邻判定，避免 IDW 平滑把尖灭边界“糊”过去
    const indicatorParams = { ...params, method: 'nearest' as const };
    const indicator = interpolateGrid(indSamples, ctx, indicatorParams, controlRadius * 2.2);
    const topGrid = interpolateGrid(topSamples, ctx, params, controlRadius);
    const botGrid = interpolateGrid(botSamples, ctx, params, controlRadius);
    for (let k = 0; k < S * S; k++) {
      // 指示值低于阈值或超出样本凸包趋势 → 尖灭
      if (!Number.isFinite(indicator[k]) || indicator[k] < presenceThreshold) {
        topGrid[k] = NaN;
        botGrid[k] = NaN;
      }
    }
    top.push(topGrid);
    bottom.push(botGrid);
  }

  // 逐单元顺序钳制，防插穿
  for (let k = 0; k < S * S; k++) {
    let ceiling = ground[k] + ORDER_EPS;
    for (let u = 0; u < unitIndex.length; u++) {
      if (!Number.isFinite(top[u][k])) continue; // 该单元在此网格尖灭/透镜体缺失
      // 顶层不允许穿出地表
      let t = Math.min(top[u][k], ceiling - ORDER_EPS);
      let btm = Math.min(bottom[u][k], t - ORDER_EPS);
      if (t - btm < params.pinchTolerance) {
        // 被上下层挤压到小于容差 → 尖灭
        top[u][k] = NaN;
        bottom[u][k] = NaN;
        continue;
      }
      top[u][k] = t;
      bottom[u][k] = btm;
      ceiling = btm;
    }
  }

  return {
    surfaces: { unitIndex, top, bottom, resolution: S, bounds: bds, ground },
    presenceCounts,
  };
}

/** 在层位面网格上双线性采样；返回 NaN 表示该位置此层位尖灭 */
export function sampleSurfaces(surfaces: HorizonSurfaces, x: number, y: number): {
  ground: number;
  units: { lithologyId: string; top: number; bottom: number }[];
} {
  const { resolution: S, bounds } = surfaces;
  const fx = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * S - 0.5;
  const fy = ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * S - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const sample = (grid: Float64Array): number => {
    // 任一角点尖灭即视为尖灭（地质界线不跨尖灭区插值）
    const vals: number[] = [];
    for (const [dj, di] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= S - 1 || j >= S - 1) return NaN;
      const v = grid[i + j * S];
      if (!Number.isFinite(v)) return NaN;
      vals.push(v);
    }
    const w = [
      (1 - tx) * (1 - ty),
      tx * (1 - ty),
      (1 - tx) * ty,
      tx * ty,
    ];
    return vals[0] * w[0] + vals[1] * w[1] + vals[2] * w[2] + vals[3] * w[3];
  };

  const units: { lithologyId: string; top: number; bottom: number }[] = [];
  for (let u = 0; u < surfaces.unitIndex.length; u++) {
    const t = sample(surfaces.top[u]);
    const b = sample(surfaces.bottom[u]);
    if (Number.isFinite(t) && Number.isFinite(b) && t > b) {
      units.push({ lithologyId: surfaces.unitIndex[u], top: t, bottom: b });
    }
  }
  return { ground: sample(surfaces.ground), units };
}
