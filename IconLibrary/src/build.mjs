/**
 * build.mjs —— 从 node_modules/lucide-static 抽取真实 SVG，生成图标库与 demo 页
 * ---------------------------------------------------------------------------
 * 产物：
 *   icons/<category>/<id>.svg   规范化后的独立文件（24×24 / 2px / currentColor）
 *   icons/sprite.svg            全部图标的 <symbol> 合集
 *   data/icons.json             元数据 + 内联 SVG（唯一运行时数据源）
 *   data/manifest.json          版本、许可证、分类计数
 *   index.html                  可视化 demo（选中 / 全选 / 复制清单）
 *
 * 用法：npm run build
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./catalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_ICONS = path.join(ROOT, "icons");
const OUT_DATA = path.join(ROOT, "data");
const TPL = path.join(HERE, "template.html");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const LUCIDE_DIR = path.join(ROOT, "node_modules", "lucide-static");
const SRC_DIR = path.join(LUCIDE_DIR, "icons");
const LUCIDE_PKG = JSON.parse(fs.readFileSync(path.join(LUCIDE_DIR, "package.json"), "utf8"));

/* ── 1. 读取 & 规范化 ───────────────────────────────────────────────── */

const ATTRS = [
  'xmlns="http://www.w3.org/2000/svg"',
  'width="24"',
  'height="24"',
  'viewBox="0 0 24 24"',
  'fill="none"',
  'stroke="currentColor"',
  'stroke-width="2"',
  'stroke-linecap="round"',
  'stroke-linejoin="round"',
];

/** lucide 的 svg 结构固定：<svg ...> 若干 path/circle/... </svg>，这里只取子元素 */
function extractBody(raw, id) {
  const open = raw.indexOf(">", raw.indexOf("<svg"));
  const close = raw.lastIndexOf("</svg>");
  if (open < 0 || close < 0) throw new Error(`[${id}] SVG 结构异常，找不到 <svg> 边界`);
  let body = raw.slice(open + 1, close);
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  if (!body) throw new Error(`[${id}] SVG 内容为空`);
  if (/<script|on\w+=|javascript:/i.test(body)) throw new Error(`[${id}] SVG 含可疑脚本`);
  return body;
}

function prettyBody(body) {
  return body
    .replace(/></g, ">\n  <")
    .replace(/^/, "  ")
    .replace(/$/, "\n");
}

function buildSvg(body, id, { pretty = true } = {}) {
  const head = ATTRS.join(" ");
  const cls = `class="il-icon il-${id}" aria-hidden="true"`;
  const inner = pretty ? prettyBody(body) : body;
  return `<svg ${head} ${cls}>\n${inner}</svg>\n`;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/* ── 2. 校验 + 收集 ─────────────────────────────────────────────────── */

const seen = new Map();
const icons = [];
const categories = [];
const warnings = [];

for (const cat of CATEGORIES) {
  const list = [];
  for (const it of cat.icons) {
    const { id, name, tier, keywords = [] } = it;
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`[${id}] id 只允许小写字母、数字、连字符`);
    if (seen.has(id)) throw new Error(`[${id}] id 重复：${seen.get(id)} 与 ${cat.name}`);
    seen.set(id, cat.name);

    const src = path.join(SRC_DIR, `${id}.svg`);
    if (!fs.existsSync(src)) throw new Error(`[${cat.name}/${id}] lucide-static 中不存在该图标`);
    const raw = fs.readFileSync(src, "utf8");
    const body = extractBody(raw, id);

    const rel = `icons/${cat.id}/${id}.svg`;
    writeFile(path.join(ROOT, rel), `<!-- IconLibrary · ${id} · Lucide ${LUCIDE_PKG.version} · ISC -->\n` + buildSvg(body, id));

    list.push({
      id,
      name,
      category: cat.name,
      categoryId: cat.id,
      tier,
      source: "lucide",
      sourceLabel: "Lucide",
      sourceVersion: LUCIDE_PKG.version,
      license: "ISC",
      path: rel,
      keywords,
      svg: buildSvg(body, id, { pretty: false }).replace(/\n$/, ""),
      body,
    });
  }
  icons.push(...list);
  categories.push({
    id: cat.id,
    name: cat.name,
    desc: cat.desc,
    count: list.length,
    core: list.filter((i) => i.tier === "core").length,
    extra: list.filter((i) => i.tier === "extra").length,
  });
}

/* 分类内中文名重复只警告：不同视觉表达可以同名，但值得人工确认 */
for (const cat of categories) {
  const names = icons.filter((i) => i.categoryId === cat.id).map((i) => i.name);
  const dup = names.filter((n, idx) => names.indexOf(n) !== idx);
  if (dup.length) warnings.push(`${cat.name} 内中文名重复：${[...new Set(dup)].join("、")}`);
}

/* ── 3. 输出数据 ───────────────────────────────────────────────────── */

const publicIcons = icons.map(({ body, svg, ...rest }) => ({ ...rest, svg }));
const generatedAt = new Date().toISOString();

writeFile(
  path.join(OUT_DATA, "icons.json"),
  JSON.stringify({ version: PKG.version, generatedAt, icons: publicIcons }, null, 0) + "\n"
);

/* sprite：一个文件搞定整库，用 <use href="sprite.svg#il-plus"> 引用 */
const symbols = icons
  .map((i) => `  <symbol id="il-${i.id}" viewBox="0 0 24 24">${i.body}</symbol>`)
  .join("\n");
writeFile(
  path.join(OUT_ICONS, "sprite.svg"),
  `<!-- IconLibrary · Sprite · Lucide ${LUCIDE_PKG.version} · ISC · 用法 <svg class="il-icon"><use href="sprite.svg#il-plus"/></svg> -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">\n${symbols}\n</svg>\n`
);

/* ESM 版数据在下面 manifest 生成后写出，供打包器 / 浏览器直接 import */

const manifest = {
  name: "IconLibrary",
  version: PKG.version,
  generatedAt,
  spec: {
    viewBox: "0 0 24 24",
    grid: 24,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    color: "currentColor",
  },
  source: {
    package: "lucide-static",
    version: LUCIDE_PKG.version,
    license: "ISC",
    homepage: "https://lucide.dev",
  },
  counts: {
    total: icons.length,
    core: icons.filter((i) => i.tier === "core").length,
    extra: icons.filter((i) => i.tier === "extra").length,
    categories: categories.length,
  },
  categories,
};
writeFile(path.join(OUT_DATA, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

/* ESM 版数据：供打包器 / 浏览器直接 import（library/index.mjs 依赖它） */
writeFile(
  path.join(ROOT, "library", "icons.mjs"),
  "/* 自动生成，勿编辑。源：data/icons.json */\n" +
    `export const MANIFEST = ${JSON.stringify(manifest, null, 2)};\n\n` +
    `export const ICONS = ${JSON.stringify(publicIcons)};\n`
);

/* ── 4. demo 页 ───────────────────────────────────────────────────── */

if (fs.existsSync(TPL)) {
  const tpl = fs.readFileSync(TPL, "utf8");
  const html = tpl
    .replace("__ICONLIB_MANIFEST__", () => JSON.stringify(manifest))
    .replace("__ICONLIB_ICONS__", () => JSON.stringify(publicIcons));
  writeFile(path.join(ROOT, "index.html"), html);
}

/* ── 5. 汇报 ─────────────────────────────────────────────────────── */

console.log(`IconLibrary v${PKG.version} · Lucide ${LUCIDE_PKG.version}`);
console.table(categories.map((c) => ({ 分类: c.name, 合计: c.count, 核心: c.core, 增补: c.extra })));
console.log(`合计 ${icons.length} 枚（core ${manifest.counts.core} / extra ${manifest.counts.extra}）`);
if (warnings.length) {
  console.log("\n提示：");
  for (const w of warnings) console.log("  - " + w);
}
