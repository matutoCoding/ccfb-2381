import './styles.css';
import { h, clear } from './ui/dom';
import { currentRoute, navigate, onRouteChange, type Route } from './ui/router';
import { appStore } from './store/app-store';
import { toast } from './ui/toast';
import { renderProjectsPage } from './ui/pages/projects-page';
import { renderBoreholesPage } from './ui/pages/boreholes-page';
import { renderParamsPage, type BuildRunner } from './ui/pages/params-page';
import { renderView3dPage, detachView } from './ui/pages/view3d-page';
import { renderSectionPage } from './ui/pages/section-page';
import { buildModel } from './lib/build-model';
import { GpuEngine } from './render/gpu-engine';
import { getEngine, initEngine } from './render/engine-singleton';

const NAV: { route: Route; label: string; needProject: boolean }[] = [
  { route: 'projects', label: '项目列表', needProject: false },
  { route: 'boreholes', label: '钻孔数据', needProject: true },
  { route: 'params', label: '建模参数', needProject: true },
  { route: 'view3d', label: '三维视图', needProject: true },
  { route: 'section', label: '剖面', needProject: true },
];

function shell(): void {
  const app = document.querySelector<HTMLElement>('#app')!;
  clear(app);
  const route = currentRoute();
  const project = appStore.current();

  const nav = h('div.nav', {}, ...NAV.map((n) =>
    h('button', {
      class: route === n.route ? 'active' : '',
      disabled: n.needProject && !project,
      onclick: () => navigate(n.route),
    }, n.label),
  ));

  const header = h('div.app-header', {},
    h('span.logo', {}, 'STRAT3D 三维地层建模'),
    h('span.project-name', {}, project ? `当前项目：${project.name}` : '未选择项目'),
    appStore.getState().gpuAvailable === false
      ? h('span.badge.warn', {}, 'WebGPU 不可用 · CPU 模式')
      : appStore.getState().gpuAvailable === true
        ? h('span.badge.ok', {}, 'WebGPU 就绪')
        : h('span.badge', {}, '检测 WebGPU 中…'),
    nav,
  );

  const pageRoot = h('div.main#page-root.page');
  app.append(header, pageRoot);
  routePage(route, pageRoot);
}

function routePage(route: Route, root: HTMLElement): void {
  // 离开三维页时让引擎脱离 canvas（设备保留，compute 仍可复用）
  if (route !== 'view3d') detachView();
  switch (route) {
    case 'projects':
      renderProjectsPage(root);
      break;
    case 'boreholes':
      renderBoreholesPage(root);
      break;
    case 'params':
      renderParamsPage(root, buildRunner);
      break;
    case 'view3d':
      void renderView3dPage(root);
      break;
    case 'section':
      renderSectionPage(root);
      break;
  }
}

const buildRunner: BuildRunner = {
  async run(): Promise<void> {
    const project = appStore.current();
    if (!project) return;
    const t0 = performance.now();
    try {
      toast('正在构建层位面与体素模型…（compute 不阻塞主线程）', 'info', 2000);
      await new Promise((r) => setTimeout(r, 30));
      const outcome = await buildModel(project, project.params, getEngine());
      await appStore.mutate((p) => {
        p.bounds = outcome.model.bounds;
        p.model = outcome.model;
      });
      const total = performance.now() - t0;
      const ok5s = total < 5000;
      toast(
        `建模完成：${outcome.backend}，层位面 ${outcome.surfaceMs.toFixed(0)}ms + 体素 ${outcome.voxelMs.toFixed(0)}ms，端到端 ${total.toFixed(0)}ms ${ok5s ? '✓ <5s' : '（超出 5s 目标）'}`,
        ok5s ? 'ok' : 'err',
        6000,
      );
      navigate('view3d');
    } catch (err) {
      console.error(err);
      toast(`建模失败：${(err as Error).message}`, 'err', 8000);
    }
  },
};

async function bootstrap(): Promise<void> {
  await appStore.hydrate();
  try {
    const supported = await GpuEngine.isSupported();
    appStore.setGpuAvailable(supported);
    if (supported) {
      // 提前初始化引擎，使参数页建模时可直接调用 compute shader
      await initEngine();
    }
  } catch (err) {
    console.warn('WebGPU 初始化失败，使用 CPU 模式：', err);
    appStore.setGpuAvailable(false);
  }
  appStore.subscribe(() => shell());
  onRouteChange(() => shell());
  if (!location.hash) location.hash = '#/projects';
  shell();
}

void bootstrap();
