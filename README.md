# STRAT3D · 浏览器三维地层建模工具

纯 **TypeScript + WebGPU** 实现的勘察钻孔三维地层建模工具，运行在浏览器内，零后端依赖，数据存本地 IndexedDB。

## 功能

| 模块 | 能力 |
| --- | --- |
| 项目列表 | 新建 / 删除 / 复制项目，JSON 导出给他人、导入他人项目 |
| 钻孔数据 | CSV 导入（支持中英文列名、引号转义、BOM）；自动校验坐标重复、深度倒挂、层位重叠/空隙、未知岩性，问题钻孔标红 |
| 建模参数 | IDW / 普通克里金（球状变差）/ 最近邻三种插值可切换；网格边长、层位分辨率、尖灭容差等可调；岩性颜色管理 |
| 三维视图 | WebGPU compute shader 体素化 + 片元 DDA 光线步进；轨道旋转/平移/缩放；每层独立显隐与透明度；三向剖切盒，切口自动封面 |
| 剖面 | 俯视平面图绘制折线切剖面；走廊内钻孔按里程投影；垂直夸张可调；一键导出高清 PNG |

### 关键地质约束

- **防插穿**：逐网格单元自上而下做顺序钳制，层顶不超过上一层底，透镜体缺失时上下层自动贴合。
- **尖灭 / 透镜体**：存在指示场（最近邻分类）+ 样本控制半径，超出钻孔控制范围自动尖灭，厚度小于容差合并。
- **断层**：插值时启用断层阻隔线，断层两侧钻孔不互相参与插值，保留断距。

## 性能基准

200 孔、256³（1677 万体素）端到端重算 **约 2 秒**（目标 < 5 秒，NVIDIA Ampere + D3D11 实测）。
体素化在 compute shader 执行，不阻塞主线程；不支持 WebGPU 时自动回退 CPU 分类器与 2D 切片视图。
每次 GPU 建模后自动与 CPU 参考实现逐体素比对，保证两端结果一致。

## 技术结构

```
src/
  lib/            纯函数核心（可单测、不依赖 DOM/WebGPU）
    csv.ts            CSV 解析与导出
    validation.ts     钻孔规则校验
    interpolation.ts  IDW / 克里金 / 最近邻 + 断层阻隔
    stratigraphy.ts   层序推断、层位面构建、防插穿钳制、双线性采样
    voxelize-cpu.ts   CPU 体素分类（GPU 的参考实现与回退）
    section.ts        折线剖面生成
    build-model.ts    建模编排与 GPU/CPU 一致性校验
    demo-data.ts      含断层/尖灭/透镜体的 200 孔合成数据
    db.ts             IndexedDB 持久化与项目 JSON 导入导出
  render/
    voxelize.wgsl     体素化 compute shader
    raymarch.wgsl     DDA 光线步进渲染（剖切、半透明、切口封面）
    gpu-engine.ts     WebGPU 引擎、离屏截帧、引擎单例
    camera.ts         轨道相机与矩阵
  ui/pages/       五个页面
test/            Vitest 单元测试（30 个，含 256³ 性能基准）
scripts/         演示数据生成、E2E 与视觉验证脚本
```

## 常用命令

```bash
npm install
npm run dev        # 启动开发服务器
npm test           # 单元测试（含性能基准）
npm run build      # 类型检查 + 生产构建
npm run gen:data   # 重新生成 public/data 下的演示 CSV
```

## CSV 格式

```
borehole_id,name,x,y,ground_elev,lithology_id,from_depth,to_depth
BH001,1号孔,100,200,45.0,FILL,0,2.5
BH001,1号孔,100,200,45.0,CLAY,2.5,8
```

一个钻孔多行，每行一个分层；`from_depth`/`to_depth` 为自孔口向下的深度（米）。
岩性表在首次导入时按 `lithology_id` 自动建立，可在建模参数页改颜色与名称。

## 浏览器要求

需支持 WebGPU（Chrome/Edge 113+ 等）。无 WebGPU 环境自动降级为 CPU 体素分类 + 二维切片视图，建模与剖面功能不受影响。
