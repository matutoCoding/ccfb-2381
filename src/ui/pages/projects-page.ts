// 项目列表页：新建 / 删除 / 复制 / 导入导出项目
import type { Project } from '../../types';
import { appStore } from '../../store/app-store';
import { h, clear, downloadText, readFileText } from '../dom';
import { navigate } from '../router';
import { toast } from '../toast';
import { projectFromJson, projectToJson } from '../../lib/db';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function renderProjectsPage(root: HTMLElement): void {
  const state = appStore.getState();
  clear(root);
  const wrap = h('div.content', { style: { maxWidth: '1100px', margin: '0 auto', width: '100%' } });

  const toolbar = h('div.row', { style: { marginBottom: '18px', flex: 'none' } },
    h('input', {
      placeholder: '新项目名称，如：经开区一期勘察',
      id: 'new-project-name',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') doCreate();
      },
    }),
    h('button.btn', { onclick: doCreate }, '＋ 新建项目'),
    h('button.btn.secondary', {
      onclick: () => importInput.click(),
    }, '导入项目 (.json)'),
  );

  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onchange: async () => {
      const file = (importInput as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const project = projectFromJson(await readFileText(file));
        await appStore.replace(project);
        toast(`项目「${project.name}」已导入`, 'ok');
      } catch (err) {
        toast(`导入失败：${(err as Error).message}`, 'err');
      }
      (importInput as HTMLInputElement).value = '';
    },
  }) as HTMLInputElement;

  async function doCreate(): Promise<void> {
    const input = document.querySelector<HTMLInputElement>('#new-project-name');
    const name = input?.value.trim() || `未命名项目 ${new Date().toLocaleDateString('zh-CN')}`;
    const p = await appStore.createProject(name);
    toast(`已创建项目「${p.name}」`, 'ok');
    navigate('boreholes');
  }

  const grid = h('div.project-grid');
  if (state.projects.length === 0) {
    grid.append(h('div.empty', { style: { gridColumn: '1/-1', height: '320px' } },
      h('div', { style: { fontSize: '16px' } }, '还没有项目'),
      h('div', { class: 'muted' }, '新建一个项目，或导入同事发来的 .strat3d.json'),
    ));
  }
  for (const p of state.projects) grid.append(projectCard(p));

  wrap.append(toolbar, grid);
  root.append(wrap);
}

function projectCard(p: Project): HTMLElement {
  const issueCount = p.validation?.issues.length ?? 0;
  const errCount = p.validation?.errorBoreholeIds.length ?? 0;
  return h('div.card.project-card', {
    onclick: () => {
      appStore.select(p.id);
      navigate('boreholes');
    },
  },
    h('div.title', {}, p.name),
    h('div.meta', {},
      h('div', {}, `钻孔：${p.boreholes.length} 个　岩性：${p.lithologies.length} 种`),
      h('div', {}, `更新：${formatTime(p.updatedAt)}`),
      h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' } },
        p.model
          ? h('span.badge.ok', {}, `已建模 ${p.model.gridSize}³ · ${p.model.backend === 'webgpu' ? 'WebGPU' : 'CPU'}`)
          : h('span.badge.warn', {}, '未建模'),
        errCount > 0
          ? h('span.badge.err', {}, `${errCount} 孔有错误`)
          : issueCount > 0
            ? h('span.badge.warn', {}, `${issueCount} 条警告`)
            : p.boreholes.length > 0
              ? h('span.badge.ok', {}, '数据校验通过')
              : h('span', { class: 'muted' }, '无数据'),
      ),
    ),
    h('div.row', { style: { marginTop: '14px' } },
      h('button.btn.secondary.small', {
        onclick: async (e: Event) => {
          e.stopPropagation();
          downloadText(`${p.name.replace(/[\\/:*?"<>|]/g, '_')}.strat3d.json`, projectToJson(p));
          toast('项目已导出', 'ok');
        },
      }, '导出'),
      h('button.btn.danger.small', {
        onclick: async (e: Event) => {
          e.stopPropagation();
          if (!confirm(`确定删除项目「${p.name}」？该操作不可恢复。`)) return;
          await appStore.deleteProject(p.id);
          toast('项目已删除', 'info');
          renderProjectsPage(document.querySelector<HTMLElement>('#page-root')!);
        },
      }, '删除'),
    ),
  );
}
