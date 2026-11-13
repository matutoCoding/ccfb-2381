import { describe, it, expect } from 'vitest';
import { validateBoreholes } from '../src/lib/validation';
import type { Borehole } from '../src/types';

function bh(partial: Partial<Borehole> & Pick<Borehole, 'id' | 'x' | 'y'>): Borehole {
  return {
    name: partial.id,
    groundElev: 40,
    layers: [],
    ...partial,
  } as Borehole;
}

const layer = (lithologyId: string, fromDepth: number, toDepth: number) => ({ lithologyId, fromDepth, toDepth });

describe('钻孔校验', () => {
  const known = new Set(['FILL', 'CLAY']);

  it('检出坐标重复', () => {
    const report = validateBoreholes([
      bh({ id: 'A', x: 1, y: 2, layers: [layer('FILL', 0, 2)] }),
      bh({ id: 'B', x: 1, y: 2, layers: [layer('FILL', 0, 2)] }),
    ], known);
    expect(report.issues.some((i) => i.code === 'duplicate_xy')).toBe(true);
    expect(report.errorBoreholeIds.sort()).toEqual(['A', 'B']);
  });

  it('检出深度倒挂与重叠', () => {
    const report = validateBoreholes([
      bh({ id: 'A', x: 0, y: 0, layers: [layer('FILL', 3, 2), layer('CLAY', 1.5, 5)] }),
    ], known);
    expect(report.issues.some((i) => i.code === 'depth_inversion')).toBe(true);
    expect(report.issues.some((i) => i.code === 'layer_overlap')).toBe(true);
  });

  it('检出层间空隙（警告）', () => {
    const report = validateBoreholes([
      bh({ id: 'A', x: 0, y: 0, layers: [layer('FILL', 0, 2), layer('CLAY', 3, 6)] }),
    ], known);
    const gap = report.issues.find((i) => i.code === 'layer_gap');
    expect(gap?.level).toBe('warning');
  });

  it('检出未知岩性与空孔', () => {
    const report = validateBoreholes([
      bh({ id: 'A', x: 0, y: 0, layers: [layer('MYSTERY', 0, 2)] }),
      bh({ id: 'B', x: 9, y: 9, layers: [] }),
    ], known);
    expect(report.issues.some((i) => i.code === 'unknown_lithology')).toBe(true);
    expect(report.issues.some((i) => i.code === 'empty_borehole')).toBe(true);
  });

  it('正常数据无问题', () => {
    const report = validateBoreholes([
      bh({ id: 'A', x: 0, y: 0, layers: [layer('FILL', 0, 2), layer('CLAY', 2, 8)] }),
      bh({ id: 'B', x: 50, y: 50, layers: [layer('FILL', 0, 1.5), layer('CLAY', 1.5, 7)] }),
    ], known);
    expect(report.issues).toEqual([]);
  });
});
