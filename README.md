# OpenCloth

WebGPU 服装制版与试衣软件：画版型、缝合、自动着装、实时布料模拟，并把服装导出为模型或图片。无需安装，用支持 WebGPU 的浏览器打开即可使用。

## 项目简介

- **2D 制版**：Canvas2D 工作台，可手绘版片轮廓与内部线，做插入点、断点、圆角、分割合并、镜像、等距内部线等结构编辑；内置七张参数化模板（T 恤、衬衫、裙子、连衣裙、袖子、托特包、鞋履）。
- **生产标记**：印花、明线、辅料（纽扣 / 气眼 / 铆钉 / 按扣）可直接标在版片上，并进入 3D 与导出文件。
- **缝合与着装**：缝合工具支持区间、对位点与缩缝，一键自动着装，把版片穿到模特身上。
- **GPU 布料模拟**：自研 WebGPU compute shader 的 XPBD 求解器，支持自碰撞、碰撞层、多层结构、动态合身采样与软体胸腹。
- **材质与渲染**：PBR + Sheen 织物材质、针织组织、四类面料贴图、多光源与 HDRI；光栅化与 WebGPU 光线追踪两种显示模式，另有合身 / 应变 / 压力热图等分析视图。
- **生产输出**：DXF / SVG / PDF 版型、排料图、Gerber、工艺单、物料清单，服装可导出 GLB / OBJ / FBX / USDA。
- **工程与协作**：`.ocproj.json` 工程文件、本地版本历史与审版评论、素材库、PLM 导出与 Webhook。
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

## 目录结构

```
src/
  core/     数据模型、命令与撤销、工程编解码
  pattern/  版型几何、版片网格、POM 与排料
  sim/      WebGPU 布料求解与碰撞
  render/   光栅化与光线追踪渲染
  avatar/   模特与姿态
  io/       导入导出（DXF / PDF / GLB / 工程文件 / IndexedDB）
  ui/       界面层（菜单、面板、2D/3D 视口）
  store/    zustand 状态
test/       单元测试
e2e/        Playwright 用例
assets/     内置模特、环境贴图、图标与降噪权重
```

代码规范见 [docs/代码规范.md](docs/代码规范.md)，注释约定见 [AGENTS.md](AGENTS.md)。

## 素材署名

内置模特、环境贴图与 OIDN 降噪权重的来源与许可证各不相同，逐项见 [assets/models/ATTRIBUTION.md](assets/models/ATTRIBUTION.md)、[assets/env/ATTRIBUTION.md](assets/env/ATTRIBUTION.md)、[assets/weights/ATTRIBUTION.md](assets/weights/ATTRIBUTION.md)。

> `human-body-pro.glb` 的再分发授权未确认，公开分发前需替换。
