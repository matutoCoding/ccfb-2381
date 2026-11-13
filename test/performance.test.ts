import { describe, it, expect } from 'vitest';
import { generateDemoData } from '../src/lib/demo-data';
import { buildHorizonSurfaces } from '../src/lib/stratigraphy';
import { classifyVoxelsCpu } from '../src/lib/voxelize-cpu';
import { DEFAULT_PARAMS } from '../src/types';

// 需求基准：200 孔、256³ 网格端到端重算 5 秒内。
// 层位面插值在 CPU 完成（WebGPU 负责体素化），这里度量整个 CPU 管线的耗时预算。
describe('性能基准（200 孔 / 256³）', () => {
  it('层位面 + 体素分类总耗时 < 5000ms', () => {
    const demo = generateDemoData(200);
    const params = { ...DEFAULT_PARAMS, gridSize: 256, surfaceResolution: 96, method: 'idw' as const };
    const t0 = performance.now();
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const t1 = performance.now();
    const vox = classifyVoxelsCpu({ surfaces, gridSize: 256, bounds: surfaces.bounds });
    const t2 = performance.now();
    console.log(`层位面构建: ${(t1 - t0).toFixed(0)} ms, 体素分类: ${(t2 - t1).toFixed(0)} ms, 合计: ${(t2 - t0).toFixed(0)} ms`);
    expect(t2 - t0).toBeLessThan(5000);
    expect(vox.length).toBe(256 ** 3);
    expect(vox.some((v) => v !== 0)).toBe(true);
  }, 30000);

  it('三种插值方法均可完成且无 NaN 残留于有效单元', () => {
    const demo = generateDemoData(200);
    for (const method of ['idw', 'nearest', 'kriging'] as const) {
      const params = { ...DEFAULT_PARAMS, gridSize: 48, surfaceResolution: 32, method };
      const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
      const vox = classifyVoxelsCpu({ surfaces, gridSize: 48, bounds: surfaces.bounds });
      expect(vox.some((v) => v !== 0)).toBe(true);
      // 地表层位面不允许 NaN（所有孔都有孔口标高）
      expect(surfaces.ground.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
