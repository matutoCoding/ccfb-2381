// 列主序 mat4（与 WGSL mat4x4<f32> 内存布局一致）
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** 标准 4×4 求逆（glMatrix 等价实现，已通过 viewProj·inv=I 验证） */
export function mat4Invert(a: Mat4): Mat4 {
  const out = new Float32Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** 轨道相机：方位角/俯仰角/距离，模型空间固定为单位立方体 [0,1]^3 */
export class OrbitCamera {
  azimuth = -Math.PI * 0.25;
  polar = Math.PI * 0.32;
  distance = 1.9;
  target: Vec3 = [0.5, 0.5, 0.35];
  fov = Math.PI / 4;

  eye(): Vec3 {
    const cp = Math.sin(this.polar);
    return [
      this.target[0] + this.distance * cp * Math.cos(this.azimuth),
      this.target[1] + this.distance * cp * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.cos(this.polar),
    ];
  }

  viewProj(aspect: number): Mat4 {
    const proj = mat4Perspective(this.fov, aspect, 0.01, 20);
    const view = mat4LookAt(this.eye(), this.target, [0, 0, 1]);
    return mat4Multiply(proj, view);
  }

  rotate(dAz: number, dPolar: number): void {
    this.azimuth += dAz;
    this.polar = Math.min(Math.PI - 0.05, Math.max(0.05, this.polar + dPolar));
  }

  pan(dx: number, dy: number): void {
    const eye = this.eye();
    const forward: Vec3 = [
      this.target[0] - eye[0],
      this.target[1] - eye[1],
      this.target[2] - eye[2],
    ];
    const fl = Math.hypot(...forward) || 1;
    const f: Vec3 = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
    const right: Vec3 = [f[1], -f[0], 0];
    const rl = Math.hypot(...right) || 1;
    const up: Vec3 = [
      (f[1] * right[2] - f[2] * right[1]) / rl,
      (f[2] * right[0] - f[0] * right[2]) / rl,
      (f[0] * right[1] - f[1] * right[0]) / rl,
    ];
    const s = this.distance * 0.0016;
    this.target[0] += (-dx * right[0] / rl + dy * up[0]) * s;
    this.target[1] += (-dx * right[1] / rl + dy * up[1]) * s;
    this.target[2] += (-dx * right[2] / rl + dy * up[2]) * s;
  }

  zoom(factor: number): void {
    this.distance = Math.min(8, Math.max(0.6, this.distance * factor));
  }
}

/** 世界点 -> 屏幕像素（用于覆盖层绘制），返回 null 表示在相机背面 */
export function worldToScreen(m: Mat4, p: Vec3, w: number, h: number): { x: number; y: number } | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (ww <= 0) return null;
  const nx = x / ww;
  const ny = y / ww;
  void z;
  return { x: (nx * 0.5 + 0.5) * w, y: (1 - (ny * 0.5 + 0.5)) * h };
}
