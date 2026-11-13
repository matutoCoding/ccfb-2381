// 合成演示数据：200 个钻孔，含
//  - 一条近南北向正断层（东盘下降 9m，插值时启用断层阻隔）
//  - 粉土层在西侧尖灭
//  - 砂砾石透镜体（仅局部区域出现）
//  - 起伏地表与层位随机扰动（确定性种子，可复现）
import type { Borehole, Fault, Lithology } from '../types';
import { mulberry32 } from './math';
import { boreholesToCsv } from './csv';

export const DEMO_LITHOLOGIES: Lithology[] = [
  { id: 'FILL', name: '素填土', color: [196, 168, 120] },
  { id: 'SILT', name: '粉土', color: [224, 200, 138] },
  { id: 'CLAY', name: '粉质黏土', color: [150, 108, 78] },
  { id: 'GRAVEL', name: '砂砾石', color: [132, 140, 148] },
  { id: 'BEDROCK', name: '强风化泥岩', color: [112, 92, 120] },
];

export const DEMO_FAULT: Fault = { ax: 520, ay: -40, bx: 560, by: 540, throw: 9, downthrowSide: 1 };

const X0 = 0;
const X1 = 1000;
const Y0 = 0;
const Y1 = 500;

/** 断层符号：点在东盘（下降盘）返回 +1 */
function faultSide(x: number, y: number, f: Fault): number {
  const dx = f.bx - f.ax;
  const dy = f.by - f.ay;
  const cross = dx * (y - f.ay) - dy * (x - f.ax);
  return cross >= 0 ? 1 : -1;
}

function groundElev(x: number, y: number): number {
  return 42 + 1.6 * Math.sin(x / 180) + 1.1 * Math.cos(y / 130) + 0.8 * Math.sin((x + y) / 260);
}

/** 各岩层底面深度（自孔口向下，米）的“真值”函数 */
function layerBottomDepths(x: number, y: number, f: Fault, rng: () => number): Record<string, number | null> {
  const side = faultSide(x, y, f);
  const down = side === f.downthrowSide ? f.throw : 0;
  const n = () => (rng() - 0.5) * 1.2; // 层位扰动 ±0.6m
  const regional = 0.006 * x + 0.004 * y; // 区域倾斜

  const fillBottom = 2.2 + 0.5 * Math.sin(y / 150) + n();
  // 粉土在西侧（x<260）尖灭
  const siltBottom = x < 260 ? null : 5.4 + regional + down + 0.6 * Math.cos(x / 200) + n();
  const clayBottom = 11.5 + regional + down + 0.8 * Math.sin((x - y) / 220) + n();
  // 砂砾石透镜体：中心 (700,300)，半径 130，厚度 2.5~5m
  const dl = Math.hypot(x - 700, y - 300);
  const gravelThickness = dl < 130 ? 4.5 * (1 - dl / 130) + 0.6 : 0;
  const gravelBottom = gravelThickness > 0.8 ? clayBottom + gravelThickness + n() * 0.4 : null;
  const bedrockBottom = 26 + regional + down + 1.2 * Math.sin(x / 240) + n();

  return {
    FILL: fillBottom,
    SILT: siltBottom,
    CLAY: clayBottom,
    GRAVEL: gravelBottom,
    BEDROCK: bedrockBottom,
  };
}

export interface DemoData {
  boreholes: Borehole[];
  lithologies: Lithology[];
  fault: Fault;
}

export function generateDemoData(count = 200, seed = 20261113): DemoData {
  const rng = mulberry32(seed);
  const cols = 20;
  const rows = Math.ceil(count / cols);
  const boreholes: Borehole[] = [];
  let idx = 0;
  for (let r = 0; r < rows && boreholes.length < count; r++) {
    for (let c = 0; c < cols && boreholes.length < count; c++) {
      const x = X0 + ((c + 0.5) / cols) * (X1 - X0) + (rng() - 0.5) * 34;
      const y = Y0 + ((r + 0.5) / rows) * (Y1 - Y0) + (rng() - 0.5) * 30;
      const bhRng = mulberry32(seed + idx * 7919 + 17);
      const ground = groundElev(x, y);
      const depths = layerBottomDepths(x, y, DEMO_FAULT, bhRng);
      const sequence: { id: string; bottom: number }[] = [];
      let prev = 0;
      for (const id of ['FILL', 'SILT', 'CLAY', 'GRAVEL', 'BEDROCK']) {
        const bottom = depths[id];
        if (bottom === null || bottom <= prev + 0.3) continue; // 尖灭/透镜体缺失
        sequence.push({ id, bottom });
        prev = bottom;
      }
      const layers = sequence.map((s, i) => ({
        lithologyId: s.id,
        fromDepth: i === 0 ? 0 : sequence[i - 1].bottom,
        toDepth: s.bottom,
      }));
      idx++;
      boreholes.push({
        id: `BH${String(idx).padStart(3, '0')}`,
        name: `ZK${String(idx).padStart(3, '0')}`,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        groundElev: Number(ground.toFixed(2)),
        layers,
      });
    }
  }
  return { boreholes, lithologies: DEMO_LITHOLOGIES, fault: DEMO_FAULT };
}

/** 额外造一批带问题的数据用于校验演示：重复坐标 + 层序倒挂 + 未知岩性 */
export function generateProblemRows(): string {
  const good = generateDemoData(6).boreholes;
  const rows = boreholesToCsv(good).trim().split('\n');
  const dup = good[0];
  rows.push(`DUP01,重复孔,${dup.x},${dup.y},40,CLAY,0,5`);
  rows.push(`BAD01,倒挂孔,100,100,41,FILL,0,3`);
  rows.push(`BAD01,倒挂孔,100,100,41,CLAY,4,3.5`);
  rows.push(`UNK01,未知岩性孔,200,200,39,UNKNOWN_ROCK,0,4`);
  return rows.join('\n') + '\n';
}
