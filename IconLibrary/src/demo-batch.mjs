/**
 * demo-batch.mjs —— 把「待定批次」渲染成独立的选型页，供人工勾选后再决定是否入库
 * ---------------------------------------------------------------------------
 * 输入：src/batch-300.json  { 分类id: [{ id, name, keywords }] }
 * 输出：batch-demo.html     复用 template.html，带打钩 / 全选 / 全不选 / 复制清单
 *
 * 这个脚本不写 icons/ 与 data/，也不进 catalog：纯粹的「先看再定」。
 * 用法：node src/demo-batch.mjs [batch-300.json] [输出文件名]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./catalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LUCIDE_DIR = path.join(ROOT, "node_modules", "lucide-static");
const SRC_DIR = path.join(LUCIDE_DIR, "icons");
const LUCIDE_PKG = JSON.parse(fs.readFileSync(path.join(LUCIDE_DIR, "package.json"), "utf8"));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const batchFile = process.argv[2] || "batch-300.json";
const outFile = process.argv[3] || "batch-demo.html";
const batch = JSON.parse(fs.readFileSync(path.join(HERE, batchFile), "utf8"));

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

function extractBody(raw, id) {
  const open = raw.indexOf(">", raw.indexOf("<svg"));
  const close = raw.lastIndexOf("</svg>");
  if (open < 0 || close < 0) throw new Error(`[${id}] SVG 结构异常`);
  const body = raw
    .slice(open + 1, close)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  if (!body) throw new Error(`[${id}] SVG 内容为空`);
  return body;
}

const svgOf = (body, id) =>
  `<svg ${ATTRS.join(" ")} class="il-icon il-${id}" aria-hidden="true">${body}</svg>`;

const icons = [];
const categories = [];

for (const cat of CATEGORIES) {
  const items = batch[cat.id];
  if (!items || !items.length) continue;
  const list = [];
  for (const it of items) {
    const src = path.join(SRC_DIR, `${it.id}.svg`);
    if (!fs.existsSync(src)) throw new Error(`[${cat.name}/${it.id}] lucide 中不存在`);
    const body = extractBody(fs.readFileSync(src, "utf8"), it.id);
    list.push({
      id: it.id,
      name: it.name,
      category: cat.name,
      categoryId: cat.id,
      tier: "extra",
      source: "lucide",
      sourceLabel: "Lucide",
      sourceVersion: LUCIDE_PKG.version,
      license: "ISC",
      path: `icons/${cat.id}/${it.id}.svg`,
      keywords: it.keywords || [],
      svg: svgOf(body, it.id),
    });
  }
  icons.push(...list);
  categories.push({ id: cat.id, name: cat.name, desc: cat.desc, count: list.length, core: 0, extra: list.length });
}

const manifest = {
  name: "IconLibrary · 待定批次",
  storageKey: "iconlib.batch." + path.basename(batchFile, ".json") + ".v1",
  numbered: true,   // 每张卡片带固定编号，复制编号即可，不必贴长清单
  version: PKG.version + "-batch",
  generatedAt: new Date().toISOString(),
  spec: { viewBox: "0 0 24 24", grid: 24, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", color: "currentColor" },
  source: { package: "lucide-static", version: LUCIDE_PKG.version, license: "ISC", homepage: "https://lucide.dev" },
  counts: { total: icons.length, core: 0, extra: icons.length, categories: categories.length },
  categories,
};

const tpl = fs.readFileSync(path.join(HERE, "template.html"), "utf8");
const html = tpl
  .replace("__ICONLIB_MANIFEST__", () => JSON.stringify(manifest))
  .replace("__ICONLIB_ICONS__", () => JSON.stringify(icons));
fs.writeFileSync(path.join(ROOT, outFile), html);

console.log(`${outFile} · ${icons.length} 枚 / ${categories.length} 类`);
for (const c of categories) console.log(`  ${c.name}: ${c.count}`);
