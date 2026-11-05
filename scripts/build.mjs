import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./library.mjs";
import { CATEGORY_NAMES, INBOX, sceneOfIcon, sceneOrder } from "./taxonomy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "icons.json");
const OUT_DIR = path.join(ROOT, "dist");
const TPL = path.join(ROOT, "scripts", "template.html");
const ENV_SRC = path.join(ROOT, "scripts", ".env");
const OG_SRC = path.join(ROOT, "docs", "og-cover.png");

/* 别名 = 人工整理的中英文搜索词（scripts/aliases.json），没有就用 slug + 标签兜底 */
const ALIAS_FILE = path.join(ROOT, "scripts", "aliases.json");
const aliases = fs.existsSync(ALIAS_FILE) ? JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) : {};
/* 记录自带 alias 的（图标库关键词、同形合并后的结果）优先，
   其余仍以人工整理的 aliases.json 为准。 */
const aliasOf = (it) =>
  it.alias || aliases[it.id] || [it.slug, ...(it.tags || [])].filter(Boolean).join(" ");
/* 合并时按"人工别名 → 自带 alias → slug+标签"的原始顺序取，避免拿到刚算出来的合并结果 */
const rawAliasOf = (it) =>
  aliases[it.id] || it.alias || [it.slug, ...(it.tags || [])].filter(Boolean).join(" ");

/* 标签并进别名：以前 tags 是独立维度（里面还混着分类名和项目名），
   和 alias 高度重叠，搜一次要在两个字段里各找一遍。统一只留 alias。 */
const mergeTagsIntoAlias = (it) => {
  const words = String(aliasOf(it) || "")
    .split(/\s+/)
    .filter(Boolean);
  for (const t of it.tags || []) {
    if (t && !words.includes(t)) words.push(t);
  }
  return [...new Set(words)].join(" ");
};

/* 项目收集的图标（data/icons.json）+ 统一规格的 Lucide 图标库（IconLibrary 构建产物） */
const archiveIcons = JSON.parse(fs.readFileSync(SRC, "utf8"));
const library = loadLibrary();

/* ── 同形合并 ──────────────────────────────────────────────────────────────
   两个来源各收过一份同一图形（plus / check / folder / wand-2 …），
   叠在网格里就是两个一模一样的东西。按「viewBox + 归一化后的内部结构」做指纹分组：
   每组留一条（优先留 id 不含 lib- 前缀的原始记录，公开 id 更干净），
   其余记录的名称和别名并进 alias、出处并进 usedIn，图形只留一份。 */
function shapeOf(it) {
  const raw = String(it.svg || "").trim();
  if (!raw) return `no-svg:${it.id}`;
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*\/>/g, "/>")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
  return `${String(it.viewBox || "0 0 24 24").replace(/\s+/g, " ")}|${body}`;
}
const keepRank = (it) => (/^lib-/.test(it.id) ? 1e6 : 0) + String(it.id).length;

function mergeSameShape(list) {
  const groups = new Map();
  for (const it of list) {
    const k = shapeOf(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  const merged = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const sorted = [...g].sort((a, b) => keepRank(a) - keepRank(b));
    const libPick = sorted.find((x) => /^lib-/.test(x.id));
    const mainPick = sorted.find((x) => !/^lib-/.test(x.id));
    /* 图形取图标库那份（24 网格 / 2px / currentColor 统一），
       命名与出处沿用项目里那条——公开 id 才不会被冠上 lib- 前缀。 */
    const keep = libPick ? { ...libPick } : { ...sorted[0] };
    if (libPick && mainPick) {
      keep.id = mainPick.id;
      keep.slug = mainPick.slug;
      keep.name = mainPick.name;
      keep.project = mainPick.project;
    }
    const words = [keep.name, rawAliasOf(keep)];
    /* keep 换成了项目里那条的名字，图标库原来的名字要单独补进来，否则搜不到 */
    if (libPick && mainPick) words.push(libPick.name, rawAliasOf(libPick));
    for (const r of sorted) {
      if (libPick && r.id === libPick.id) continue;
      words.push(r.name, rawAliasOf(r));
    }
    keep.alias = [...new Set(words.join(" ").split(/\s+/).filter(Boolean))].join(" ");
    keep.usedIn = [...new Set(
      sorted.flatMap((r) => r.usedIn || [r.project]).filter(Boolean)
    )];
    out.push(keep);
    merged.push({ id: keep.id, name: keep.name, absorbed: sorted.length - 1 });
  }
  return { icons: out, merged };
}

const mergedShape = mergeSameShape([...archiveIcons, ...library.icons]);
const icons = mergedShape.icons;

/* ── 计数 ── */
const tally = (getter, list = icons) => {
  const m = new Map();
  for (const it of list) {
    for (const v of getter(it)) m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh"))
    .map(([name, count]) => ({ name, count }));
};

/* 分类 = 13 类固定口径（scripts/taxonomy.mjs），老的两字分类和逐枚修正都在那里 */
const sceneOf = (it) => sceneOfIcon(it);
/* 品牌图标（应用图标 / 字标 / 第三方品牌标记 / 品牌名单这类只说品牌的图）不对外分享：
   不进 index.json、也不写 icons/*.svg，只随 data/base.php 交给管理员。 */
const isBrand = (it) =>
  it.type === "品牌" || /品牌|brand/i.test([it.name, aliasOf(it), ...(it.tags || [])].join(" "));
const pubIcons = icons.filter((it) => !isBrand(it));
const brandIcons = icons.filter(isBrand);

/* 公开 id：去掉来源项目前缀（chatx-expand-all → expand-all），
   免得游客从 id / 文件名里看出项目名；重复 slug 按原 id 顺序编号。 */
const baseIdOf = (it) => String(it.slug || it.id).replace(/^[-_.]+|[-_.]+$/g, "") || it.id;
const rawIds = new Set(icons.map(baseIdOf));
const usedIds = new Set();
const publicIdOf = new Map();
for (const it of [...icons].sort((a, b) => a.id.localeCompare(b.id))) {
  const base = baseIdOf(it);
  let id = base;
  let n = 2;
  while (usedIds.has(id) || (id !== base && rawIds.has(id))) {
    id = `${base}-${n++}`;
  }
  usedIds.add(id);
  publicIdOf.set(it.id, id);
}

/* ── 输出目录 ── */
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, "icons"), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, "data"), { recursive: true });

/* ── 接口与账号配置 ── */
fs.copyFileSync(path.join(ROOT, "scripts", "api.php"), path.join(OUT_DIR, "api.php"));
if (fs.existsSync(ENV_SRC)) {
  fs.copyFileSync(ENV_SRC, path.join(OUT_DIR, ".env"));
}
/* Apache 下自动挡掉 .env；Nginx（宝塔默认）不吃这个，仍需在站点配置里加等效规则，见「读我.md」 */
fs.copyFileSync(path.join(ROOT, "scripts", "htaccess.txt"), path.join(OUT_DIR, ".htaccess"));
/* 分享链接的预览封面（docs/og-cover.png），构建时一起带上；没有就跳过，不影响站点 */
if (fs.existsSync(OG_SRC)) {
  fs.copyFileSync(OG_SRC, path.join(OUT_DIR, "og-cover.png"));
}


/* ── 单个 SVG 文件（只写公开图标） ── */
const records = pubIcons.map((it) => {
  const id = publicIdOf.get(it.id);
  const file = `icons/${id}.svg`;
  fs.writeFileSync(path.join(OUT_DIR, file), it.svg.trim() + "\n", "utf8");
  return {
    id,
    name: it.name,
    slug: it.slug,
    alias: mergeTagsIntoAlias(it),
    scene: sceneOf(it),
    license: it.license,
    origin: it.origin,
    viewBox: it.viewBox,
    kind: it.kind,
    file,
    svg: it.svg,
  };
});

/* ── 品牌图标：只随 base.php 下发（含 svg，不落公开目录） ── */
const brandRecords = brandIcons.map((it) => ({
  id: publicIdOf.get(it.id),
  name: it.name,
  slug: it.slug,
  alias: mergeTagsIntoAlias(it),
  scene: sceneOf(it),
  license: it.license,
  origin: it.origin,
  viewBox: it.viewBox,
  kind: it.kind,
  file: null,
  project: it.project,
  usedIn: it.usedIn || [it.project],
  source: it.source,
  svg: it.svg,
}));

/* ── 项目来源：只有管理员能看到，所以单独放进 data/base.php（直接访问不输出内容） ── */
const privateMap = {};
for (const it of icons) {
  privateMap[publicIdOf.get(it.id)] = {
    project: it.project,
    usedIn: it.usedIn || [it.project],
    source: it.source,
  };
}
const privateJson = JSON.stringify({
  projects: tally((it) => it.usedIn || [it.project]),
  icons: privateMap,
  brands: brandRecords,
});
const basePhp = `<?php
// 由 build.mjs 生成：项目来源信息，只由 api.php 读取；直接访问这个文件不会输出任何内容。
return json_decode(base64_decode('${Buffer.from(privateJson, "utf8").toString("base64")}'), true);
`;
fs.writeFileSync(path.join(OUT_DIR, "data", "base.php"), basePhp, "utf8");

/* ── index.json（公开版：不含项目名、不含品牌图标与源码路径） ── */
const index = {
  meta: {
    name: "Iconary · 图标仓",
    version: "2.2.0",
    generatedAt: new Date().toISOString(),
    count: records.length,
    /* 分类是固定口径：顺序按 taxonomy，不按数量，免得侧栏位置天天变 */
    scenes: tally((it) => [sceneOf(it)], pubIcons).sort(
      (a, b) => sceneOrder(a.name) - sceneOrder(b.name)
    ),
    taxonomy: CATEGORY_NAMES,
    licenses: tally((it) => [it.license], pubIcons),
    note:
      "公开索引不含项目名，也不含品牌图标（应用图标 / 字标 / 第三方品牌标记只在管理员登录后可见）。查询项目来源需要管理员：POST api.php {action:\"base\", token}。",
    usage:
      "按 alias / scene / name 过滤 icons，取 icons[i].file 读 SVG，或直接用 icons[i].svg；SVG 使用 currentColor。scene 只有固定 13 类，见 meta.taxonomy。",
  },
  icons: records,
};
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");

/* ── llms.txt ──
   agent / 爬虫的约定入口。这里只用相对地址（./api.php），部署在子路径下也不会错；
   完整地址由 api.php 按请求现算，见 ?action=skill。 */
const llms = [
  "# Iconary · 图标仓",
  "",
  `> ${records.length} 枚 24×24 线性 SVG 图标，中文 / 英文关键词都能搜。只读公开接口，无需登录，带 CORS。`,
  "",
  "## 装成 skill",
  "",
  "本站本身就是一个 skill：./skills/icon-library/（同一份内容也在 ./api.php?action=skill）。",
  "存进你所用的 agent 的 skill 目录即装好；不确定路径时问用户，比猜快。",
  "",
  "## 接口",
  "",
  "- 搜索：./api.php?action=search&q=删除&limit=8",
  "- 取 SVG：./api.php?action=svg&id=trash",
  "- 全量清单：./api.php?action=catalog",
  "- 装成 skill：./skills/icon-library/（完整用法，装 skill 就是存这个文件）",
  "- 短提示词：./api.php?action=prompt",
  "- 给人看的网页：./",
  "",
  "## 分类",
  "",
  index.meta.scenes.map((s) => `${s.name} ${s.count}`).join(" · "),
  "",
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "llms.txt"), llms, "utf8");

/* ── /skills/icon-library/ ──
   给 agent 一个「长得像一包 skill」的地址。目录 + index.php 是唯一一种
   Apache 和 nginx 都默认支持、不用改任何配置的分发方式，所以拿它当主入口。
   文案全在 api.php，这里只做转发，改文档只改一处。 */
const skillDir = path.join(OUT_DIR, "skills", "icon-library");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "index.php"),
  [
    "<?php",
    "/* 把 /skills/icon-library/ 转给 api.php?action=skill，这里不放任何文案。 */",
    "$_GET['action'] = 'skill';",
    "/* api.php 的 baseUrl() 靠 SCRIPT_NAME 推站点根；这里掰回 api.php 的位置，",
    "   否则它算出来的地址会变成 /skills/icon-library/api.php。 */",
    "$_SERVER['SCRIPT_NAME'] = preg_replace('#/skills/icon-library/?[^/]*$#', '/api.php', (string)($_SERVER['SCRIPT_NAME'] ?? '/api.php'));",
    "require __DIR__ . '/../../api.php';",
    "",
  ].join("\n"),
  "utf8"
);

/* ── index.html ── */
const tpl = fs.readFileSync(TPL, "utf8");
const html = tpl
  .replace("__DATA_JSON__", JSON.stringify({ icons: records, meta: index.meta }).replace(/</g, "\\u003c"))
  .replace(/__COUNT__/g, String(records.length))
  .replace(/__SCENES__/g, String(index.meta.scenes.length));
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");

/* ── 读我.md ── */
const licLines = index.meta.licenses.map((x) => `- ${x.name} × ${x.count}`).join("\n");
const readme = `# 图标仓

从 \`D:\\apps\` 各项目里挑出的、真正出现在成品界面上的 SVG 图标，加上一套统一规格的 Lucide 图标库：
公开 ${records.length} 个（其中图标库 ${library.icons.length} 个），另有 ${brandRecords.length} 个品牌图标（应用图标 / 字标 / 第三方品牌标记）只对管理员可见。
同名同形的图标已按几何指纹合并，每个只带三样东西：中文名、别名、分类。
同一个图形如果两边都有（70 组），构建时按几何指纹合并成一条：图形用图标库那份（24 网格 / 2px），名称与出处沿用项目里的叫法，另一边的名字进别名——搜「魔法棒」和「AI 增强」都会命中同一条。

## 图标库（IconLibrary）

\`IconLibrary/\` 是独立可复用模块，与「项目收集」分开维护，构建时合并进本仓：

- **规格**：24 网格 / 2px 描边 / round 端点 / \`currentColor\` / \`fill="none"\`，全部取自 npm 包 \`lucide-static\`，ISC 许可，非 AI 绘制。
- **分类**：${CATEGORY_NAMES.length} 类（${CATEGORY_NAMES.join("、")}），名字统一四字、顺序固定，不再有「类型」「标签」两套并行维度。
- **在仓里怎么找**：卡片副行写的就是它的分类（「基础操作 · 开源」）；id 统一带 \`lib-\` 前缀（\`lib-plus\`、\`icons/lib-plus.svg\`），不会和项目收集的同名图标抢 id。
- **改图标**：只改 \`IconLibrary/src/catalog.mjs\`，再 \`node IconLibrary/src/build.mjs && node IconLibrary/src/validate.mjs && node scripts/build.mjs\`。图标库自带 16 项机器校验（存在性、ID 唯一、24 网格、2px、\`currentColor\`、path 合法性、XML 闭合、同形重复、sprite 与 demo 数据一致）。
- **单独使用**：\`IconLibrary/index.html\` 是可打钩多选、全选/全不选、复制选中清单的选型页；\`IconLibrary/library/index.mjs\` 提供 \`renderIcon()\` / \`searchIcons()\`，\`icons/sprite.svg\` 可作精灵图。

## 打开

双击 \`index.html\` 就能浏览、搜索、复制（数据内联，无需服务器）。
上传、审核、改名、标记偏好需要 PHP：把整个 \`dist/\` 放到宝塔站点根目录即可。

## 账号（.env）

账号写在同目录的 \`.env\`：

\`\`\`
ADMIN_USER=admin
ADMIN_PASS=9090
USER_USER=guest
USER_PASS=guest9090
SESSION_SECRET=…
TOKEN_TTL=86400
ADMIN_AI_KEY=…
\`\`\`

- 管理员用 \`ADMIN_USER / ADMIN_PASS\`，普通用户用 \`USER_USER / USER_PASS\`。
- \`ADMIN_AI_KEY\` 是给 AI 用的管理员凭证：AI 请求带 \`X-Icon-Key: <key>\` 头（或 \`?key=\`）就会被认成管理员：\`?action=state\` 能读到统计，\`search / svg / catalog / skill\` 只记进「管理员 AI」，不混进访客和对外 AI 下载量；还能用 \`action=rename\` 改已有图标、\`action=review\` 审核、带 key 的 \`submitBulk\` 上传直接通过。删除图标和改类别结构仍然只认网页登录。留空则关闭这个入口。key 泄露就换一个，改完即时生效。
- 登录入口只有页头左上角的 logo：**双击 logo** 才弹登录框，单点无效；未登录时页头不显示账号按钮。
- 登录后页头显示账号与角色；点一下可退出。
- 改账号直接改服务器上的 \`dist/.env\`，不用重建。改 \`SESSION_SECRET\` 会让所有登录态失效。

**务必把 \`.env\` 挡在 Web 访问之外**（它含明文密码）：
- nginx（宝塔）：\`location = /.env { return 403; }\`，顺手也挡一下 \`location ~ /data/(\\.hits\\.log|\\.analytics\\.log|\\.dl\\.php|\\.prefs\\.php) { return 403; }\`（里面只有图标 id、指纹 hash 和搜索词，不算敏感，但没必要公开）
- Apache：\`.htaccess\` 里 \`<Files ".env">\` + \`Require all denied\`

**给 agent 的干净入口 \`/skills/icon-library/\` 不用配任何东西。** 那个目录里是一个几行的 \`index.php\`，只做一件事：把请求转给 \`api.php?action=skill\`。Apache 和 nginx（宝塔）默认都会执行目录下的 \`index.php\`，所以开箱就能用；域名由请求现算，换域名不用重新构建。

- 想更短的 \`/skills/icon-library/SKILL.md\`：Apache 用 \`dist/.htaccess\` 里已经带的那条 rewrite；nginx 加 \`location = /skills/icon-library/SKILL.md { rewrite ^ /api.php?action=skill last; }\`
- 什么也没配也能用：\`api.php?action=skill\` 内容完全一样，只是 agent 看到 \`?action=\` 容易当成一个 API 去 POST，而不是当文件存下来

## 角色能做什么

| 能力 | 游客 | 普通用户 | 管理员 |
| --- | --- | --- | --- |
| 浏览 / 搜索 / 复制 / 看名字·别名·行业场景 | ✅ | ✅ | ✅ |
| 看到项目名、源码路径、许可证来源 | ❌ | ❌ | ✅ |
| 看到品牌图标（应用图标 / 字标 / 支付宝·微信·GitHub 等品牌标记） | ❌ | ❌ | ✅ |
| 喜欢 / 不喜欢 / 隐藏（喂给 AI 的口味） | ❌ | ❌ | ✅ |
| 点赞 / 点踩（按权重排序，一人一票，可取消） | ✅ | ✅ | ✅ |
| 上传图标（进入待审） | ✅（记为「游客XXXX」，每指纹每天 ≤100） | ✅（同上） | ✅（自己的直接通过） |
| agent 批量上传（\`submitBulk\`） | ✅（记为 \`agent-XXXX\`，单次 ≤50、每天 ≤100） | ✅ | ✅ |
| 审核通过 / 拒绝投稿 | ❌ | ❌ | ✅ |
| 改图标名 / 改别名 / 加别名 / 换分类 | ❌ | ❌ | ✅ |
| 下载计数（复制 / 下载都算，一人一天一次） | 自动 | 自动 | 自动 |

游客看到的图标卡片只有：分类、图标名、别名。项目维度、源码路径在 \`index.json\` 里也不存在（放在 \`data/base.php\`，只走管理员接口）。

公开的 \`id\` 与文件名也已去掉项目前缀（\`chatx-expand-all\` → \`expand-all\`），所以从 \`index.json\` 或 \`icons/<id>.svg\` 里也看不出项目名；重名 slug 会依次编成 \`-2\`、\`-3\`。
因此如果之前用密码模式标记过偏好，旧 id 的标记不会自动迁移到新 id（重建后 id 变了），需要重新标一遍。

**同形图标已合并**：两个来源里画得一模一样的图形（70 组、73 条重复）在构建时按几何指纹并成一条——图形取图标库那份（24 网格 / 2px / currentColor），名称和出处沿用项目里的叫法，另一边的名字并进别名。所以搜「魔法棒」和「AI 增强」会命中同一条；卡片的分类显示图标库那 13 类。

品牌图标（\`type: 品牌\`：应用图标、品牌字标、支付宝/微信/GitHub 这类第三方品牌标记）不进 \`index.json\`，也不写 \`icons/*.svg\`，只是以 base64 内联在 \`data/base.php\` 里，管理员登录后由 \`api.php {action:"base"}\` 取回。所以游客即使猜到文件名也下载不到，只能看到公开的那 ${records.length} 个。

## 上传与审核

1. **不用登录**。入口是网格第一格那张虚线卡（白底 + 实心圆加号，刻意不做成线性图标，免得被当成库里的一枚），点开或直接把 \`.svg\` 拖上去都行，也可以粘贴 SVG 代码。
2. 网页端一次可以选择 / 拖入最多 10 个 SVG：单个走原来的表单；多个会变成列表，名称按文件名自动填好，可以逐个改，别名一栏应用到整批。
3. 提交后进入待审，管理员在「待审」里能看到缩略图和提交人，可先改名字/别名/分类再点「通过」。匿名提交记作 \`游客XXXX\`（指纹算出的 4 个字母），agent 走 \`submitBulk\` 记作 \`agent-XXXX\`。每个指纹每天最多 100 个，单次请求最多 50 个，超了返回 429。
4. agent 的调用方式写在 \`?action=skill\` 里：POST \`action:"submitBulk"\` + 固定 \`fp\` + \`items\` 数组，不需要登录；管理员审核时能一眼看出是 agent 传的。
5. 通过的图标立刻出现在所有人页面；被拒绝的只留在管理员列表里，可随时删除。
6. 上传只接受 SVG，会检查是否完整、体积、以及 \`<script>\` / \`onload=\` / \`javascript:\` 这类内容。Illustrator / Inkscape / Sketch 导出带的 \`<!DOCTYPE svg>\` 会被正常接受。

## 临时换个颜色再拿走

点开任意图标的详情弹窗，图形占左边一大块，下面是「着色」：

- **整枚**：一排色板 + 自定义取色器，点一下整枚变色，复制/下载出去的就是这个颜色。左边那个转圈箭头是还原（回到 \`currentColor\`，交给 CSS 管）。
- **画笔**：切过去后鼠标就变成一支蘸着当前颜色的画笔，笔尖跟着颜色走。点图形上任意一块，那一块就变色；不换颜色可以一直点下去。按住拖能连着涂好几块——有些图形被切成两三条 path（比如一个「＋」是两笔），拖一下最省事。
- 鼠标划过某一块时，其余部分会变淡，用来确认「我要涂的是这块」。
- 再点一次已经涂过的那块会取消它的颜色；左边转圈箭头在画笔模式下是「全部还原」。

**这些颜色只活在这个弹窗里**，关掉就没了，库里的图标、\`index.json\`、\`library.enc\` 一个字节都不动。所以它是「导出来之前顺手调一下」，不是「改图标」。

## 喜欢 / 不喜欢 / 隐藏（仅管理员）

登录管理员后，右键卡片（详情弹窗里也有这三个按钮），点一下打标，再点一下取消。普通用户看不到这三颗按钮，也看不到卡片上的标记：

- **喜欢**：网页上不置顶、不加边框，只表示「agent 挑图时优先用它」；真正排序仍按赞和下载量。
- **不喜欢** / **隐藏**：都不进 agent 的搜索结果和清单（\`?action=search\`、\`?action=catalog\` 会直接过滤掉），只有明确点名 id 直接取图时才拿得到。区别只在网页上：隐藏的更彻底，你自己看时也不太想见到。

## 点赞 / 点踩

详情弹窗顶部有「点赞 / 点踩」，所有人都能投，一人一票（同一枚图标再点同一方向就取消，换方向就挪一票）。靠浏览器指纹认人，不用登录。默认排序按「赞 × 5 + 下载 / 复制」的综合热度，点踩会扣分；想只看赞数就切「点赞最多」。**所有计数从 0 开始，不预置任何假数据**。

## 管理员怎么改名字 / 别名 / 分类

双击左上角 logo 登录管理员后，工具栏会多一个「设置」（侧栏「分类」下面也有「分类分布 / 待归类」入口）：

- **图标页**：搜索定位后逐行改——名称直接改输入框，分类从 13 类的下拉里选，别名是一颗颗芯片（回车加一个词，× 删一个词），保存后立刻对所有人生效。
- **分类页**：只读概览。13 类固定，每行一个占比条和数量，点「筛选」直接跳到那一类。有「待归类」（用户上传的默认落点）时排在最下面，点进去逐个改分类即可。
- **详情弹窗**里也能改单个图标：名称、分类下拉、别名芯片都在「管理员编辑」区块，改完点保存。
- **分类为什么不能新建**：分类就是每个图标的 \`scene\` 字段，全站只有 13 个取值，口径写在 \`scripts/taxonomy.mjs\`。以前 27 个分类（两字的「操作 / 导航」和四字的「基础操作 / 页面导航」混着）就是让管理员随手起名起出来的，同一个意思还出现三遍（分类、类型、标签）。现在只留分类一套，要加新类得改 \`taxonomy.mjs\`，不能在线新增。
- **改过的名字和分类**存在 \`data/library.enc\` 的 \`renames\` 里，重建 \`dist/\` 不会覆盖它；但重建后 id 若变了，旧改名会失效。

## 统计口径

- 页面上的「复制 SVG / 复制 path / 复制代码」和「下载 .svg」统一记作一次「下载」，存在 \`data/library.enc\` 的 \`stats\` 里，公开读取（排序要用），只记次数不记人。
- 同一枚图标，**同一个浏览器指纹一天只加一次**：前端用 canvas + UA + 屏幕等算一个指纹，本地先记一份当天清单，服务端再用 \`data/.dl.php\` 按 \`图标|指纹\` 去重，所以反复点复制不会刷量。
- agent 调 \`api.php?action=svg&id=…\` 取一次图也算一次「下载」，但没有指纹，改按来源 IP 每天对同一枚去重。
- 写入是两级的：先往 \`data/.hits.log\` 追加一行明文（不加密、不读旧值，所以点一下是微秒级），下次有人打开页面（\`?action=state\`）或者日志超过 200KB 时，再攒批并进 \`library.enc\`，同时刷一份 \`data/.stats.php\` 明文快照给排序用。这样搜索和取图都不必跑 21 万轮 PBKDF2。
- 访客 / 搜索 / API 调用另走一条：\`data/.analytics.log\` 追加 JSON 行（访客只记指纹的 SHA-256 前 16 位，不记 IP），管理员打开管理面板时攒批并进 \`library.enc\` 的 \`analytics\`，按天留 120 天，搜索词保留前 200 条。普通访客不会触发解密，只有日志超过 200KB 才顺手并一次。
- 管理员「数据：访客 / 下载」面板读的是这份聚合：独立访客、访问次数、人类下载、AI 取图（按 IP 每天对同一枚去重）、AI 搜索次数与零结果、热门图标、热门搜索 / 零结果缺口、分类使用分布、赞踩、待审投稿、API 调用构成。趋势图是 14 天。
- 访客按指纹命名：\`游客\` + 指纹算出的 4 个字母（如 \`游客KQPF\`），本机换浏览器 / 清空 localStorage 会变成新名字。管理员第一次登录时，当前指纹会被记成管理员设备，之后不再计入访问次数和独立访客，只在「最近来访」里显示为 \`管理员\`。AI 请求没有浏览器指纹，靠 \`.env\` 的 \`ADMIN_AI_KEY\` 认身（见「账号」一节）。
- 排序支持：默认顺序 / 最新加入 / 最早加入 / 点赞最多 / 下载最多。上传的图标按管理员通过的时间排，内置的按入库先后排。

## 给 agent 用

页面右上角有个 **Agent** 按钮，里面三页：

1. **复制提示词** —— 十来行字，粘到任何 agent（Claude Code / Cursor / 豆包 / 自己写的脚本）的对话里，它当场就会来这个站点搜图取图。不用装东西、不用登录。
2. **装成 skill** —— 主流 agent 现在都认 \`SKILL.md\`（Claude Code、WorkBuddy、Codex、Gemini CLI、Cursor），TRAE 认 \`.trae/rules/\` 和 \`AGENTS.md\`。最省事的是把 \`/skills/icon-library/\` 连同「按你所在 agent 的 skill 目录装成常驻技能，装好告诉我放哪了」这句话丢给 agent，路径让它自己填——各家放的地方不一样，它比我们清楚自己是哪个。之后连提示词都不用贴。
3. **接口** —— 六个公开端点的速查表。

提示词和 SKILL.md 都不是写死的：由 \`api.php\` 按当前请求的域名现算（\`baseUrl()\`），所以换域名、加反代路径都不用改配置，复制出来的地址天然是对的。

| 端点 | 干什么 |
| --- | --- |
| \`?action=search&q=删除&limit=8\` | 搜图标，返回 id / 名称 / 分类 / 别名 / 许可 / 取图地址，按相关度 + 使用次数排 |
| \`?action=svg&id=trash\` | 返回 SVG 源码（\`image/svg+xml\`），并计一次「下载」 |
| \`?action=catalog\` | 全量清单，不含 SVG，约 100KB（gzip 后 ~25KB） |
| \`?action=skill\` | SKILL.md（Markdown） |
| \`?action=prompt\` | 那段短提示词（纯文本） |
| \`?action=llms\` | llms.txt |

全部 GET、免登录、\`Access-Control-Allow-Origin: *\`，浏览器里直接 \`fetch\` 也行；只吐公开图标（不含品牌、不含项目名）。

用户给了管理员 key 的话，让 agent 在每个请求带 \`X-Icon-Key: <key>\`：不改变搜到的结果，只把调用记成「管理员 AI」。要批量补图标则 POST \`action=submitBulk\`（固定 \`fp\` + \`items\` 数组，单次 ≤50、每指纹每天 ≤100）。

**为什么取图要单独一次请求**：\`search\` 故意不返回 SVG，逼 agent 走 \`?action=svg\`，这样「这个图标被用过一次」是确定的，统计才有意义。搜索结果里给了 \`svg_url\`，照着请求即可。

## 部署（宝塔）

1. 新建 PHP 站点，把整个 \`dist/\` 放进站点根目录。
2. 让 \`data/\` 可写：\`chown -R www:www data && chmod 750 data\`（写入的文件是 0600）。
3. 访问 \`域名/api.php?action=selftest\`：\`roundTrip\` 与 \`writable\` 都为 \`true\` 就通了。
4. 给 \`.env\` 加访问拦截（见上面 nginx / Apache 规则）。
5. 重建会清空 \`dist/\`：线上已有的 \`data/library.enc\`（偏好 + 投稿）不要靠重建同步，重建后要保留服务器那份。

### 加密说明（诚实版）

- 算法：AES-256-GCM；文件结构 \`STORE001\` + salt(16) + iv(12) + 密文 + tag(16)。
- KDF：PBKDF2-SHA256，210000 次，32 字节密钥，密钥来自 \`.env\` 的 \`SESSION_SECRET\`。
- 和另一个项目的 scrypt 方案有一处不同：PHP 没有原生 scrypt（需要额外 sodium 扩展），这里用 PBKDF2，其余结构一致。
- 加密的是偏好与投稿数据；账号密码本身按你的要求以明文写进 \`.env\`，靠文件访问权限 + Web 拦截保护。
- 登录失败限流：15 分钟内错 5 次封 60 秒，状态记在 \`data/.throttle.json\`。

## agent 怎么读偏好

\`\`\`
curl "https://你的域名/api.php?action=prefs&user=admin&pass=9090"
# 或先登录拿 token：
curl -X POST "https://你的域名/api.php" -H "Content-Type: application/json" \\
  -d '{"action":"login","user":"admin","pass":"9090"}'
curl "https://你的域名/api.php?action=state&token=<token>"
\`\`\`

\`action=prefs\` 返回 \`prefs\`（id→状态）、\`lists\`（三类 id 数组）、\`taste\`（分类倾向）、\`brief\`（一句话摘要）、\`rules\`（硬约束）。

挑选图标的标准做法：

1. 读 \`index.json\` 拿公开清单（alias / scene / name）。
2. 读偏好，从候选里剔除 \`lists.hide\` 与 \`lists.dislike\`。
3. 剩下的优先 \`lists.like\`；没有直接命中就按 \`taste.like\` 的分类排序。
4. 只有用户明确点名某个 id 时才允许用 \`hide\` 的图标。

## agent 怎么取图

1. 读 \`index.json\`，\`icons\` 是清单，\`meta\` 里是各维度计数。
2. 按 \`alias\` / \`scene\` / \`name\` 过滤；\`scene\` 只有 \`meta.taxonomy\` 里的 13 个值。
3. 要文件就取 \`icons[i].file\`，要内联字符串就直接用 \`icons[i].svg\`。

\`\`\`js
// 例：找「上线」场景里属于导航类的图标
const { icons } = JSON.parse(fs.readFileSync("dist/index.json", "utf8"));
const hits = icons.filter((i) => i.scene === "页面导航" && /arrow|chevron/.test(i.id));
\`\`\`

SVG 里颜色一律写 \`currentColor\`，放进按钮/菜单里会自动跟随文字颜色；需要固定色时把它替换掉即可。

## 重建流程

\`\`\`
node scripts/scan.mjs         # 遍历 D:\\apps，收集独立 svg + 源码内联 svg → data/candidates.json
node scripts/match.mjs        # 与 lucide 官方图标集比对 → data/matched.json
node scripts/init-review.mjs  # 生成待命名提案 → data/curated.json
node scripts/finalize.mjs     # 人工命名表 MAP → data/icons.json（唯一数据源）
node scripts/lucide-usage.mjs # 统计靠 import 使用的图标库图标 → data/lucide-usage.json
node scripts/merge-usage.mjs  # 把上一步结果并进 data/icons.json（同形图标只记 usedIn）
node scripts/add-brand.mjs    # 补收宽幅品牌字标（被总览图尺寸过滤掉的那批）
node scripts/fetch-fa.mjs     # 补收靠 CDN 字体用的 Font Awesome 图标（menu）
node IconLibrary/src/build.mjs    # 图标库：从 lucide-static 抽 SVG → IconLibrary/ 产物
node IconLibrary/src/validate.mjs # 图标库：16 项校验，不过就别往下走
node scripts/build.mjs        # 产出 dist/（合并项目收集 + 图标库；含 api.php、.env、data/base.php；会先清空 dist）
\`\`\`

只动图标库时不用记顺序，根目录 \`npm run build\` = 图标库构建 + 16 项校验 + 站点构建。

注意：\`build.mjs\` 会 \`rm -rf dist\`，线上的 \`data/library.enc\` 要单独保留。

注意：内联 \`<svg>\` 能被扫描到，但 \`<Users/>\` 这种从 lucide-react 导入的组件源码里没有 svg 实体，
必须靠 \`lucide-usage.mjs\` 反查 import 语句，否则整批图标会漏掉。宽幅 logo 用 \`<img src="x.svg">\`
引用，靠 CDN 图标字体的只有 \`<i class="fa-solid fa-x">\`，两者都要单独补收。

想加新图标：在 \`finalize.mjs\` 的 \`MAP\` 里补一条，或直接改 \`data/icons.json\`，再跑 \`build.mjs\`。

别名表在 \`scripts/aliases.json\`（key 是 \`data/icons.json\` 里的原 id），中英文搜索词都在这里维护；没写到的图标会退回 \`slug + 原标签\`（旧标签已并进别名，不再单独当维度）。

## 许可

${licLines}

开源来源（Lucide / Tabler / Simple Icons）保留原许可；其余为项目自有图形。
图标库全部来自 Lucide（ISC，原许可见 \`IconLibrary/licenses/lucide.txt\`），未混入其他图标库，避免圆角与笔画重量不一致。
`;
fs.writeFileSync(path.join(OUT_DIR, "读我.md"), readme, "utf8");

/* ── 报告 ── */
if (mergedShape.merged.length) {
  const absorbed = mergedShape.merged.reduce((n, m) => n + m.absorbed, 0);
  console.log(`同形合并 ${mergedShape.merged.length} 组，吸收 ${absorbed} 条重复记录（名称已转入别名）`);
}
console.log(`产出 ${records.length} 个公开图标 + ${brandRecords.length} 个品牌图标（仅管理员）`);
console.log(`其中图标库 ${library.icons.length} 个（${library.meta ? library.meta.counts.categories : 13} 类）＋ 项目收集公开 ${records.length - library.icons.length} 个`);
console.log(`场景 ${index.meta.scenes.length} 个：` + index.meta.scenes.map((p) => `${p.name}(${p.count})`).join(" "));
console.log(`分类口径 ` + index.meta.taxonomy.join(" / "));
console.log(`文件 ${fs.readdirSync(path.join(OUT_DIR, "icons")).length} 个，输出目录 ${OUT_DIR}`);
