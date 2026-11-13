import { describe, it, expect } from 'vitest';
import { buildHorizonSurfaces, inferUnitOrder, sampleSurfaces } from '../src/lib/stratigraphy';
import { classifyVoxelsCpu } from '../src/lib/voxelize-cpu';
import { generateDemoData } from '../src/lib/demo-data';
import { DEFAULT_PARAMS, type Borehole } from '../src/types';

const params = { ...DEFAULT_PARAMS, gridSize: 64, surfaceResolution: 48 };

describe('地层层序与层位面（演示数据）', () => {
  const demo = generateDemoData(200);

  it('层序自上而下：填土→粉土→黏土→砂砾石→基岩（相对顺序）', () => {
    const order = inferUnitOrder(demo.boreholes);
    expect(order.indexOf('FILL')).toBeLessThan(order.indexOf('CLAY'));
    expect(order.indexOf('CLAY')).toBeLessThan(order.indexOf('BEDROCK'));
    // 透镜体砂砾石位于黏土与基岩之间
    expect(order.indexOf('GRAVEL')).toBeGreaterThan(order.indexOf('CLAY'));
    expect(order.indexOf('GRAVEL')).toBeLessThan(order.indexOf('BEDROCK'));
  });

  it('尖灭：粉土在西侧网格缺失', () => {
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const siltIdx = surfaces.unitIndex.indexOf('SILT');
    const S = surfaces.resolution;
    // 行优先索引 i + j*S：统计西侧第一列（i=0）的尖灭网格
    let nanCount = 0;
    for (let j = 0; j < S; j++) if (Number.isNaN(surfaces.top[siltIdx][0 + j * S])) nanCount++;
    expect(nanCount).toBeGreaterThan(S * 0.6);
    // 西侧 1/4 区域整体以尖灭为主
    let westNaN = 0;
    let westTotal = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S / 4; i++) {
      westTotal++;
      if (Number.isNaN(surfaces.top[siltIdx][i + j * S])) westNaN++;
    }
    expect(westNaN / westTotal).toBeGreaterThan(0.8);
  });

  it('透镜体：砂砾石仅在局部区域存在', () => {
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const g = surfaces.unitIndex.indexOf('GRAVEL');
    const finite = surfaces.top[g].filter((v) => Number.isFinite(v)).length;
    const ratio = finite / (surfaces.resolution ** 2);
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.6);
  });

  it('防插穿：每个网格单元内地层顶底顺序严格、不交叉', () => {
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const S = surfaces.resolution;
    let violations = 0;
    for (let k = 0; k < S * S; k++) {
      let ceiling = Infinity;
      for (let u = 0; u < surfaces.unitIndex.length; u++) {
        if (Number.isNaN(surfaces.top[u][k])) continue;
        if (!(surfaces.top[u][k] > surfaces.bottom[u][k])) violations++;
        if (surfaces.top[u][k] >= ceiling) violations++;
        ceiling = surfaces.bottom[u][k];
      }
    }
    expect(violations).toBe(0);
  });

  it('采样函数在透镜体外返回缺失层、在透镜体内返回完整柱', () => {
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const inside = sampleSurfaces(surfaces, 700, 300);
    const outside = sampleSurfaces(surfaces, 120, 120);
    expect(inside.units.some((u) => u.lithologyId === 'GRAVEL')).toBe(true);
    expect(outside.units.some((u) => u.lithologyId === 'GRAVEL')).toBe(false);
    // 任意采样柱内部同样不允许顺序矛盾
    for (const s of [inside, outside]) {
      for (let i = 1; i < s.units.length; i++) {
        expect(s.units[i].top).toBeLessThanOrEqual(s.units[i - 1].bottom + 0.02);
      }
    }
  });
});

describe('CPU 体素分类', () => {
  it('体素编码与层位一致：任意非空体素必落在某层顶底之间', () => {
    const demo = generateDemoData(200);
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const N = params.gridSize;
    const vox = classifyVoxelsCpu({ surfaces, gridSize: N, bounds: surfaces.bounds });
    expect(vox.length).toBe(N ** 3);
    let nonEmpty = 0;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        for (let iz = 0; iz < N; iz++) {
          const code = vox[ix + iy * N + iz * N * N];
          if (code === 0) continue;
          nonEmpty++;
          const S = surfaces.resolution;
          const ci = Math.min(S - 1, Math.floor((ix + 0.5) / N * S));
          const cj = Math.min(S - 1, Math.floor((iy + 0.5) / N * S));
          const cell = ci + cj * S;
          const u = code - 1;
          const wz = surfaces.bounds.minZ + ((iz + 0.5) / N) * (surfaces.bounds.maxZ - surfaces.bounds.minZ);
          expect(wz).toBeGreaterThanOrEqual(surfaces.bottom[u][cell] - 1e-6);
          expect(wz).toBeLessThanOrEqual(surfaces.top[u][cell] + 1e-6);
        }
      }
    }
    expect(nonEmpty).toBeGreaterThan(N ** 3 * 0.1);
  });

  it('分类器是确定性的（同输入两次结果一致）', () => {
    const demo = generateDemoData(200);
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, params, undefined, demo.fault);
    const a = classifyVoxelsCpu({ surfaces, gridSize: 32, bounds: surfaces.bounds });
    const b = classifyVoxelsCpu({ surfaces, gridSize: 32, bounds: surfaces.bounds });
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });

  it('简单水平地层：各层体素数量沿深度呈带状分布', () => {
    const boreholes: Borehole[] = [];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        boreholes.push({
          id: `B${x}-${y}`, name: `B${x}-${y}`, x: x * 25, y: y * 25, groundElev: 50,
          layers: [
            { lithologyId: 'A', fromDepth: 0, toDepth: 5 },
            { lithologyId: 'B', fromDepth: 5, toDepth: 12 },
          ],
        });
      }
    }
    const p = { ...DEFAULT_PARAMS, gridSize: 32, surfaceResolution: 24, pinchTolerance: 0.1 };
    const { surfaces } = buildHorizonSurfaces(boreholes, p);
    const vox = classifyVoxelsCpu({ surfaces, gridSize: 32, bounds: surfaces.bounds });
    const counts = [0, 0, 0];
    for (const v of vox) counts[v]++;
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(0);
    // B 层（7m）厚于 A 层（5m）
    expect(counts[2]).toBeGreaterThan(counts[1]);
  });
});
