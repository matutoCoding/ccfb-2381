// 建模参数页：岩性表管理、插值方法、体素网格参数、触发建模
import type { InterpMethod, Lithology, ModelParams } from '../../types';
import { DEFAULT_PARAMS } from '../../types';
import { appStore } from '../../store/app-store';
import { h, clear } from '../dom';
import { toast } from '../toast';
import { METHOD_LABELS } from '../../lib/interpolation';
import { computeBounds } from '../../lib/stratigraphy';
import { fillRatio } from '../../lib/build-model';

export interface BuildRunner {
  run(): Promise<void>;
}

export function renderParamsPage(root: HTMLElement, runner: BuildRunner): void {
  const project = appStore.current();
  clear(root);
  if (!project) {
    root.append(h('div.empty', {}, h('div', {}, '请先选择项目')));
    return;
  }
  const sidebar = h('div.sidebar');
  const content = h('div.content.scroll-y');

  // ---- 参数表单 ----
  const form = h('div.card');
  const p = project.params;
  const numField = (key: keyof ModelParams, label: string, step = 1, min?: number, max?: number, hint?: string) =>
    h('label.field', {},
      h('span', {}, label + (hint ? `　${hint}` : '')),
      h('input', {
        type: 'number', step: String(step), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
        value: String(p[key]),
        onchange: async (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (!Number.isFinite(v)) return;
          await appStore.mutate((pr) => {
            (pr.params[key] as number) = v;
            pr.model = null;
          });
        },
      }),
    );

  const methodSelect = h('select', {
    onchange: async (e: Event) => {
      const method = (e.target as HTMLSelectElement).value as InterpMethod;
      await appStore.mutate((pr) => {
        pr.params.method = method;
        pr.model = null;
      });
      renderParamsPage(root, runner);
    },
  }, ...(Object.keys(METHOD_LABELS) as InterpMethod[]).map((m) =>
    h('option', { value: m, ...(p.method === m ? { selected: true } : {}) }, METHOD_LABELS[m])));

  form.append(
    h('h3', {}, '插值与网格参数'),
    h('label.field', {}, h('span', {}, '层位插值方法'), methodSelect),
    h('div', {},
      p.method === 'idw' ? numField('idwPower', 'IDW 幂指数', 0.1, 0.5, 6) : null,
      numField('idwNeighbors', '参与插值的最近邻孔数 K', 1, 2, 64),
      p.method === 'kriging' ? numField('krigingRange', '克里金变程（米）', 5, 1, 10000) : null,
      p.method === 'kriging' ? numField('krigingSill', '克里金基台值', 0.05, 0.01, 100) : null,
      numField('gridSize', '体素网格边长 N（N³）', 8, 16, 256, '需求基准：256'),
      numField('surfaceResolution', '层位面网格分辨率 S×S', 8, 16, 256),
      numField('pinchTolerance', '尖灭厚度容差（米）', 0.1, 0, 10),
      numField('baseDepthBelowMin', '模型底界外扩（米）', 1, 0, 100),
      numField('topBuffer', '模型顶界余量（米）', 0.5, 0, 50),
      h('div.row', {},
        h('button.btn.secondary.small', {
          onclick: async () => {
            await appStore.mutate((pr) => {
              pr.params = { ...DEFAULT_PARAMS };
              pr.model = null;
            });
            renderParamsPage(document.querySelector<HTMLElement>('#page-root')!, runner);
          },
        }, '恢复默认'),
      ),
    ),
  );
  sidebar.append(form, buildCard(project, runner));

  // ---- 岩性管理 ----
  const lithoCard = h('div.card', {},
    h('h3', {}, `岩性表（${project.lithologies.length}）　颜色与层序`),
    h('div.muted', { style: { marginBottom: '10px' } }, '层序由钻孔中各岩性出现深度自动推断，此处仅管理名称与颜色'),
    h('div.table-wrap', {},
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '颜色'), h('th', {}, '编号'), h('th', {}, '名称'), h('th', {}, '操作'))),
        h('tbody', {}, ...project.lithologies.map((l) => lithoRow(l, project, runner))),
      ),
    ),
  );

  const boundsCard = project.boreholes.length
    ? h('div.card', {}, h('h3', {}, '模型范围（按钻孔自动计算）'), boundsView(project))
    : null;

  if (boundsCard) content.append(lithoCard, boundsCard);
  else content.append(lithoCard);
  root.append(sidebar, content);
}

function lithoRow(l: Lithology, project: NonNullable<ReturnType<typeof appStore.current>>, runner: BuildRunner): HTMLElement {
  return h('tr', {},
    h('td', {},
      h('input', {
        type: 'color',
        value: '#' + l.color.map((c) => c.toString(16).padStart(2, '0')).join(''),
        style: { width: '42px', height: '28px', padding: '2px', background: 'transparent' },
        onchange: async (e: Event) => {
          const hex = (e.target as HTMLInputElement).value.slice(1);
          const rgb: [number, number, number] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
          await appStore.mutate((p) => {
            const t = p.lithologies.find((x) => x.id === l.id);
            if (t) t.color = rgb;
            p.model = null;
          });
        },
      }),
    ),
    h('td.mono', {}, l.id),
    h('td', {},
      h('input', {
        value: l.name,
        onchange: async (e: Event) => {
          await appStore.mutate((p) => {
            const t = p.lithologies.find((x) => x.id === l.id);
            if (t) t.name = (e.target as HTMLInputElement).value;
          });
        },
      }),
    ),
    h('td', {},
      h('button.btn.danger.small', {
        onclick: async () => {
          const used = project.boreholes.some((b) => b.layers.some((ly) => ly.lithologyId === l.id));
          if (used) {
            toast('该岩性已被钻孔引用，不能删除', 'err');
            return;
          }
          await appStore.mutate((p) => {
            p.lithologies = p.lithologies.filter((x) => x.id !== l.id);
            p.model = null;
          });
          renderParamsPage(document.querySelector<HTMLElement>('#page-root')!, runner);
        },
      }, '删除'),
    ),
  );
}

function boundsView(project: NonNullable<ReturnType<typeof appStore.current>>): HTMLElement {
  const b = computeBounds(project.boreholes, project.params);
  const row = (k: string, v: string) => h('div.row', { style: { flex: 'none', marginBottom: '4px' } },
    h('span.muted', { style: { flex: '1' } }, k), h('span.mono', { style: { flex: '1' } }, v));
  return h('div', { style: { fontSize: '12.5px', lineHeight: '1.9' } },
    row('X 范围', `${b.minX.toFixed(1)} ~ ${b.maxX.toFixed(1)} m`),
    row('Y 范围', `${b.minY.toFixed(1)} ~ ${b.maxY.toFixed(1)} m`),
    row('Z 范围', `${b.minZ.toFixed(1)} ~ ${b.maxZ.toFixed(1)} m`),
    row('体素尺寸', `${((b.maxX - b.minX) / project.params.gridSize).toFixed(2)} m（水平）`),
  );
}

function buildCard(project: NonNullable<ReturnType<typeof appStore.current>>, runner: BuildRunner): HTMLElement {
  const m = project.model;
  const hasErrors = (project.validation?.errorBoreholeIds.length ?? 0) > 0;
  return h('div.card', {},
    h('h3', {}, '执行建模'),
    hasErrors ? h('div.muted', { style: { color: 'var(--err)', marginBottom: '10px' } }, '存在错误钻孔，请先在钻孔页处理') : null,
    h('button.btn', {
      style: { width: '100%' },
      disabled: project.boreholes.length === 0 || hasErrors,
      onclick: () => runner.run(),
    }, m ? '重新计算模型' : '开始建模'),
    m
      ? h('div', { style: { marginTop: '12px', fontSize: '12.5px', lineHeight: '1.9' } },
        h('div', {}, `后端：${m.backend === 'webgpu' ? 'WebGPU compute' : 'CPU 回退'}`),
        h('div', {}, `层位面构建：${m.surfaceMs.toFixed(0)} ms`),
        h('div', {}, `体素化：${m.voxelMs.toFixed(0)} ms`),
        h('div', {}, `总耗时：${m.buildMs.toFixed(0)} ms（目标 < 5000 ms）`),
        h('div', {}, `填充率：${(fillRatio(m.voxels) * 100).toFixed(1)}%`),
        h('div', { style: { marginTop: '6px' } },
          m.backend === 'cpu'
            ? h('span.badge.warn', {}, 'CPU 回退模式（无 GPU 一致性比对）')
            : m.consistencyMismatches === 0
              ? h('span.badge.ok', {}, 'GPU/CPU 体素一致性 ✓')
              : h('span.badge.err', {}, `一致性差异 ${m.consistencyMismatches} 体素`)),
      )
      : h('div.muted', { style: { marginTop: '10px' } }, '尚未建模'),
  );
}
