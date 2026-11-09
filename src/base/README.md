# base — 基础层

L0 公共层，向所有模块提供与业务无关的基础能力。**不 import 任何业务模块，不 import `three` / React / zustand，不直接访问 DOM 全局**（浏览器能力集中在 `platform/`，通过 `ports/` 的接口注入）。

## 子模块

| 模块 | 内容 |
| --- | --- |
| `math` | 标量与角度、`vec2` / `vec3` / `tuple3`、`matrix3`、Euler / 四元数旋转 |
| `geom` | `primitives`（多边形面积、包含、包围盒）、线段 / 射线 / 三角形、网格法线、扁平 xyz 缓冲距离，以及 arc / bezier / offset / polygonBoolean / polyCurve 纯算法 |
| `color` | sRGB 十六进制到线性 RGB 的空间换算 |
| `id` | `genId` 与可注入时钟的 `createIdFactory` |
| `text` | CSV 转义与表格、时间格式化 |
| `time` | `timeAsync`、debounce、throttle |
| `format` | `roundTo`、`formatPercent` |
| `units` | cm / m / mm 换算常量与函数 |
| `platform` | 浏览器文件下载（统一延迟 revoke）、文件读取、资源 URL 路由、共享图片解码缓存 |
| `result` | `Result`、`assert`、`invariant`、`deepClone` |
| `events` | `createSignal`、`Disposable`、`disposeAll` |
| `random` | 可复现随机源 `seededRandom` |
| `ports` | 纯类型端口：`AssetStore`、`KeyValueStorage`、`Clock`、`Logger` |

## 约定

- 每个子模块以 `index.ts` 为门面；调用方写 `@/base/<子模块>`，不设全量总出口。
- 纯代数（标量、角度、向量、元组、矩阵、旋转）放 `math`；依赖点、线、面几何关系的算法（线段、射线、三角形、法线、缓冲、曲线、多边形）放 `geom`；颜色空间换算放 `color`。业务层不再保留同名数学辅助函数。
- `geom` 中 `signedPolygonArea`（有符号，`ensureCCW` 依赖其符号）与 `polygonArea`（绝对值）是两个不同语义的函数，不要合并。
- 新公共函数必须先在 `test/base/` 补单测，并确认没有引入业务依赖（`npm run arch:check` 会检查 `baseForbidden`）。
- 几何类型经 `model/types/geometry.ts` 再导出：`Vec2` / `Vec3` 来自 `@/base/math`，`ArcGeom` 来自 `@/base/geom/arc`；这是模型类型门面，调用方也可直接使用 `@/base/math` 与 `@/base/geom`。
