# Iconary · 图标仓

一个可以自托管、也能被 AI 直接调用的 SVG 图标库。名字取自 **Icon + Library**，中文仍叫「图标仓」。

[在线使用](https://ai.dnbox.cn/icon) · [给 agent 的 skill](https://ai.dnbox.cn/icon/api.php?action=skill) · [MIT License](LICENSE)

## 它是什么

- **920 枚 24×24 线性 SVG 图标**，13 个固定分类，中英文关键词都能搜。
- **纯静态页面 + 一个 PHP 文件**，不用数据库；账号、偏好、投稿加密存在 `data/library.enc`。
- **自带 AI 入口**：`/skills/icon-library/` 或 `api.php?action=skill`，agent 免登录搜索、取图，也支持批量投稿。
- **可自托管**：把 `dist/` 丢进任何支持 PHP 的站点目录就能用；没有 PHP 也能双击 `index.html` 浏览和复制。

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
- 「喜欢 / 不喜欢 / 隐藏」是管理员口味，不影响网页排序，只影响 agent 搜索结果的取舍。

## 快速开始

`dist/` 已经构建好并入库，服务器上直接 `git pull` 就能更新，不需要装 Node：

```bash
git fetch origin main
git reset --hard origin/main
```

然后把 `dist/` 里的文件同步到站点根目录（或在宝塔里把站点根目录直接指向 `dist/`）。首次部署时再准备账号配置：

```bash
cp scripts/.env.example dist/.env
# 编辑 ADMIN_USER / ADMIN_PASS / SESSION_SECRET / ADMIN_AI_KEY
```

- `dist/.env` 不入库，也不会被 `git pull` 覆盖，放在服务器上即可。
- 首次访问时 `api.php` 会自己创建 `data/library.enc`。
- 一定要把 `.env` 挡在 Web 访问之外：它含明文密码和加密密钥。
- 只想看界面：直接打开 `dist/index.html`，不需要 PHP；上传、点赞、审核会不可用。

改源码后重新构建并提交：

```bash
npm run build:site
git add dist && git commit -m "build: 更新部署包" && git push
```

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

如果它省了你一次找图标的时间，右上角那个 Star 按钮就是最好的回礼。
