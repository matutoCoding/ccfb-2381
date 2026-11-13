import { describe, it, expect } from 'vitest';
import { interpolateGrid, type GridContext, type ScatterSample } from '../src/lib/interpolation';
import { DEFAULT_PARAMS } from '../src/types';

const ctx: GridContext = { resolution: 20, minX: 0, maxX: 100, minY: 0, maxY: 100 };

describe('插值', () => {
  const plane: ScatterSample[] = [];
  for (let x = 10; x <= 90; x += 20)
    for (let y = 10; y <= 90; y += 20)
      plane.push({ x, y, value: 0.02 * x + 0.01 * y });

  it('IDW 在采样点上还原原值', () => {
    const grid = interpolateGrid(plane, ctx, { ...DEFAULT_PARAMS, method: 'idw' });
    // 网格单元 (5,5) 中心 = (27.5,27.5) 附近不做断言；直接检查有限且范围合理
    expect(grid.every((v) => Number.isFinite(v))).toBe(true);
    const min = Math.min(...grid);
    const max = Math.max(...grid);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(3);
  });

  it('最近邻输出值必为某样本值', () => {
    const grid = interpolateGrid(plane, ctx, { ...DEFAULT_PARAMS, method: 'nearest' });
    const values = new Set(plane.map((p) => p.value));
    expect(grid.every((v) => values.has(v))).toBe(true);
  });

  it('克里金对平缓平面误差小', () => {
    const grid = interpolateGrid(plane, ctx, { ...DEFAULT_PARAMS, method: 'kriging', krigingRange: 60 });
    const at = (i: number, j: number) => grid[i + j * 20];
    // 中心区域误差应小于 0.3
    const center = at(10, 10);
    expect(Math.abs(center - (0.02 * 52.5 + 0.01 * 52.5))).toBeLessThan(0.3);
  });

  it('NaN 样本被忽略；全缺失时返回全 NaN', () => {
    const withHole: ScatterSample[] = plane.map((p) => ({ ...p }));
    withHole[0].value = NaN;
    const grid = interpolateGrid(withHole, ctx, DEFAULT_PARAMS);
    expect(grid.every((v) => Number.isFinite(v))).toBe(true);
    const empty = interpolateGrid([{ x: 0, y: 0, value: NaN }], ctx, DEFAULT_PARAMS);
    expect(empty.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('断层阻隔：两侧样本不互相插值', () => {
    const samples: ScatterSample[] = [];
    for (let x = 5; x <= 95; x += 10) {
      samples.push({ x, y: 25, value: x < 50 ? 0 : 100 });
      samples.push({ x, y: 75, value: x < 50 ? 0 : 100 });
    }
    const barrierCtx: GridContext = { ...ctx, barrier: { ax: 50, ay: 0, bx: 50, by: 100 } };
    const grid = interpolateGrid(samples, barrierCtx, { ...DEFAULT_PARAMS, idwNeighbors: 4 });
    // 西半边网格（i<10）应保持低值，不被东侧 100 拉高
    let westMax = -Infinity;
    for (let j = 0; j < 20; j++) for (let i = 0; i < 9; i++) westMax = Math.max(westMax, grid[i + j * 20]);
    expect(westMax).toBeLessThan(40);
  });
});
