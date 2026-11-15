# OpenCloth

WebGPU 服装制版与试衣软件：画版型、缝合、自动着装、实时布料模拟，并把服装导出为模型或图片。无需安装，用支持 WebGPU 的浏览器打开即可使用。

## 项目简介

- **2D 制版**：Canvas2D 工作台，可手绘版片轮廓与内部线，做插入点、断点、圆角、分割合并、镜像、等距内部线等结构编辑；内置五张参数化模板（T 恤、衬衫、卫衣、裙子、连衣裙）。
- **生产标记**：印花、明线、辅料（纽扣 / 气眼 / 铆钉 / 按扣）可直接标在版片上，并进入 3D 与导出文件。
- **缝合与着装**：缝合工具支持区间、对位点与缩缝，一键自动着装，把版片穿到模特身上。
- **GPU 布料模拟**：自研 WebGPU compute shader 的 XPBD 求解器，支持自碰撞、碰撞层、多层结构、动态合身采样与软体胸腹。
- **材质与渲染**：PBR + Sheen 织物材质、针织组织、四类面料贴图、多光源与 HDRI；光栅化与 WebGPU 光线追踪、实体 / UV / 法线填充、布料线框与简模辅助视图，另有合身 / 应变 / 压力热图等分析视图。
- **生产输出**：DXF / SVG / PDF 版型、排料图、Gerber、工艺单、物料清单，服装可导出 GLB / OBJ / FBX / USDA。
- **工程与协作**：`.ocproj` 工程文件、本地版本历史与审版评论、素材库、PLM 导出与 Webhook。
- **移动端**：触摸设备自动切换为单视口手机外壳，可在手机上试衣调参。

## 环境要求

| 项 | 要求 |
| --- | --- |
| 浏览器 | Chrome 113+ / Edge 113+（需支持 WebGPU）；手机为 Android 12+ 的 Chrome 121+ 或 iOS 26 的 Safari 26 |
| Node.js | 20 以上（仅本地开发需要） |
| npm | 10 以上 |
| 显卡 | 光栅化可用集显；光线追踪建议独显 |

打开后提示“当前浏览器不支持 WebGPU”时，先更新浏览器与显卡驱动，或在 `chrome://gpu` 查看状态。

## 运行

```bash
npm install
npm run dev
```

默认地址 `http://localhost:5173`。首次进入会载入起步工程（女性模特 + 环绕体外的 T 恤四片），按 `Ctrl+D` 或 3D 窗格聚焦时按 `空格` 自动着装。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run test` | 单元测试（watch） |
| `npm run test:run` | 单元测试（跑一遍） |
| `npm run test:e2e` | Playwright 端到端测试（需本机 Chrome） |
| `npm run lint` | ESLint |
| `npm run typecheck` | 类型检查 |
| `npm run perf:gate` | 大面积布料的性能门禁 |
| `npm run arch:report` | 输出依赖矩阵、循环与分层违例 |
| `npm run arch:check` | 检查分层、环、门面与文件规模（CI 必过） |

## 目录结构

```
src/
  common/    公共层：数学、几何、ID、文本、时间、单位、平台能力与端口类型（零业务依赖）
  model/     领域数据契约、默认值、校验与场景配置 schema
  pattern/   版型几何、模板、排料、放码、POM
  analysis/  合身 / 应变 / 压力的纯计算
  sim/       WebGPU 布料求解与碰撞
  render/    WebGPU 渲染器与设备上下文、场景层与场景槽位、渲染通道、光栅与光追、材质与热图
  avatar/    模特参数、姿态与碰撞体
  io/        序列化 serialization、导入导出 exporters/importers、本地存储 storage、DXF/PDF
  runtime/   应用编排：GarmentEngine 与构建 / 仿真 / 渲染流水线
  commands/  编辑命令与撤销
  store/     zustand 应用状态
  ui/        React 界面、2D/3D 视口、菜单
  api/       window.opencloth 自动化门面
  tools/     独立 Node CLI 工具
scripts/     架构守卫、基线与工程脚本
test/        单元测试（test/architecture 为架构约束）
e2e/         Playwright 用例
assets/      环境贴图、图标、降噪权重与 MakeHuman 人体数据
```

系统架构见 [docs/系统架构.md](docs/系统架构.md)，代码规范见 [docs/代码规范.md](docs/代码规范.md)，注释约定见 [AGENTS.md](AGENTS.md)。

## 版型文件

模板库里的每个选项都来自一个 `.ocpat` 文件，不再由代码生成。内置版型放在
`assets/patterns/`，与环境图、图标等素材同级。往这个目录放入新文件，开发时刷新即可看到新选项，
无需改代码。这些文件在构建时通过 `vite.config.ts` 的 raw 虚拟模块读进 JS，所以站点构建（不复制
publicDir）也能用；发布版改动文件后需重新构建。
也可以从「素材库 → 版型」的「导入版型」或「文件 → 导入」添加本机文件，导入的版型存在浏览器本地，
可随时移除。在编辑器里画好版片后，用「另存当前版型」把当前工程导出成同样格式的文件。

```json
{
  "key": "my-jacket",
  "name": "我的夹克",
  "summary": "前片 · 后片 · 袖",
  "icon": "t-shirt",
  "params": { "chestCm": 96 },
  "pattern": { "points": {}, "edges": {}, "panels": {}, "seams": {} }
}
```

- `key` 全库唯一；导入文件不能覆盖内置或文件夹版型，同名 key 会覆盖已有的「我的版型」。
- `pattern` 是工程的 `Pattern` 结构（厘米坐标）：点、边、版片、缝合、省道、内部线、辅料标记等。
  缺少的集合会补空，版片缺省字段会用默认值补齐，再经过拓扑校验。
- 每个版片建议带 `drape`（包裹信息）并配好 `seams`，否则应用后只能平铺、不会自动缝合；解析时会给出提示。
- `params` 只记录打版时的尺寸，不参与生成；多尺码请用工程里的尺码表与放码。
- `icon` 可选 `t-shirt` / `shirt` / `hoodie` / `dress` / `skirt` / `panel`，缺省为 `panel`。
- 应用时所有实体 ID 会重新生成、`fabricId` 会改成工程当前面料，所以同一版型可以反复「添加」而不冲突。
- `.ocpat` 与工程文件 `.ocproj` 都是标准 JSON 文本，用专属后缀区分用途。打开工程只接受
  `.ocproj`，导入版型和默认文件夹扫描只接受 `.ocpat`。

解析入口是 `src/pattern/template/patternFile.ts`，注册中心是 `src/store/templateLibrary.ts`。

## 模特

模特由 MakeHuman 基础网格实时生成：性别、年龄（1–90 岁）、肌肉、体重决定体型，身高做整体缩放，
胸围/腰围/臀围再按截面实测求解，衣身环绕、2D 参考与碰撞都读取同一次实测结果。基础网格与目标
数据来自 [makehuman-data](https://www.npmjs.com/package/makehuman-data)（MakeHuman 1.1 basemesh，
CC0），由 `npm run data:makehuman` 抽取为 `assets/makehuman/` 下的二进制资源（由 Vite 的 publicDir
提供，站点构建改由 Storage 分发）：年龄形态
8 行（男女 × 四个年龄段，三种族平均）、肌肉与体重增量 72 行、围度目标 6 行，每行按字节量化。

## 素材署名

环境贴图与 OIDN 降噪权重的来源与许可证各不相同，逐项见 [assets/env/ATTRIBUTION.md](assets/env/ATTRIBUTION.md)、[assets/weights/ATTRIBUTION.md](assets/weights/ATTRIBUTION.md)。`assets/makehuman/` 下的网格与形变数据由 [makehuman-data](https://www.npmjs.com/package/makehuman-data) 抽取；MakeHuman 官方将 1.1 basemesh 以 CC0 发布，但该 npm 包的 readme 声明继承 AGPLv3 衍生许可，两处口径不一致，商用前请自行核实。
