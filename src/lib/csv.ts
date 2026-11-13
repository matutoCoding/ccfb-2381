// 钻孔 CSV 解析
// 支持两种文件：
//  1) 钻孔表头（推荐，单文件）：borehole_id,name,x,y,ground_elev,lithology_id,from_depth,to_depth
//     每个钻孔多行，每行一个分层
//  2) 仅分层行（在界面上已选定/导入岩性表时使用），列同上
// 兼容中文列名。带引号转义、# 注释行、UTF-8 BOM。

export interface ParsedCsvRow {
  [column: string]: string;
}

const HEADER_ALIASES: Record<string, string> = {
  borehole_id: 'borehole_id',
  hole_id: 'borehole_id',
  钻孔编号: 'borehole_id',
  孔号: 'borehole_id',
  id: 'borehole_id',
  name: 'name',
  钻孔名称: 'name',
  x: 'x',
  x坐标: 'x',
  坐标x: 'x',
  y: 'y',
  y坐标: 'y',
  坐标y: 'y',
  ground_elev: 'ground_elev',
  elev: 'ground_elev',
  孔口标高: 'ground_elev',
  标高: 'ground_elev',
  lithology_id: 'lithology_id',
  layer_id: 'lithology_id',
  岩性编号: 'lithology_id',
  岩性: 'lithology_id',
  from_depth: 'from_depth',
  top_depth: 'from_depth',
  层顶深度: 'from_depth',
  起始深度: 'from_depth',
  to_depth: 'to_depth',
  bottom_depth: 'to_depth',
  层底深度: 'to_depth',
  终止深度: 'to_depth',
};

/** 解析 CSV 文本为对象数组（首行表头） */
export function parseCsv(text: string): ParsedCsvRow[] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];

  const rawHeader = rows[0].map((h) => h.trim());
  const header = rawHeader.map((h) => HEADER_ALIASES[h.toLowerCase()] ?? HEADER_ALIASES[h] ?? h);
  const out: ParsedCsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const obj: ParsedCsvRow = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = (cells[c] ?? '').trim();
    out.push(obj);
  }
  return out;
}

export interface CsvBoreholeInput {
  id: string;
  name: string;
  x: number;
  y: number;
  groundElev: number;
  layers: { lithologyId: string; fromDepth: number; toDepth: number }[];
}

export interface CsvImportResult {
  boreholes: CsvBoreholeInput[];
  errors: string[];
}

const REQUIRED = ['borehole_id', 'x', 'y', 'ground_elev', 'lithology_id', 'from_depth', 'to_depth'];

/** 将 CSV 对象数组转换为钻孔输入（不做地质规则校验，只做格式校验） */
export function parseBoreholeCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) return { boreholes: [], errors: ['CSV 为空或缺少表头'] };
  const missing = REQUIRED.filter((col) => !(col in rows[0]));
  if (missing.length > 0) {
    return { boreholes: [], errors: [`缺少必需列: ${missing.join(', ')}`] };
  }

  const map = new Map<string, CsvBoreholeInput>();
  rows.forEach((row, idx) => {
    const lineNo = idx + 2;
    const id = row.borehole_id || `BH_${lineNo}`;
    const num = (s: string | undefined, label: string): number | null => {
      const v = Number((s ?? '').trim());
      if (!Number.isFinite(v)) {
        errors.push(`第 ${lineNo} 行 ${label} 不是有效数字: "${s ?? ''}"`);
        return null;
      }
      return v;
    };
    const x = num(row.x, 'x');
    const y = num(row.y, 'y');
    const elev = num(row.ground_elev, 'ground_elev');
    const from = num(row.from_depth, 'from_depth');
    const to = num(row.to_depth, 'to_depth');
    if ([x, y, elev, from, to].some((v) => v === null)) return;
    const lithologyId = row.lithology_id;
    if (!lithologyId) {
      errors.push(`第 ${lineNo} 行缺少 lithology_id`);
      return;
    }
    let bh = map.get(id);
    if (!bh) {
      bh = { id, name: row.name || id, x: x!, y: y!, groundElev: elev!, layers: [] };
      map.set(id, bh);
    }
    bh.layers.push({ lithologyId, fromDepth: from!, toDepth: to! });
  });

  const boreholes = [...map.values()].map((b) => ({
    ...b,
    layers: b.layers.sort((a, c) => a.fromDepth - c.fromDepth),
  }));
  return { boreholes, errors };
}

/** 生成 CSV 文本（导出用） */
export function boreholesToCsv(
  boreholes: { id: string; name: string; x: number; y: number; groundElev: number; layers: { lithologyId: string; fromDepth: number; toDepth: number }[] }[],
): string {
  const lines = ['borehole_id,name,x,y,ground_elev,lithology_id,from_depth,to_depth'];
  for (const b of boreholes) {
    for (const l of b.layers) {
      lines.push(
        [b.id, b.name, b.x, b.y, b.groundElev, l.lithologyId, l.fromDepth, l.toDepth]
          .map((v) => {
            const s = String(v);
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
}
