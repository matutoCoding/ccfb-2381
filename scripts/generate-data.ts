// 生成演示 CSV 文件到 public/data/，供页面下载和文档引用
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boreholesToCsv } from '../src/lib/csv.ts';
import { generateDemoData, generateProblemRows } from '../src/lib/demo-data.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/data');
mkdirSync(outDir, { recursive: true });

const demo = generateDemoData(200);
writeFileSync(resolve(outDir, 'demo-boreholes.csv'), boreholesToCsv(demo.boreholes), 'utf8');
writeFileSync(resolve(outDir, 'demo-boreholes-with-issues.csv'), generateProblemRows(), 'utf8');
writeFileSync(
  resolve(outDir, 'demo-lithologies.csv'),
  'lithology_id,name,color_rgb\n' +
    demo.lithologies.map((l) => `${l.id},${l.name},"${l.color.join(',')}"`).join('\n') + '\n',
  'utf8',
);
console.log(`已生成 ${demo.boreholes.length} 个钻孔到 ${outDir}`);
