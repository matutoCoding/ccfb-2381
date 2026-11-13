// DDA 光线步进体素渲染（片元着色器，全屏三角形）
// - 三向剖切盒：DDA 越出盒范围的体素直接跳过；切口 = 盒内最后一个命中体素的朝向面，天然封面；
// - 每层独立显隐/透明度：uniform 传入每层颜色与 alpha，隐藏层 alpha=0 按空体素跳过；
// - 地表以上为空气，不渲染。

struct Camera {
  invViewProj : mat4x4<f32>,
  camPos : vec3<f32>,
  _pad : f32,
}

struct Params {
  N : u32,
  // 剖切盒（归一化 0..1，含端点）
  clipMin : vec3<f32>,
  clipMax : vec3<f32>,
  maxLayers : u32,
  ambient : f32,
}

// 视口像素尺寸（用于片元 NDC 计算）
struct Viewport {
  size : vec2<f32>,
  _pad : vec2<f32>,
}

struct LayerStyle {
  color : vec3<f32>, // 线性 0..1
  alpha : f32,       // 0 = 隐藏
}

@group(0) @binding(0) var<uniform> camera : Camera;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var voxTex : texture_3d<u32>;
@group(0) @binding(3) var<storage, read> layers : array<LayerStyle>;
@group(0) @binding(4) var<uniform> bgColor : vec4<f32>;
@group(0) @binding(5) var<uniform> viewport : Viewport;

struct VertexOut {
  @builtin(position) pos : vec4<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vi : u32) -> VertexOut {
  // 全屏四边形（两个三角形）；单大三角形在部分 D3D11 驱动上覆盖异常
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
  );
  var out : VertexOut;
  out.pos = vec4<f32>(p[vi], 0.0, 1.0);
  return out;
}

const MAX_DDA_STEPS : u32 = 2048u;

fn ndcToWorld(ndc : vec3<f32>) -> vec3<f32> {
  let h = camera.invViewProj * vec4<f32>(ndc, 1.0);
  return h.xyz / h.w;
}

@fragment
fn fsMain(in : VertexOut) -> @location(0) vec4<f32> {
  let N = f32(params.N);
  // 用真实视口尺寸把片元像素坐标归一化，再映射到 NDC
  let uv = in.pos.xy / viewport.size; // 0..1
  let ndc = vec3<f32>(uv * 2.0 - 1.0, 1.0);
  let targetPt = ndcToWorld(ndc);
  let ro = camera.camPos;
  let rd = normalize(targetPt - ro);

  // 世界坐标按单位立方体 [0,1]^3 建模（外部 JS 已把相机变换到该空间）
  let bMin = vec3<f32>(0.0);
  let bMax = vec3<f32>(1.0);

  // 射线与 AABB 求交（slab 法）
  var tNear = 0.0;
  var tFar = 1e9;
  for (var a = 0; a < 3; a++) {
    let o = ro[a];
    let d = rd[a];
    if (abs(d) < 1e-8) {
      if (o < bMin[a] || o > bMax[a]) { return bgColor; }
    } else {
      var t1 = (bMin[a] - o) / d;
      var t2 = (bMax[a] - o) / d;
      if (t1 > t2) { let tmp = t1; t1 = t2; t2 = tmp; }
      tNear = max(tNear, t1);
      tFar = min(tFar, t2);
    }
  }
  if (tNear > tFar || tFar < 0.0) { return bgColor; }
  var t = max(tNear, 0.0);

  // DDA（Amanatides & Woo）
  var pos = ro + rd * t;
  var cell = vec3<i32>(floor(clamp(pos, vec3<f32>(0.0), vec3<f32>(0.999999)) * N));
  let stepV = vec3<i32>(sign(rd));
  let invD = 1.0 / abs(rd);
  var tMax : vec3<f32>;
  var tDelta = invD / N;
  for (var a = 0; a < 3; a++) {
    let boundary = (f32(cell[a]) + f32(max(stepV[a], 0))) / N;
    tMax[a] = t + abs(boundary - pos[a]) * invD[a];
  }

  let lo = vec3<i32>(floor(params.clipMin * N));
  let hi = vec3<i32>(ceil(params.clipMax * N)) - 1;

  var face = vec3<f32>(0.0, 0.0, 1.0);
  var steps : u32 = 0u;
  var accRgb = vec3<f32>(0.0);
  var accA = 0.0;
  loop {
    if (steps >= MAX_DDA_STEPS) { break; }
    steps = steps + 1u;

    let insideClip =
      cell.x >= lo.x && cell.x <= hi.x &&
      cell.y >= lo.y && cell.y <= hi.y &&
      cell.z >= lo.z && cell.z <= hi.z;

    if (insideClip) {
      let code = textureLoad(voxTex, cell, 0).r;
      if (code > 0u && code <= params.maxLayers) {
        let style = layers[code - 1u];
        if (style.alpha > 0.001) {
          // 方向光 + 环境光，切口面与普通体素面统一着色
          let lightDir = normalize(vec3<f32>(-0.45, -0.55, 0.7));
          let ndotl = abs(dot(face, lightDir));
          let shade = params.ambient + (1.0 - params.ambient) * ndotl;
          let srcRgb = style.color.rgb * shade;
          // 前向 alpha 混合；近不透明时终止（切口即当前进入面，天然封面）
          let w = (1.0 - accA) * style.alpha;
          accRgb = accRgb + w * srcRgb;
          accA = accA + w;
          if (accA >= 0.985) { break; }
        }
      }
    }

    // 推进到下一单元
    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      cell.x = cell.x + stepV.x;
      t = tMax.x;
      tMax.x = tMax.x + tDelta.x;
      face = vec3<f32>(f32(-stepV.x), 0.0, 0.0);
    } else if (tMax.y < tMax.z) {
      cell.y = cell.y + stepV.y;
      t = tMax.y;
      tMax.y = tMax.y + tDelta.y;
      face = vec3<f32>(0.0, f32(-stepV.y), 0.0);
    } else {
      cell.z = cell.z + stepV.z;
      t = tMax.z;
      tMax.z = tMax.z + tDelta.z;
      face = vec3<f32>(0.0, 0.0, f32(-stepV.z));
    }
    if (cell.x < 0 || cell.y < 0 || cell.z < 0 ||
        cell.x >= i32(params.N) || cell.y >= i32(params.N) || cell.z >= i32(params.N)) {
      break;
    }
    if (t > tFar) { break; }
  }

  // 体素结果与背景合成
  let finalRgb = accRgb + (1.0 - accA) * bgColor.rgb;
  return vec4<f32>(finalRgb, 1.0);
}
