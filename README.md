# OpenCloth

WebGPU 服装制版与试衣软件：画版型、缝合、自动着装、实时布料模拟，并把服装导出为模型或图片。无需安装，用支持 WebGPU 的浏览器打开即可使用。

## 项目简介

- **2D 制版**：Canvas2D 工作台，可手绘版片轮廓与内部线，做插入点、断点、圆角、分割合并、镜像、等距内部线等结构编辑；内置 T 恤、衬衫、卫衣、长裤、短裤、裙子、连衣裙参数化模板。
- **生产标记**：印花、明线、辅料（纽扣 / 气眼 / 铆钉 / 按扣）可直接标在版片上，并进入 3D 与导出文件。
- **缝合与着装**：缝合工具支持区间、对位点与缩缝，一键自动着装，把版片穿到模特身上。
- **GPU 布料模拟**：自研 WebGPU compute shader 的 XPBD 求解器，支持自碰撞、碰撞层、多层结构、动态合身采样与软体胸腹。
- **材质与渲染**：PBR + Sheen 织物材质、针织组织、四类面料贴图、多光源与 HDRI；光栅化与 WebGPU 光线追踪、实体 / UV / 法线填充、布料线框、简模、围度线与关节骨架辅助视图，另有合身 / 应变 / 压力热图等分析视图。
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
| `npm run test:e2e` | Playwright 冒烟用例（需本机 Chrome） |
| `npm run lint` | ESLint |
| `npm run typecheck` | 类型检查 |
| `npm run arch:report` | 输出依赖矩阵、循环与分层违例 |
| `npm run arch:check` | 检查分层、环、门面、文件规模与文件结构（CI 必过，含 `style:check`） |
| `npm run style:report` | 报告文件结构问题与跨文件常量重名 |
| `npm run style:check` | 只检查文件结构：import 分块、成员顺序、barrel 纯度 |

## 离线预览工具

`src/tools/` 是 Node 端离线工具，不参与浏览器运行与构建，用于在无 WebGPU 的环境检查平铺、着装与缝合结果。入口 `src/tools/clothPreview.ts` 用 CPU 软光栅输出四视角 PNG，并打印人体尺寸、裁片包围盒与缝线间隙。`vite-node` 随 `vitest` 安装，在项目根目录运行：

```bash
npx --no-install vite-node src/tools/clothPreview.ts --template=hoodie --stage=wrapped --out=.preview/hoodie-wrapped.png --width=330
```

| 参数 | 说明 |
| --- | --- |
| `--template` | 版型 key，对应 `assets/patterns/*.ocpat`，如 `hoodie`、`dress`、`shirt`；默认取排序后的首个模板 |
| `--stage` | `flat`（平铺，默认）、`wrapped`（披到人体）、`sewn`（缝合收敛） |
| `--out` | 输出路径，默认 `.preview/<template>-<stage>.png` |
| `--width` | 单视角像素宽度，默认 330；成品宽度为其 4 倍、高度固定 620 |

平铺由 `flatLayout.ts` 与 `garment` 的包裹、缝合收敛实现；人体数据、绘制与 PNG 写入分别来自 `makehumanData.ts`、`softCanvas.ts`、`png.ts`。参数与输出路径相对当前工作目录，`.preview/` 下的产物由 `.gitignore` 忽略。

## 目录结构

```
src/
  base/      公共层：数学、几何、ID、文本、时间、单位、平台能力与端口类型（零业务依赖）
  model/     领域数据契约、默认值、校验与场景配置
  pattern/   版型几何、模板、放码
  garment/   着装：包裹区间、3D 摆位、层序与缝合收敛
  scene/     派生层：网格缓存、高度视图、人体轮廓
  production/ 生产数据：BOM、排料、POM、技术包
  analysis/  合身 / 应变 / 压力的纯计算
  sim/       WebGPU 布料求解：common 契约 / particles 粒子化输入与查询 / device 设备 / solver 编排
  render/    WebGPU 渲染器与设备上下文、场景层与场景槽位、渲染通道、光栅与光追、材质与热图
  avatar/    模特参数、姿态与碰撞体
  io/        序列化 codec、导入导出 exporters/import、本地存储 storage、DXF、帧采样 frames
  runtime/   应用编排：GarmentEngine 与构建 / 仿真 / 渲染流水线
  app/       用例与服务：工程存取、场景服务、模板目录
  commands/  编辑命令与撤销
  store/     zustand 应用状态
  ui/        React 界面、2D/3D 视口、菜单
  api/       window.opencloth 自动化门面
  tools/     独立 Node CLI 工具
scripts/     架构守卫、基线与工程脚本
test/        核心算法单元测试（几何、求解、排料、放码、着装、蒙皮）
e2e/         Playwright 冒烟用例
assets/      环境贴图、图标、降噪权重与 MakeHuman 人体数据
```

系统架构见 [docs/系统架构.md](docs/系统架构.md)，渲染层见 [docs/渲染架构.md](docs/渲染架构.md)，仿真层见 [docs/仿真架构.md](docs/仿真架构.md)，代码规范见 [docs/代码规范.md](docs/代码规范.md)，注释约定见 [AGENTS.md](AGENTS.md)。

## 版型文件

模板库扫描 `assets/patterns/`，把目录里的每个 `.ocpat` 文件读成一个模板选项，没有硬编码的清单。
新增、删除、改名文件都不需要改代码：开发时刷新即可看到变化，发布版需重新构建。这些文件在构建时
通过 `vite.config.ts` 的 raw 虚拟模块读进 JS，所以站点构建（不复制 publicDir）也能用。
单个文件解析失败只跳过它并在控制台报错，不影响其它版型和应用启动。
也可以从「素材库 → 版型 → 我的」的「导入」或「文件 → 导入」添加本机文件，导入的版型存在浏览器本地，
可随时移除。在编辑器里画好版片后，用「另存」把当前工程导出成同样格式的文件。

```json
{
  "key": "my-jacket",
  "name": "我的夹克",
  "summary": "前片 · 后片 · 袖",
  "params": { "chestCm": 96 },
  "pattern": { "points": {}, "edges": {}, "panels": {}, "seams": {} }
}
```

- `key` 全库唯一；导入文件不能覆盖默认文件夹里的版型，同名 key 会覆盖已有的「我的版型」。
- `order` 决定模板在列表中的位置，缺省值的文件排在最后并按文件名排序；文件名本身不参与标识，可自由重命名。
- `pattern` 是工程的 `Pattern` 结构（厘米坐标）：点、边、版片、缝合、省道、内部线、辅料标记等。
  缺少的集合会补空，版片缺省字段会用默认值补齐，再经过拓扑校验。
- 每个版片建议带 `drape`（包裹信息）并配好 `seams`，否则应用后只能平铺、不会自动缝合；解析时会给出提示。
- `params` 只记录打版时的尺寸，不参与生成；多尺码请用工程里的尺码表与放码。
- 文件里不需要图标：素材库会读取版型，按本机模特模拟 120 帧待布料稳定后渲染一张缩略图
  （只画服装、不画人体），所以新增或改动文件后图标自动更新。
- 应用时所有实体 ID 会重新生成、`fabricId` 会改成工程当前面料，所以同一版型可以反复「添加」而不冲突。
- `.ocpat` 与工程文件 `.ocproj` 都是标准 JSON 文本，用专属后缀区分用途。打开工程只接受
  `.ocproj`，导入版型和默认文件夹扫描只接受 `.ocpat`。

解析入口是 `src/io/codec/patternFile.ts`，默认目录清单由 `src/app/assembly/patternCatalog.ts` 给出，注册中心是 `src/store/templateLibrary.ts`。

## 模特

模特由 MakeHuman 基础网格实时生成：性别、年龄（1–90 岁）、肌肉、体重决定体型，身高做整体缩放，
胸围/腰围/臀围再按截面实测求解，衣身环绕、2D 参考与碰撞都读取同一次实测结果。基础网格与目标
数据来自 [makehuman-data](https://www.npmjs.com/package/makehuman-data) 0.0.2（MakeHuman 1.1 basemesh，
CC0），以二进制形式存放在 `assets/makehuman/`（由 Vite 的 publicDir 提供给站点，发布时由 Storage
分发）：年龄形态 8 行（男女 × 四个年龄段，三种族平均）、肌肉与体重增量 72 行、围度目标 6 行，每行按字节量化。
版本、偏移与校验哈希见 `assets/makehuman/manifest.json`；换版本时临时安装该包，按
`src/avatar/makehuman/data.ts` 的解析格式重新打包。

## 素材署名

环境贴图与 OIDN 降噪权重的来源与许可证各不相同，逐项见 [assets/env/ATTRIBUTION.md](assets/env/ATTRIBUTION.md)、[assets/weights/ATTRIBUTION.md](assets/weights/ATTRIBUTION.md)。MakeHuman 官方将 1.1 basemesh 以 CC0 发布，但 `makehuman-data` 包的 readme 声明继承 AGPLv3 衍生许可，两处口径不一致，商用前请自行核实。
