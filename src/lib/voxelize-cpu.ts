// CPU 体素分类器：与 WGSL compute shader (voxelize.wgsl) 保持完全相同的判定逻辑，
// 1) 作为不支持 WebGPU 时的回退；2) 供单元测试比对 GPU 结果。
import type { HorizonSurfaces, ModelBounds } from '../types';

export interface VoxelClassifyInput {
  surfaces: HorizonSurfaces;
  gridSize: number;
  bounds: ModelBounds;
}

/**
 * 体素索引 = ix + iy*N + iz*N*N；z 自下而上（iz=0 为模型底）。
 * 输出 0 = 空，>=1 为岩性在 lithologyIndex 中的序号 +1。
 */
export function classifyVoxelsCpu(input: VoxelClassifyInput): Uint8Array {
  const { surfaces, gridSize: N, bounds } = input;
  const S = surfaces.resolution;
  const voxels = new Uint8Array(N * N * N);
  const unitCode = new Map<string, number>();
  surfaces.unitIndex.forEach((id, idx) => unitCode.set(id, idx + 1));

  const dx = (bounds.maxX - bounds.minX) / N;
  const dy = (bounds.maxY - bounds.minY) / N;
  const dz = (bounds.maxZ - bounds.minZ) / N;
  const sx = (bounds.maxX - bounds.minX) / S;
  const sy = (bounds.maxY - bounds.minY) / S;

  for (let iy = 0; iy < N; iy++) {
    const wy = bounds.minY + (iy + 0.5) * dy;
    const j = Math.min(S - 1, Math.max(0, Math.floor((wy - bounds.minY) / sy)));
    for (let ix = 0; ix < N; ix++) {
      const wx = bounds.minX + (ix + 0.5) * dx;
      const i = Math.min(S - 1, Math.max(0, Math.floor((wx - bounds.minX) / sx)));
      const cell = i + j * S;
      const groundZ = surfaces.ground[cell];
      const colBase = ix + iy * N;
      for (let iz = 0; iz < N; iz++) {
        const wz = bounds.minZ + (iz + 0.5) * dz;
        let code = 0;
        if (Number.isFinite(groundZ) && wz <= groundZ) {
          for (let u = 0; u < surfaces.unitIndex.length; u++) {
            const t = surfaces.top[u][cell];
            const b = surfaces.bottom[u][cell];
            if (Number.isFinite(t) && Number.isFinite(b) && wz <= t && wz >= b) {
              code = u + 1;
              break;
            }
          }
        }
        voxels[colBase + iz * N * N] = code;
      }
    }
  }
  return voxels;
}

/** 体素填充率（非空比例），用于构建结果统计 */
export function fillRatio(voxels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) n++;
  return n / voxels.length;
}
