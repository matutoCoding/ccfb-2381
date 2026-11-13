// 钻孔数据页：CSV 导入、演示数据生成、校验结果展示、钻孔明细表
import type { Borehole, Lithology } from '../../types';
import { appStore } from '../../store/app-store';
import { h, clear, readFileText, downloadText } from '../dom';
import { toast } from '../toast';
import { parseBoreholeCsv, boreholesToCsv } from '../../lib/csv';
import { generateDemoData } from '../../lib/demo-data';

const PALETTE: [number, number, number][] = [
  [196, 168, 120], [224, 200, 138], [150, 108, 78], [132, 140, 148],
  [112, 92, 120], [94, 140, 112], [92, 124, 168], [186, 120, 96],
  [150, 150, 100], [110, 110, 130],
];

export function renderBoreholesPage(root: HTMLElement): void {
  const project = appStore.current();
  clear(root);
  if (!project) {
    root.append(h('div.empty', {}, h('div', {}, '请先在项目列表中选择或新建项目')));
    return;
  }

  const sidebar = h('div.sidebar');
  const content = h('div.content.scroll-y');

  // ---- 侧栏 ----
  const fileInput = h('input', {
    type: 'file', accept: '.csv,text/csv', style: { display: 'none' },
    onchange: () => onCsvPicked(fileInput as HTMLInputElement),
  }) as HTMLInputElement;

  sidebar.append(
    h('div.card', {},
      h('h3', {}, '数据导入'),
      h('div.muted', { style: { marginBottom: '10px', lineHeight: '1.6' } },
        'CSV 列：borehole_id, name, x, y, ground_elev, lithology_id, from_depth, to_depth（支持中文列名）'),
      h('div.row', {},
        h('button.btn', { onclick: () => fileInput.click() }, '导入钻孔 CSV'),
      ),
      h('div.row', { style: { marginTop: '8px' } },
        h('button.btn.secondary.small', {
          onclick: () => window.open('./data/demo-boreholes.csv', '_blank'),
        }, '下载 CSV 模板'),
        h('button.btn.secondary.small', {
          onclick: () => exportCsv(project),
        }, '导出当前 CSV'),
      ),
      fileInput,
    ),
    h('div.card', {},
      h('h3', {}, '演示数据'),
      h('div.muted', { style: { marginBottom: '10px', lineHeight: '1.6' } },
        '200 孔合成数据：含正断层、粉土尖灭、砂砾石透镜体'),
      h('button.btn.secondary', { style: { width: '100%' }, onclick: loadDemo }, '载入 200 孔演示数据'),
    ),
    h('div.card', {},
      h('h3', {}, '数据概况'),
      statsView(project),
    ),
  );

  // ---- 主区：问题列表 + 钻孔表 ----
  const issueHost = h('div');
  const tableHost = h('div', { style: { marginTop: '16px' } });
  content.append(issueHost, tableHost);
  renderIssues(issueHost, project);
  renderTable(tableHost, project);

  root.append(sidebar, content);
}

function statsView(project: { boreholes: Borehole[]; lithologies: Lithology[] }) {
  const maxDepth = Math.max(0, ...project.boreholes.map((b) => Math.max(...b.layers.map((l) => l.toDepth), 0)));
  return h('div.stat-grid', {},
    h('div.stat', {}, h('div.v', {}, String(project.boreholes.length)), h('div.k', {}, '钻孔数')),
    h('div.stat', {}, h('div.v', {}, String(project.lithologies.length)), h('div.k', {}, '岩性种类')),
    h('div.stat', {}, h('div.v', {}, maxDepth.toFixed(1) + 'm'), h('div.k', {}, '最大孔深')),
    h('div.stat', {}, h('div.v', {},
      String(new Set(project.boreholes.map((b) => `${b.x.toFixed(0)},${b.y.toFixed(0)}`)).size)),
      h('div.k', {}, ' distinct 坐标')),
  );
}

function renderIssues(host: HTMLElement, project: ReturnType<typeof appStore.current> & {}): void {
  if (!project) return;
  clear(host);
  const v = project.validation;
  if (!v) {
    host.append(h('div.card', {}, h('div.muted', {}, '尚未校验，导入数据后自动校验')));
    return;
  }
  if (v.issues.length === 0) {
    host.append(h('div.card', {}, h('span.badge.ok', {}, '✓ 全部钻孔通过校验')));
    return;
  }
  const errors = v.issues.filter((i) => i.level === 'error');
  const warns = v.issues.filter((i) => i.level === 'warning');
  host.append(
    h('div.card', {},
      h('h3', {}, `校验结果（${errors.length} 错误 / ${warns.length} 警告）`),
      h('div.table-wrap', { style: { maxHeight: '260px' } },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '级别'), h('th', {}, '钻孔'), h('th', {}, '问题'))),
          h('tbody', {},
            ...v.issues.map((i) =>
              h('tr', { class: i.level === 'error' ? 'error-row' : 'warning-row' },
                h('td', {}, h(`span.badge ${i.level === 'error' ? 'err' : 'warn'}`, {}, i.level === 'error' ? '错误' : '警告')),
                h('td', {}, i.boreholeName),
                h('td', {}, i.message),
              )),
          ),
        ),
      ),
    ),
  );
}

function renderTable(host: HTMLElement, project: NonNullable<ReturnType<typeof appStore.current>>): void {
  clear(host);
  const errIds = new Set(project.validation?.errorBoreholeIds ?? []);
  const warnIds = new Set(
    (project.validation?.issues ?? []).filter((i) => i.level === 'warning').map((i) => i.boreholeId),
  );
  host.append(
    h('div.card', { style: { padding: '12px 14px' } },
      h('h3', {}, `钻孔明细（${project.boreholes.length}）`),
      h('div.table-wrap', {},
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '状态'), h('th', {}, '孔号'), h('th', {}, 'X'), h('th', {}, 'Y'),
            h('th', {}, '孔口标高'), h('th', {}, '层数'), h('th', {}, '终孔深度'), h('th', {}, '层序（自上而下）'),
          )),
          h('tbody', {},
            ...project.boreholes.map((b) => {
              const cls = errIds.has(b.id) ? 'error-row' : warnIds.has(b.id) ? 'warning-row' : '';
              const depth = Math.max(...b.layers.map((l) => l.toDepth), 0);
              return h('tr', { class: cls },
                h('td', {},
                  errIds.has(b.id) ? h('span.badge.err', {}, '错误')
                    : warnIds.has(b.id) ? h('span.badge.warn', {}, '警告')
                      : h('span.badge.ok', {}, '正常')),
                h('td', {}, b.name),
                h('td.mono', {}, b.x.toFixed(2)),
                h('td.mono', {}, b.y.toFixed(2)),
                h('td.mono', {}, b.groundElev.toFixed(2)),
                h('td', {}, String(b.layers.length)),
                h('td.mono', {}, depth.toFixed(2) + 'm'),
                h('td', { style: { whiteSpace: 'normal' } },
                  b.layers.map((l) => nameOf(project, l.lithologyId)).join(' → ') || h('span.muted', {}, '—')),
              );
            }),
          ),
        ),
      ),
    ),
  );
}

function nameOf(project: NonNullable<ReturnType<typeof appStore.current>>, id: string): string {
  return project.lithologies.find((l) => l.id === id)?.name ?? id;
}

async function onCsvPicked(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await readFileText(file);
    const { boreholes: parsed, errors } = parseBoreholeCsv(text);
    if (errors.length > 0) toast(`CSV 存在 ${errors.length} 个格式问题，已跳过相关行`, 'err');
    if (parsed.length === 0) {
      toast('没有解析到有效钻孔', 'err');
      return;
    }
    await appStore.mutate((p) => {
      // 注册新岩性（自动配色）
      const known = new Set(p.lithologies.map((l) => l.id));
      let colorIdx = p.lithologies.length;
      const allIds = new Set(parsed.flatMap((b) => b.layers.map((l) => l.lithologyId)));
      for (const id of allIds) {
        if (!known.has(id)) {
          p.lithologies.push({ id, name: id, color: PALETTE[colorIdx % PALETTE.length] });
          colorIdx++;
        }
      }
      p.boreholes = parsed.map<Borehole>((b) => ({
        id: b.id, name: b.name, x: b.x, y: b.y, groundElev: b.groundElev,
        layers: b.layers.map((l) => ({ ...l })),
      }));
      appStore.revalidate(p);
      p.bounds = null;
      p.model = null;
    });
    const proj = appStore.current()!;
    toast(`导入 ${parsed.length} 个钻孔，${proj.validation?.issues.length ?? 0} 条校验问题`,
      proj.validation?.errorBoreholeIds.length ? 'err' : 'ok');
    renderBoreholesPage(document.querySelector<HTMLElement>('#page-root')!);
  } catch (err) {
    toast(`导入失败：${(err as Error).message}`, 'err');
  } finally {
    input.value = '';
  }
}

async function loadDemo(): Promise<void> {
  const demo = generateDemoData(200);
  await appStore.mutate((p) => {
    p.boreholes = demo.boreholes;
    p.lithologies = demo.lithologies.map((l) => ({ ...l }));
    p.fault = { ...demo.fault };
    appStore.revalidate(p);
    p.bounds = null;
    p.model = null;
  });
  toast('已载入 200 孔演示数据（含断层 / 尖灭 / 透镜体）', 'ok');
  renderBoreholesPage(document.querySelector<HTMLElement>('#page-root')!);
}

function exportCsv(project: NonNullable<ReturnType<typeof appStore.current>>): void {
  downloadText(`${project.name}-钻孔.csv`, boreholesToCsv(project.boreholes), 'text/csv');
  toast('CSV 已导出', 'ok');
}
