import { describe, it, expect } from 'vitest';
import { buildSection, polylineLength, pointAtDistance } from '../src/lib/section';
import { buildHorizonSurfaces, sampleSurfaces } from '../src/lib/stratigraphy';
import { generateDemoData } from '../src/lib/demo-data';
import { DEFAULT_PARAMS } from '../src/types';

describe('剖面几何', () => {
  it('折线长度与里程插值', () => {
    const line = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
    expect(polylineLength(line)).toBeCloseTo(70, 6);
    expect(pointAtDistance(line, 30)).toEqual({ x: 30, y: 0 });
    const mid = pointAtDistance(line, 50);
    expect(mid.x).toBeCloseTo(30);
    expect(mid.y).toBeCloseTo(20);
  });

  it('剖面采样数与长度匹配，地层柱顺序正确', () => {
    const demo = generateDemoData(200);
    const p = { ...DEFAULT_PARAMS, gridSize: 64, surfaceResolution: 48 };
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, p, undefined, demo.fault);
    const b = surfaces.bounds;
    const line = [
      { x: b.minX + 30, y: (b.minY + b.maxY) / 2 },
      { x: b.maxX - 30, y: (b.minY + b.maxY) / 2 },
    ];
    const sec = buildSection(line, surfaces, demo.boreholes, b, { verticalExaggeration: 2, corridorWidth: 30 });
    expect(sec.samples.length).toBeGreaterThan(30);
    expect(sec.totalLength).toBeCloseTo(b.maxX - b.minX - 60, 0);
    for (const s of sec.samples) {
      for (let i = 1; i < s.units.length; i++) {
        expect(s.units[i].top).toBeLessThanOrEqual(s.units[i - 1].bottom + 0.02);
        expect(s.units[i].bottom).toBeLessThan(s.units[i].top);
      }
    }
  });

  it('走廊内钻孔被投影且里程单调、带左右偏移', () => {
    const demo = generateDemoData(200);
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, { ...DEFAULT_PARAMS, surfaceResolution: 48 }, undefined, demo.fault);
    const b = surfaces.bounds;
    const line = [{ x: b.minX, y: (b.minY + b.maxY) / 2 }, { x: b.maxX, y: (b.minY + b.maxY) / 2 }];
    const sec = buildSection(line, surfaces, demo.boreholes, b, { verticalExaggeration: 1, corridorWidth: 28 });
    expect(sec.boreholeHits.length).toBeGreaterThan(5);
    const d = sec.boreholeHits.map((h) => h.distance);
    expect(d.every((v, i) => i === 0 || v >= d[i - 1])).toBe(true);
    expect(sec.boreholeHits.some((h) => Math.abs(h.offset) > 0.1)).toBe(true);
  });

  it('剖面与层位面在同一坐标处取值一致（三维/剖面对得上）', () => {
    const demo = generateDemoData(200);
    const { surfaces } = buildHorizonSurfaces(demo.boreholes, { ...DEFAULT_PARAMS, surfaceResolution: 48 }, undefined, demo.fault);
    const b = surfaces.bounds;
    const x = (b.minX + b.maxX) / 2;
    const y = (b.minY + b.maxY) / 2;
    const line = [{ x: b.minX, y }, { x: b.maxX, y }];
    const sec = buildSection(line, surfaces, demo.boreholes, b, { verticalExaggeration: 1, corridorWidth: 5 });
    const direct = sampleSurfaces(surfaces, x, y);
    const sample = sec.samples.reduce((best, s) =>
      Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best);
    expect(sample.units.map((u) => u.lithologyId)).toEqual(direct.units.map((u) => u.lithologyId));
    for (let i = 0; i < direct.units.length; i++) {
      expect(sample.units[i].top).toBeCloseTo(direct.units[i].top, 6);
      expect(sample.units[i].bottom).toBeCloseTo(direct.units[i].bottom, 6);
    }
  });
});
