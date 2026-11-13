// WebGPU 引擎单例：应用启动时初始化一次，跨页面复用；建模 compute 与三维渲染共用同一设备
import { GpuEngine } from './gpu-engine';

let engine: GpuEngine | null = null;
let initPromise: Promise<GpuEngine> | null = null;

/** 在应用启动时调用（GPU 可用时） */
export async function initEngine(): Promise<GpuEngine> {
  if (engine) return engine;
  if (!initPromise) {
    initPromise = (async () => {
      const e = new GpuEngine();
      await e.init();
      engine = e;
      return e;
    })();
  }
  return initPromise;
}

export function getEngine(): GpuEngine | null {
  return engine;
}

// 调试/E2E 钩子
if (typeof window !== 'undefined') {
  (window as unknown as { __strat3dEngine?: unknown }).__strat3dEngine = {
    get: () => engine,
  };
}

export function shutdownEngine(): void {
  engine?.dispose();
  engine = null;
  initPromise = null;
}
