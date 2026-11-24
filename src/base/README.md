# base — 基础层

L0 公共层，向所有模块提供与业务无关的基础能力。**不 import 任何业务模块，不 import `three` / React / zustand，不直接访问 DOM 全局**（浏览器能力集中在 `platform/`）。

## 子模块

| 模块 | 内容 |
| --- | --- |
| `math` | 标量（含 `roundTo`、`clamp`、`nearlyEqual`）与角度、`vec2` / `vec3` / `tuple3`、`matrix3`、Euler / 四元数旋转 |
| `geom` | `primitives`（多边形面积、包含、包围盒）、线段 / 射线 / 三角形、网格顶点法线与面积、扁平 xyz 缓冲距离，以及 arc / bezier / offset / polygonBoolean / curve（含折线查询与单调插值）纯算法 |
| `color` | sRGB 十六进制到线性 RGB 的空间换算 |
| `units` | cm / m / mm / inch 与面积换算常量与函数（含 `CM_PER_UNIT` 单位到 cm 的换算表） |
| `bytes` | 字节级算法：`crc32`（zip 与 png 共用） |
| `string` | 字符串构造与文本格式化：CSV 转义与表格、扩展名剥离、时间文本 |
| `id` | `genId` 与可注入时钟的 `createIdFactory` |
| `perf` | 帧剖析器 `frameProfiler` 与 `timeAsync` 计时 |
| `platform` | 浏览器文件下载（统一延迟 revoke）、文件读取、资源 URL 路由、共享图片解码缓存 |
| `pdf.ts` | 输出格式原语：PDF 指令拼装、`CM_PT` 换算与路径/文本操作 |

## 命名规则

子模块按**它处理的数据种类**命名，不按「谁在用」命名：

- 数值与几何 → `math` / `geom` / `color` / `units`
- 字节与文本 → `bytes` / `string`
- 输出格式原语 → `pdf.ts`（扁平文件，不进 `index.ts` 总出口）

不满足以下条件时不要新开子模块，并入最接近的数据种类：

1. 有明确的「处理对象」名称，且不与现有模块重叠；
2. 至少被两个层引用，或在本层之外有三个以上调用方（`bytes` 由 `io` 与 `tools` 共用即满足）。
3. 实现不足 20 行且只有一两个函数时，即使满足前两条也优先并入同族模块——`math` / `geom` / `string` / `bytes` 本身就容得下小函数。

历史上被合并掉的模块：`format`（`roundTo` 归 `math`，`formatPercent` 无调用已删）、`result`（`deepClone` 内联到唯一调用方，`Result` 系列无调用已删）、`time`（并入 `perf`）、`text`（改名 `string`，时间格式化本就属文本）、`checksum`（改名扩充为 `bytes`）。

## 约定

- 每个子模块以 `index.ts` 为门面；调用方写 `@/base/<子模块>`，不设全量总出口。`pdf.ts` 是唯一例外，按 `@/base/pdf` 直接引用。
- 纯代数（标量、角度、向量、元组、矩阵、旋转）放 `math`；依赖点、线、面几何关系的算法（线段、射线、三角形、法线、缓冲、曲线、多边形）放 `geom`；颜色空间换算放 `color`。业务层不再保留同名数学辅助函数。
- `geom` 中 `signedPolygonArea`（有符号，`ensureCCW` 依赖其符号）与 `polygonArea`（绝对值）是两个不同语义的函数，不要合并。
- 新公共函数必须先在 `test/base/` 补单测，并确认没有引入业务依赖（`npm run arch:check` 会检查 `baseForbidden`）。
- 几何类型经 `model/types/geometry.ts` 再导出：`Vec2` / `Vec3` 来自 `@/base/math`，`ArcGeom` 来自 `@/base/geom/arc`；这是模型类型门面，调用方也可直接使用 `@/base/math` 与 `@/base/geom`。
- `pdf.ts` 承载「输出格式原语」：它只依赖 `math`，被 `io/exporters` 与 `production/reports` 共用（两层之间不允许深引用，base 是唯一合法共享点）。新增的格式原语必须同样只依赖 `math`，且不含业务字段。
