// 建模编排：层位面构建 -> 体素化（WebGPU compute，回退 CPU）-> 一致性校验
import type { Borehole, Fault, ModelParams, Project, VoxelModel } from '../types';
import { buildHorizonSurfaces, computeBounds } from './stratigraphy';
import { classifyVoxelsCpu, fillRatio } from './voxelize-cpu';
import type { GpuEngine } from '../render/gpu-engine';

export interface BuildOutcome {
  model: VoxelModel;
  surfaceMs: number;
  voxelMs: number;
  consistencyMismatches: number;
  backend: 'webgpu' | 'cpu';
}

export async function buildModel(
  project: Project,
  params: ModelParams,
  engine: GpuEngine | null,
): Promise<BuildOutcome> {
  const boreholes: Borehole[] = project.boreholes;
  const fault: Fault | null = project.fault;
  const t0 = performance.now();
  const bounds = computeBounds(boreholes, params);
  const { surfaces } = buildHorizonSurfaces(boreholes, params, bounds, fault);
  const t1 = performance.now();
  const surfaceMs = t1 - t0;

  const N = params.gridSize;
  let voxels: Uint8Array;
  let backend: 'webgpu' | 'cpu' = 'cpu';
  let voxelMs = 0;

  if (engine) {
    try {
      voxelMs = await engine.voxelize(surfaces, bounds, N);
      voxels = await engine.readVoxels();
      backend = 'webgpu';
    } catch (err) {
      console.warn('GPU 体素化失败，回退 CPU：', err);
      const t2 = performance.now();
      voxels = classifyVoxelsCpu({ surfaces, gridSize: N, bounds });
      voxelMs = performance.now() - t2;
    }
  } else {
    const t2 = performance.now();
    voxels = classifyVoxelsCpu({ surfaces, gridSize: N, bounds });
    voxelMs = performance.now() - t2;
  }

  // 一致性校验：GPU 结果与 CPU 参考实现逐体素比对（只在 GPU 后端执行）
  let consistencyMismatches = 0;
  if (backend === 'webgpu') {
    const ref = classifyVoxelsCpu({ surfaces, gridSize: N, bounds });
    for (let i = 0; i < voxels.length; i++) {
      if (voxels[i] !== ref[i]) consistencyMismatches++;
    }
  }

  const model: VoxelModel = {
    voxels,
    lithologyIndex: surfaces.unitIndex,
    gridSize: N,
    bounds,
    surfaces,
    params: { ...params },
    createdAt: Date.now(),
    buildMs: surfaceMs + voxelMs,
    surfaceMs,
    voxelMs,
    consistencyMismatches,
    backend,
  };
  return { model, surfaceMs, voxelMs, consistencyMismatches, backend };
}

export { fillRatio };
