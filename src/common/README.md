# common — 公共层

L0 公共层，向所有模块提供与业务无关的基础能力。**不 import 任何业务模块，不 import `three` / React / zustand，不直接访问 DOM 全局**（浏览器能力集中在 `platform/`，通过 `ports/` 的接口注入）。

## 子模块

| 模块 | 内容 |
| --- | --- |
| `math` | clamp、lerp、角度换算、三维距离、`distance3At`（粒子缓冲索引距离） |
| `geom` | `primitives`（Vec2/Vec3/ArcGeom、向量运算、有符号/无符号面积、包围盒），以及 arc / bezier / offset / polygonBoolean / polyCurve / panelSurface 纯算法 |
| `id` | `genId` 与可注入时钟的 `createIdFactory` |
| `text` | CSV 转义与表格、时间格式化 |
| `time` | `timeAsync`、debounce、throttle |
| `format` | `roundTo`、`formatPercent` |
| `units` | cm / m / mm 换算常量与函数 |
| `platform` | 浏览器文件下载（统一延迟 revoke）、文件读取、资源 URL 路由 |
| `result` | `Result`、`assert`、`invariant`、`deepClone` |
| `events` | `createSignal`、`Disposable`、`disposeAll` |
| `random` | 可复现随机源 `seededRandom` |
| `ports` | 纯类型端口：`GpuDeviceProvider`、`AssetStore`、`KeyValueStorage`、`Clock`、`Logger` |

## 约定

- 每个子模块以 `index.ts` 为门面；调用方写 `@/common/<子模块>`，不设全量总出口。
- `geom` 中 `signedPolygonArea`（有符号，`ensureCCW` 依赖其符号）与 `polygonArea`（绝对值）是两个不同语义的函数，不要合并。
- 新公共函数必须先在 `test/common/` 补单测，并确认没有引入业务依赖（`npm run arch:check` 会检查 `commonForbidden`）。
- 几何类型仍经 `model/types/geometry.ts` 再导出 `Vec2` / `Vec3` / `ArcGeom`；这是模型类型门面，调用方也可直接使用 `@/common/geom`。
