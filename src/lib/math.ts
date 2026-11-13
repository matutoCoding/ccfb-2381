// 小型线性代数 / 数值工具（无第三方依赖）

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** 确定性伪随机（mulberry32），保证测试数据可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高斯消元解线性方程组 A·x = b，A 为 n×n 行优先；失败返回 null */
export function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const m = new Float64Array(n * n);
  const y = new Float64Array(n);
  m.set(A);
  y.set(b);
  for (let col = 0; col < n; col++) {
    // 选主元
    let pivot = col;
    let pivotAbs = Math.abs(m[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r * n + col]);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivot = r;
      }
    }
    if (pivotAbs < 1e-12) return null;
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = m[col * n + c];
        m[col * n + c] = m[pivot * n + c];
        m[pivot * n + c] = tmp;
      }
      const tmp = y[col];
      y[col] = y[pivot];
      y[pivot] = tmp;
    }
    const piv = m[col * n + col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r * n + col] / piv;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) m[r * n + c] -= factor * m[col * n + c];
      y[r] -= factor * y[col];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = y[i] / m[i * n + i];
  return x;
}

/** 一维线性插值，xs 必须升序，越界取端点 */
export function interp1(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return lerp(ys[lo], ys[hi], t);
}

/** 点到线段的投影，返回 {距离, 沿线参数 t(0-1), 投影点} */
export function projectPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; t: number; qx: number; qy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { distance: dist(px, py, qx, qy), t, qx, qy };
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
