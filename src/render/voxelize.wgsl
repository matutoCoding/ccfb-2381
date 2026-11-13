// 体素化 compute shader
// 与 src/lib/voxelize-cpu.ts 的 classifyVoxelsCpu 逐行对应，保证 CPU/GPU 结果一致。
// 每个 workgroup 负责一列 (ix, iy) 的 N 个体素。

struct Params {
  N : u32,
  S : u32,
  unitCount : u32,
  _pad : u32,
  minX : f32, maxX : f32,
  minY : f32, maxY : f32,
  minZ : f32, maxZ : f32,
}

@group(0) @binding(0) var<uniform> params : Params;
// 长度 S*S：地表；其后依次 unitCount 个 top、unitCount 个 bottom，NaN 编码为 0x7fc00000
@group(0) @binding(1) var<storage, read> ground : array<f32>;
@group(0) @binding(2) var<storage, read> tops : array<f32>;
@group(0) @binding(3) var<storage, read> bottoms : array<f32>;
@group(0) @binding(4) var outTex : texture_storage_3d<r32uint, write>;

override WORKGROUP_SIZE_X : u32 = 8u;
override WORKGROUP_SIZE_Y : u32 = 8u;

@compute @workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let N = params.N;
  let S = params.S;
  let ix = gid.x;
  let iy = gid.y;
  if (ix >= N || iy >= N) { return; }

  let dx = (params.maxX - params.minX) / f32(N);
  let dy = (params.maxY - params.minY) / f32(N);
  let dz = (params.maxZ - params.minZ) / f32(N);
  let sxD = (params.maxX - params.minX) / f32(S);
  let syD = (params.maxY - params.minY) / f32(S);

  let wx = params.minX + (f32(ix) + 0.5) * dx;
  let wy = params.minY + (f32(iy) + 0.5) * dy;
  var ci = u32((wx - params.minX) / sxD);
  var cj = u32((wy - params.minY) / syD);
  ci = clamp(ci, 0u, S - 1u);
  cj = clamp(cj, 0u, S - 1u);
  let cell = ci + cj * S;
  let SS = S * S;

  let groundZ = ground[cell];

  for (var iz : u32 = 0u; iz < N; iz = iz + 1u) {
    let wz = params.minZ + (f32(iz) + 0.5) * dz;
    var voxelCode : u32 = 0u;
    if (wz <= groundZ) {
      for (var u : u32 = 0u; u < params.unitCount; u = u + 1u) {
        let t = tops[u * SS + cell];
        let b = bottoms[u * SS + cell];
        // NaN != NaN，尖灭单元直接跳过
        if (t == t && b == b && wz <= t && wz >= b) {
          voxelCode = u + 1u;
          break;
        }
      }
    }
    textureStore(outTex, vec3<u32>(ix, iy, iz), vec4<u32>(voxelCode, 0u, 0u, 0u));
  }
}
