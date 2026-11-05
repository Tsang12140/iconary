# Iconary · 图标仓

> 让 AI 写页面时，不必再画字符箭头。

一个**人工筛过**、**能直接被 AI 调取**的 SVG 图标库。名字取自 **Icon + Library**，中文仍叫「图标仓」。

[在线使用](https://ai.dnbox.cn/icon) · [给 agent 的 skill](https://ai.dnbox.cn/icon/api.php?action=skill) · [MIT License](LICENSE)

![icons](https://img.shields.io/badge/icons-920-2f6b50) ![scenes](https://img.shields.io/badge/scenes-13-6f9fa2) ![license](https://img.shields.io/badge/license-MIT-2f6b50) ![php](https://img.shields.io/badge/PHP-single%20file-777bb4)

<a href="https://ai.dnbox.cn/icon"><img src="docs/screenshot.png" alt="Iconary 首页：给 AI 用的图标，人工筛过" width="880"></a>

## 为什么做这个

AI 生成的界面，最容易翻车的往往不是布局，是图标：

- 字符画箭头 `->`、临时拼的 SVG、粗细和圆角各不一样；
- 直接引入整套图标库，命名不贴中文语境，agent 自己找经常找错；
- 想补一枚图标，还要翻几个站、下载、改名、对齐规格。

于是我先把这件事做完了：**先筛，再统一，再让 AI 一把取到。**

## 三个不同

### 1. 不是「生成」，是「筛过」

- 95 枚来自我自己项目、长期在用、逐枚挑出来的公开图标；项目源里另有约 100 枚品牌 / 内部图标，不对外公开；
- 825 枚来自 Lucide，同样逐枚过了一遍，统一成 24×24 线性规格；
- 全部补齐中文名、别名和分类，合计 **920 枚、13 类**；
- 搜索吃中文、英文和别名，`删除`、`trash`、`delete` 都能命中。

不是把一堆图标倒进来就完事，而是每一枚都知道它该在哪个分类、叫什么、别人会怎么搜它。

### 2. AI 友好，不是「有个 API」而已

- 公开接口免登录、GET、带 CORS，一个请求拿结果；
- `search` 返回 id，`svg` 直接给源码，agent 不用解析页面；
- `catalog` 一次拿全量清单，适合建索引；
- 提供 `skills/icon-library/` 和 `?action=skill`，agent 读完就能装成 skill；
- `submitBulk` 支持批量投稿，agent 可以一次交一批，不用人工逐个贴。

### 3. 共创，不是单向仓库

- 人类拖 SVG，agent 调接口，都能提交；
- 投稿进审核，通过后才发布；
- 每条记录标记 `human` / `agent`，来源可追溯；
- 每个指纹每天最多 100 枚、单次最多 50 枚，防止刷库。

你拿走需要的，也欢迎把更好的传回来。互联网共享的余晖，就是这样一点点续上的。

## 怎么筛的

不是把图标倒进来，而是按同一套标准逐枚过：

- 24×24 网格、2px 描边、圆端点、`currentColor`，深浅色主题都能直接用；
- 16px 下仍能认出，不用文字、字母、字符画代替图形；
- 同形只留一枚：构建时合并 **89 组**、吸收 **92 条**重复记录，名称转进别名；
- 每一枚都有中文名、英文名、别名，并且只落一个分类；
- 来源和许可可查：Lucide 部分保留 ISC，项目图标不带源码路径。

投稿走同一套审核，人工和 agent 提交都会标记来源。

## 中文搜索样例

下面这些是线上真实结果，不是预先写死的映射：

| 你搜 | 第一条结果 | 分类 |
| --- | --- | --- |
| 删除 | 删除（`trash`） | 基础操作 |
| 设置 | 设置（`settings`） | 页面导航 |
| 上传 | 上传（`upload`） | 基础操作 |
| 下载 | 下载（`download`） | 基础操作 |
| 搜索 | 搜索（`search`） | 基础操作 |
| 分享 | 分享（`share`） | 基础操作 |
| 通知 | 通知（`bell`） | 人际沟通 |
| 日历 | 日历日程（`calendar-days`） | 时间任务 |
| 报表 | 财务报告（`lib-file-chart-column`） | 商业金融 |
| 文件夹 | 打开文件夹（`folder-open`） | 文件知识 |
| 发票 | 发票（`lib-file-badge`） | 商业金融 |
| 指纹 | 指纹（`lib-fingerprint`） | 人际沟通 |
| 夜间模式 | 月亮（`up-20261104-9b06d2`） | 状态反馈 |
| 箭头 | 向左箭头（`arrow-left`） | 页面导航 |
| 用户 | 用户（`user`） | 人际沟通 |
| 刷新 | 刷新（`refresh`） | 基础操作 |
| 支付 | 银行卡（`credit-card`） | 商业金融 |
| 位置 | 定位（`map-pin`） | 地图出行 |

## 对比

| | AI 临时生成 | 直接塞一套图标库 | Iconary |
| --- | --- | --- | --- |
| 图形 | 字符箭头、风格飘 | 风格统一但选择成本高 | 统一 24px 线性，逐枚筛过 |
| 找图 | 让模型猜 | 翻文档、猜命名 | 一个 GET，中英文别名都能搜 |
| 接入 | 生成代码，不可控 | 依赖、配置、版本 | 免登录接口，或装成 skill |
| 协作 | 无 | 无 | 人和 agent 都能投稿，审核后发布 |

## 30 秒接入

给 agent 的一句话：

> 先读 `https://ai.dnbox.cn/icon/api.php?action=skill`，按里面的说明把图标库接进来；之后用 `search` 找图，用 `svg` 取源码。

直接调：

```bash
# 搜图标
curl "https://ai.dnbox.cn/icon/api.php?action=search&q=删除&limit=5"

# 取 SVG 源码
curl "https://ai.dnbox.cn/icon/api.php?action=svg&id=trash"

# 全量清单
curl "https://ai.dnbox.cn/icon/api.php?action=catalog"
```

## 自己部署

`dist/` 已构建好并入库，服务器上不需要 Node：

```bash
git fetch origin main
git reset --hard origin/main
rsync -a --no-owner --no-group dist/ /path/to/site/ --exclude '.env'
```

首次部署再准备配置：

```bash
cp scripts/.env.example dist/.env
# 编辑 ADMIN_USER / ADMIN_PASS / SESSION_SECRET / ADMIN_AI_KEY
```

- `.env` 不入库，也不会被更新覆盖，放在服务器上即可。
- 首次访问时 `api.php` 会自己创建 `data/library.enc`。
- 一定要把 `.env` 挡在 Web 访问之外：它含明文密码和加密密钥。
- 只想看界面：直接打开 `dist/index.html`，不需要 PHP；上传、点赞、审核会不可用。

改源码后重新构建并提交：

```bash
npm run build:site
git add dist && git commit -m "build: 更新部署包" && git push
```

## 功能

| 浏览 | 管理 | 给 AI |
| --- | --- | --- |
| 名称 / 别名 / id 搜索 | 管理员设置面板（图标 / 分类 / 数据） | `?action=search` 搜索 |
| 13 类固定分类、项目与来源筛选 | 改名、补别名、换分类 | `?action=svg` 取 SVG 源码 |
| 复制 SVG / path / 代码、下载 .svg | 审核投稿、批量上传 | `?action=catalog` 全量清单 |
| 点赞 / 点踩，综合热度排序 | 访客、下载、搜索词、零结果图表 | `?action=skill` 装成 skill |
| 详情里整体着色 / 逐块涂色 | `X-Icon-Key` 管理员 AI 凭证 | `submitBulk` 批量上传 |

- 综合热度 = `(赞 − 踩) × 5 + 下载 + 复制`；所有计数从 0 开始，不预置任何假数据。
- 浏览器指纹只用来去重（`游客XXXX`），不记 IP；管理员自己的设备不计入访客统计。
- 「不喜欢 / 隐藏」由管理员标记，标记后普通访客和 agent 都取不到；「喜欢」是管理员自己的口味，便于回看。

## 目录

```text
scripts/
  template.html     页面模板（样式 + 交互 + 管理面板，全部内联）
  build.mjs         构建：合并图标、补别名与分类、输出 dist/
  api.php           接口：登录、偏好、点赞、投稿、审核、统计、AI 接口
  taxonomy.mjs      13 个固定分类的唯一口径
  aliases.json      人工整理的搜索别名
  icon-agent.mjs    命令行助手（用 .env 的管理员账号操作线上站点）
IconLibrary/        统一规格图标库（Lucide，ISC）
data/icons.json     项目收集的图标源
dist/               已构建的部署包（入库，可直接上线）
```

## 接口速查

公开、免登录、带 CORS：

```text
GET  api.php?action=search&q=删除&limit=8
GET  api.php?action=svg&id=trash
GET  api.php?action=catalog
GET  api.php?action=skill
```

管理员 AI：请求头带 `X-Icon-Key: <ADMIN_AI_KEY>`（或 `?key=`），可用 `rename` / `review` / `submitBulk`，读统计时也不会混进访客数据。

## 图标与许可

- 代码：MIT，见 [LICENSE](LICENSE)。
- 线性图标：来自 [Lucide](https://lucide.dev)，ISC 许可，许可证原件在 `IconLibrary/licenses/`。
- 项目收集的图标：版权归各原项目，仅保留公开的图形与名称，不带项目来源与源码路径。

## Star

如果它帮你省下了一次找图标的时间，点个 Star；更欢迎把你筛过的图标传回来。
