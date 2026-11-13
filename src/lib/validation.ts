// 钻孔数据校验：坐标重复、层序矛盾（深度倒挂/重叠/空隙）、未知岩性、空孔
import type { Borehole, BoreholeIssue, ValidationReport } from '../types';

export function validateBoreholes(boreholes: Borehole[], knownLithologyIds: Set<string>): ValidationReport {
  const issues: BoreholeIssue[] = [];
  const push = (b: Borehole, level: BoreholeIssue['level'], code: BoreholeIssue['code'], message: string) =>
    issues.push({ boreholeId: b.id, boreholeName: b.name, level, code, message });

  // 1) 坐标重复
  const xyGroups = new Map<string, Borehole[]>();
  for (const b of boreholes) {
    const key = `${b.x.toFixed(3)}|${b.y.toFixed(3)}`;
    const g = xyGroups.get(key);
    if (g) g.push(b);
    else xyGroups.set(key, [b]);
  }
  for (const g of xyGroups.values()) {
    if (g.length > 1) {
      for (const b of g) {
        push(b, 'error', 'duplicate_xy', `坐标 (${b.x}, ${b.y}) 与 ${g.filter((o) => o.id !== b.id).map((o) => o.name).join('、')} 重复`);
      }
    }
  }

  // 2) 单孔层序
  for (const b of boreholes) {
    if (b.layers.length === 0) {
      push(b, 'warning', 'empty_borehole', '钻孔无分层数据');
      continue;
    }
    let prevTo = 0;
    for (let i = 0; i < b.layers.length; i++) {
      const l = b.layers[i];
      if (!knownLithologyIds.has(l.lithologyId)) {
        push(b, 'error', 'unknown_lithology', `第 ${i + 1} 层岩性 "${l.lithologyId}" 不在岩性表中`);
      }
      if (l.toDepth <= l.fromDepth) {
        push(b, 'error', 'depth_inversion', `第 ${i + 1} 层深度倒挂: 顶 ${l.fromDepth}m ≥ 底 ${l.toDepth}m`);
      }
      if (i > 0) {
        const gap = l.fromDepth - prevTo;
        if (gap > 0.05) {
          push(b, 'warning', 'layer_gap', `第 ${i} 层与第 ${i + 1} 层之间存在 ${gap.toFixed(2)}m 空隙`);
        } else if (gap < -0.05) {
          push(b, 'error', 'layer_overlap', `第 ${i} 层与第 ${i + 1} 层重叠 ${Math.abs(gap).toFixed(2)}m`);
        }
      }
      prevTo = l.toDepth;
    }
  }

  const errorBoreholeIds = [...new Set(issues.filter((i) => i.level === 'error').map((i) => i.boreholeId))];
  return { issues, errorBoreholeIds };
}
