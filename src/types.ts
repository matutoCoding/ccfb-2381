// 全局类型定义

export type InterpMethod = 'idw' | 'kriging' | 'nearest';

/** 岩性（图层）定义 */
export interface Lithology {
  id: string;
  name: string;
  color: [number, number, number]; // 0-255 RGB
}

/** 钻孔中的一个分层 */
export interface BoreholeLayer {
  lithologyId: string;
  fromDepth: number; // 米，自孔口向下
  toDepth: number;
}

/** 钻孔 */
export interface Borehole {
  id: string;
  name: string;
  x: number; // 工程坐标，米
  y: number;
  groundElev: number; // 孔口标高，米（海拔）
  layers: BoreholeLayer[];
}

export type IssueLevel = 'error' | 'warning';

export interface BoreholeIssue {
  boreholeId: string;
  boreholeName: string;
  level: IssueLevel;
  code:
    | 'duplicate_xy'
    | 'layer_gap'
    | 'layer_overlap'
    | 'depth_inversion'
    | 'unknown_lithology'
    | 'empty_borehole';
  message: string;
}

export interface ValidationReport {
  issues: BoreholeIssue[];
  /** 存在 error 的钻孔 id，用于列表标红 */
  errorBoreholeIds: string[];
}

/** 建模参数 */
export interface ModelParams {
  gridSize: number; // 体素网格边长 N（N³）
  surfaceResolution: number; // 层位面二维网格边长 S（S×S）
  method: InterpMethod;
  idwPower: number;
  idwNeighbors: number;
  krigingRange: number; // 变差程（米）
  krigingSill: number;
  baseDepthBelowMin: number; // 最低层位之下模型再延伸的厚度（米）
  topBuffer: number; // 模型顶在最高孔口之上的余量（米）
  pinchTolerance: number; // 尖灭厚度容差（米），小于该厚度合并为尖灭
}

export const DEFAULT_PARAMS: ModelParams = {
  gridSize: 256,
  surfaceResolution: 96,
  method: 'idw',
  idwPower: 2,
  idwNeighbors: 12,
  krigingRange: 120,
  krigingSill: 1,
  baseDepthBelowMin: 6,
  topBuffer: 2,
  pinchTolerance: 0.4,
};

/** 模型包围盒（工程坐标系，米） */
export interface ModelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** 单个层位面：top[k]/bottom[k] 为行优先 S×S 标高（米），NaN 表示该网格单元缺失（尖灭） */
export interface HorizonSurfaces {
  unitIndex: string[]; // 有序地层层序（自上而下）
  top: Float64Array[]; // 每层顶面标高
  bottom: Float64Array[]; // 每层底面标高
  ground: Float64Array; // 地表标高层位面
  resolution: number;
  bounds: ModelBounds;
}

export interface VoxelModel {
  /** 体素岩性 id：长度 N³，行优先，索引 = ix + iy*N + iz*N*N，'' 表示空体素 */
  voxels: Uint8Array;
  /** voxels 数值 -> 岩性 id 的映射（0 保留为空） */
  lithologyIndex: string[];
  gridSize: number;
  bounds: ModelBounds;
  surfaces: HorizonSurfaces;
  params: ModelParams;
  createdAt: number;
  buildMs: number;
  surfaceMs: number;
  voxelMs: number;
  consistencyMismatches: number;
  backend: 'webgpu' | 'cpu';
}

/** 断层（俯视走向线段 + 垂直断距，米；正断层，downthrowSide 侧下降） */
export interface Fault {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  throw: number;
  downthrowSide: 1 | -1;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bounds: ModelBounds | null;
  boreholes: Borehole[];
  lithologies: Lithology[];
  fault: Fault | null;
  params: ModelParams;
  validation: ValidationReport | null;
  model: VoxelModel | null;
}

/** 剖面折线顶点（俯视平面坐标） */
export interface SectionPoint {
  x: number;
  y: number;
}

export interface SectionLayerSegment {
  lithologyId: string;
  startDistance: number;
  endDistance: number;
  topElev: number;
  bottomElev: number;
}

export interface SectionBoreholeHit {
  boreholeId: string;
  name: string;
  distance: number;
  offset: number; // 偏离折线的垂直距离（带符号，米）
  groundElev: number;
  layers: BoreholeLayer[];
  x: number;
  y: number;
}

export interface SectionResult {
  polyline: SectionPoint[];
  totalLength: number;
  verticalExaggeration: number;
  /** 沿折线等间距采样得到的地层柱，采样点间距 = 模型体素水平尺寸 */
  samples: {
    distance: number;
    x: number;
    y: number;
    groundElev: number;
    /** 自顶向下列出 (lithologyId, topElev, bottomElev)，尖灭/透镜体自动处理 */
    units: { lithologyId: string; top: number; bottom: number }[];
  }[];
  boreholeHits: SectionBoreholeHit[];
  bounds: ModelBounds;
}
