# IconLibrary

13 个分类、548 枚精选 SVG 图标。**所有图标实体抽取自 npm 包 `lucide-static`（ISC），不是手绘也不是二次描摹**；同一套 24 网格、2px 圆头描边、`currentColor`，深色模式与主题色自动跟随。

已于 2026-11-04 接入上级「图标仓」：`scripts/library.mjs` 在构建时把这 548 枚并入 `dist/`，分类直接进站点的 13 类口径，公开 id 统一加 `lib-` 前缀（`lib-plus`），不会和项目收集的同名图标冲突。改完图标库跑根目录 `npm run build` 即可同步到站点。

配套一个可视化选型页：搜索、分类浏览、打钩多选、全选 / 全不选、一键复制选中清单。

```
open index.html
```

## 目录

```
IconLibrary/
├─ index.html              选型页（数据内联，双击即用，无需服务器）
├─ icons/                  548 个独立 SVG + sprite.svg
│  ├─ base/plus.svg
│  ├─ nav/house.svg
│  └─ sprite.svg           全部图标的 <symbol> 合集
├─ data/
│  ├─ icons.json           元数据 + 内联 SVG（运行时唯一数据源）
│  └─ manifest.json        版本、规格、分类计数
├─ library/
│  ├─ index.mjs            纯 ESM 运行时：检索 / 取图 / 渲染
│  ├─ icons.mjs            自动生成的数据模块
│  └─ icon.css             .il-icon 基础样式
├─ src/
│  ├─ catalog.mjs          唯一人工数据源：选型、中文名、关键词
│  ├─ build.mjs            抽取 + 生成
│  ├─ validate.mjs         自动校验
│  └─ template.html        选型页模板
├─ licenses/lucide.txt     Lucide 原始许可证
└─ package.json
```

## 规格

| 项 | 值 |
| --- | --- |
| 网格 | `viewBox="0 0 24 24"` |
| 描边 | `stroke-width="2"`，`round` 端点与转角 |
| 颜色 | `stroke="currentColor"`，`fill="none"` |
| 分类 | 16，每类 12 枚核心 + 17–24 枚增补 |
| 总量 | 548（核心 192 / 增补 356） |

增补图标是为了覆盖长尾场景（如 `chevron-down`、`file-json`、`thermometer`）。`tier` 字段可区分；不需要就直接过滤掉。

## 在项目里用

**1）内联（推荐，最可控）**

```js
import { renderIcon } from "./IconLibrary/library/index.mjs";

button.innerHTML = renderIcon("plus", { size: 16, className: "btn-icon" });
```

输出即 `<svg class="btn-icon il-icon il-plus" …>`，颜色跟着父级 `color` 走。

**2）按需取字符串 / 文件**

```js
import { getIcon, svgOf } from "./IconLibrary/library/index.mjs";

getIcon("plus");        // { id, name, category, keywords, path, svg, … }
svgOf("plus");          // '<svg …>'
getIcon("plus").path;   // 'icons/base/plus.svg'
```

**3）精灵图（整站只发一次请求）**

```html
<svg class="il-icon"><use href="/icons/sprite.svg#il-plus"/></svg>
```

**4）CSS 背景 / `<img>`**

```js
import { toDataUri } from "./IconLibrary/library/index.mjs";
el.style.backgroundImage = `url("${toDataUri("plus")}")`;
```

**5）React**

```jsx
import { renderIcon } from "@/IconLibrary/library/index.mjs";

export const Icon = ({ name, size = 16, ...rest }) => (
  <span {...rest} dangerouslySetInnerHTML={{ __html: renderIcon(name, { size }) }} />
);
```

`stroke="currentColor"` 意味着深浅色模式、hover 变色、按钮禁用态都不需要额外处理。

## 元数据

`data/icons.json` 每条的字段：

| 字段 | 说明 | 例 |
| --- | --- | --- |
| `id` | 英文 ID，全局唯一 = 文件名 | `trash-2` |
| `name` | 中文名 | `删除` |
| `category` / `categoryId` | 分类中文名 / slug | `基础操作` / `base` |
| `tier` | `core` 或 `extra` | `core` |
| `source` / `sourceLabel` / `sourceVersion` | 来源与版本 | `lucide` / `Lucide` / `1.67.0` |
| `license` | 许可证 | `ISC` |
| `path` | SVG 文件相对路径 | `icons/base/trash-2.svg` |
| `keywords` | 中英文搜索词，≥ 3 个 | `["移除","清空","delete"]` |
| `svg` | 规范化后的完整 SVG 字符串 | `<svg …>` |

## 检索

```js
import { searchIcons } from "./IconLibrary/library/index.mjs";

searchIcons("支付");                       // 中文
searchIcons("trash");                      // 英文 id
searchIcons("订单 物流", { category: "commerce" });  // 空格 = AND
searchIcons("", { tier: "core", limit: 12 });
```

1–2 个字母的英文词按整词匹配，避免 `ai` 命中 `email`。

## 加图标

1. 在 `src/catalog.mjs` 里按分类加一行：`c("icon-id", "中文名", ["关键词", …])`。
2. `npm run build`（从 `node_modules/lucide-static/icons/<id>.svg` 抽取，找不到会直接报错）。
3. `npm run validate`。

选型页会同步更新，不用另外改 HTML。

## 校验

`npm run validate` 实际检查：

- 13 个分类，每类 ≥ 12 枚，总量 ≥ 192
- ID 全局唯一、kebab-case、中文名与关键词齐全
- 每个 `path` 指向的文件存在，且路径与分类一致
- SVG 根节点为 24 网格 / 2px / `fill="none"` / `stroke="currentColor"`，无硬编码颜色、无脚本
- `path d` 以 `M` 开头、字符合法、无 `NaN`
- 内联 SVG 与文件一一对应
- 不同 ID 之间没有完全同形的重复图形
- `sprite.svg` 覆盖全部图标
- `index.html` 内联全部图标且包含选择 / 复制功能

任一失败退出码为 1，可直接挂 CI。

## 来源与许可

| 来源 | 数量 | 许可 |
| --- | --- | --- |
| [Lucide](https://lucide.dev) · `lucide-static@1.67.0` | 548 | ISC（见 `licenses/lucide.txt`） |

- 图标文件保留 `<!-- IconLibrary · <id> · Lucide <version> · ISC -->` 头注，分发时请连同 `licenses/` 一起带走。
- Lucide 自身部分图形来自 [Feather](https://feathericons.com)（MIT），许可证原文包含在上面的 LICENSE 中。
- **没有混入 Tabler / Phosphor / Font Awesome。** 这几套的圆角半径、端点处理和视觉重量与 Lucide 不一致，混排会出现"同一排里有的偏硬有的偏圆"。确实缺图时，优先在 Lucide 里找同义项；必须引入外部图标时，在 `catalog.mjs` 里显式写 `source` / `license`，并在选型页里单独标注，不要静默混入。
- 品牌标志（微信、支付宝、GitHub 等）不在本库范围：它们各有商标规范，且不适合统一成 currentColor 描边。

## 选型流程

选型页里打钩 → 底部「复制选中清单」得到：

```
基础操作 / 新增 / plus
商业金融 / 银行卡 / credit-card
```

直接把这段贴回来即可按分类、中文名、ID 落到目标项目。也可以「复制选中 JSON」拿到带 `categoryId` / `tier` 的结构化结果。选择状态存在 `localStorage`，刷新不丢。
