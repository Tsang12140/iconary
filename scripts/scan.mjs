/**
 * scan.mjs —— 遍历 D:\apps 里所有项目，收集候选图标
 * ---------------------------------------------------------------------------
 * 只扫描，不改动任何项目。输出 data\candidates.json 供人工/AI 审核命名。
 *
 * 候选来源：
 *   1) 独立 .svg 文件（排除 node_modules / 构建产物 / 缓存 / 交付副本 / 废弃项目）
 *   2) 源码内联 <svg>…</svg>（src / components / app / pages / public 等成品目录）
 *
 * 判定“是否在成品里用过”：
 *   - 独立 svg：文件名被某个源码/页面引用 → used=true，否则 unknown
 *   - 内联 svg：位于成品目录 → used=true，否则 unknown
 *
 * 用法：node scripts/scan.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";
import { createHash } from "node:crypto";

const ROOT = "D:\\apps";
const LIB = "D:\\apps\\icons";
const OUT = join(LIB, "data", "candidates.json");

/** 整目录跳过（大小写不敏感，按路径段匹配） */
const SKIP_DIR = new RegExp(
  [
    "^node_modules$", "^\\.git$", "^\\.next$", "^\\.nuxt$", "^dist$", "^build$", "^out$",
    "^coverage$", "^\\.review$", "^\\.workbuddy$", "^tmp$", "^temp$", "^.tmp_tests$",
    "^\\.cache$", "^\\.turbo$", "^\\.nx$", "^\\.venv$", "^venv$", "^__pycache__$",
    "^target$", "^\\.gradle$", "^\\.idea$", "^\\.vscode$", "^\\.trae$", "^\\.github$",
    "^\\.storybook$", "^storybook-static$", "^playwright-browsers$", "^node-v",
    "^交付$", "^废弃$", "^outputs$", "^demos?$", "^preview$", "^previews$",
    "^__tests__$", "^tests?$", "^e2e$", "^backup$", "^bak$", "^备份$", "^scratch$",
    "^logs$", "^CRX_INSTALL$", "^Extensions$", "^chrome$", "^profiles?$",
    "^\\.pnpm$", "^vendor$", "^\\.yarn$", "^site-packages$", "^pgAdmin 4$",
    "^\\.snapshots$", "^\\.dev$", "^.*-review$", "^.*-Backup.*$", "^honor-demo$",
  ].join("|"),
  "i"
);

const TEXT_EXT = new Set([".html", ".htm", ".tsx", ".jsx", ".ts", ".js", ".mjs", ".vue", ".css", ".scss", ".svelte"]);
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_SVG = 512 * 1024;

/** 只读这些目录里的源码，避免读聊天记录导出等海量数据文件 */
const PRODUCT_DIR = /(^|\/)(src|app|apps|components?|pages|views|layouts|public|lib|ui)\//i;
const PAGE_FILE = /^(index|login|main|home|dashboard|app|404|about)\.(html?|vue)$/i;

const svgFiles = [];
const textFiles = [];
let dirCount = 0;
let fileCount = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  dirCount++;
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      walk(full);
      continue;
    }
    if (!e.isFile()) continue;
    fileCount++;
    const ext = extname(e.name).toLowerCase();
    if (ext === ".svg") { svgFiles.push(full); continue; }
    if (!TEXT_EXT.has(ext)) continue;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (PRODUCT_DIR.test(rel) || PAGE_FILE.test(e.name)) textFiles.push(full);
  }
}

walk(ROOT);

const project = (p) => {
  const rel = relative(ROOT, p).split("\\");
  if (rel[0] === "新建文件夹" && rel[1]) return `新建文件夹/${rel[1]}`;
  return rel[0];
};

const norm = (s) => s.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
const fingerprint = (viewBox, inner) =>
  createHash("sha1").update(norm((viewBox || "") + "|" + inner)).digest("hex").slice(0, 12);

function parseSvg(src) {
  const m = src.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!m) return null;
  const attrs = m[1];
  const vb = attrs.match(/viewBox\s*=\s*"([^"]*)"|viewBox\s*=\s*'([^']*)'/i);
  const viewBox = vb ? (vb[1] || vb[2]).trim() : "";
  const inner = m[2].trim();
  const kind = /stroke\s*=\s*"(?!none)/i.test(attrs) || /stroke-width/i.test(attrs) ? "stroke" : "fill";
  if (/<image\b/i.test(inner)) return null;
  const cleanAttrs = attrs
    .replace(/\bclass\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { viewBox, inner, kind, attrs: cleanAttrs, full: m[0] };
}

/** 内联 svg 前后文纯文本，用来抓按钮标题/aria-label */
const plain = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** 内联 svg 前文里的组件/函数名，作为命名线索 */
function contextOf(src, idx) {
  const before = src.slice(Math.max(0, idx - 900), idx);
  const patterns = [
    /export\s+(?:default\s+)?function\s+([A-Za-z0-9_]+)/g,
    /function\s+([A-Za-z0-9_]+)/g,
    /const\s+([A-Za-z0-9_]+)\s*=/g,
  ];
  let best = "";
  for (const re of patterns) {
    let mm;
    while ((mm = re.exec(before))) best = mm[1];
  }
  const labels = [...before.matchAll(/(?:aria-label|title|alt|name)\s*=\s*["']([^"']{1,40})["']/g)].map((x) => x[1]);
  return { ident: best, labels: labels.slice(-3) };
}

const isProductPath = (rel) => PRODUCT_DIR.test(rel + "/") || PAGE_FILE.test(basename(rel));

// ---------- 1. 独立 svg ----------
const candidates = [];
for (const f of svgFiles) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  if (src.length > MAX_SVG) continue;
  const parsed = parseSvg(src);
  candidates.push({
    id: "",
    source: "file",
    project: project(f),
    path: rel,
    file: basename(f),
    name: basename(f, ".svg"),
    viewBox: parsed ? parsed.viewBox : "",
    kind: parsed ? parsed.kind : "unknown",
    inner: parsed ? parsed.inner : "",
    attrs: parsed ? parsed.attrs : "",
    fingerprint: fingerprint(parsed ? parsed.viewBox : "", parsed ? parsed.inner : ""),
    used: "unknown",
    refs: [],
    notes: parsed ? "" : "无法解析 svg 主体",
  });
}

// ---------- 2. 内联 svg ----------
const inlineRe = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
for (const f of textFiles) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  if (src.length > MAX_TEXT || src.indexOf("<svg") === -1) continue;
  inlineRe.lastIndex = 0;
  let m;
  while ((m = inlineRe.exec(src))) {
    const block = m[0];
    if (block.length > 120000) continue;
    const parsed = parseSvg(block);
    if (!parsed) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const ctx = contextOf(src, m.index);
    candidates.push({
      id: "",
      source: "inline",
      project: project(f),
      path: rel,
      file: basename(f),
      name: ctx.ident || basename(f, extname(f)),
      line,
      viewBox: parsed.viewBox,
      kind: parsed.kind,
      inner: parsed.inner,
      attrs: parsed.attrs,
      fingerprint: fingerprint(parsed.viewBox, parsed.inner),
      used: isProductPath(rel) ? "true" : "unknown",
      refs: [],
      labels: ctx.labels,
      near: (src.slice(Math.max(0, m.index - 320), m.index) + " ⟪ " + src.slice(m.index + block.length, m.index + block.length + 320))
        .replace(/\s+/g, " ")
        .slice(-300),
      beforeText: plain(src.slice(Math.max(0, m.index - 200), m.index)).slice(-90),
      afterText: plain(src.slice(m.index + block.length, m.index + block.length + 240)).slice(0, 90),
      notes: parsed.viewBox ? "" : "缺 viewBox",
    });
  }
}

// ---------- 3. 独立 svg 的引用检查 ----------
const textCache = [];
for (const f of textFiles) {
  try {
    const s = readFileSync(f, "utf8");
    if (s.length <= MAX_TEXT && (s.includes(".svg") || s.includes("<svg"))) {
      textCache.push([relative(ROOT, f).replace(/\\/g, "/"), s]);
    }
  } catch {}
}
for (const c of candidates) {
  if (c.source !== "file") continue;
  const refs = [];
  for (const [p, s] of textCache) {
    if (p === c.path) continue;
    if (s.includes(c.file)) refs.push(p);
  }
  c.refs = refs.slice(0, 6);
  c.used = refs.length ? "true" : "unknown";
}

// ---------- 4. 去重 ----------
const groups = new Map();
for (const c of candidates) {
  if (!groups.has(c.fingerprint)) groups.set(c.fingerprint, []);
  groups.get(c.fingerprint).push(c);
}

const deduped = [];
for (const [fp, list] of groups) {
  const best = list.find((x) => x.source === "file") || list[0];
  deduped.push({
    ...best,
    id: fp,
    occurrences: list.length,
    alsoIn: [...new Set(list.map((x) => x.path))].slice(0, 8),
  });
}
deduped.sort((a, b) => (a.project + a.name).localeCompare(b.project + b.name));

// ---------- 5. 输出 ----------
mkdirSync(join(LIB, "data"), { recursive: true });
const stats = {
  scannedAt: new Date().toISOString(),
  dirs: dirCount,
  files: fileCount,
  svgFiles: svgFiles.length,
  textFiles: textFiles.length,
  rawCandidates: candidates.length,
  deduped: deduped.length,
  byProject: {},
  bySource: { file: 0, inline: 0 },
  used: { true: 0, unknown: 0 },
};
for (const d of deduped) {
  stats.byProject[d.project] = (stats.byProject[d.project] || 0) + 1;
  stats.bySource[d.source]++;
  stats.used[d.used]++;
}
writeFileSync(OUT, JSON.stringify({ stats, icons: deduped }, null, 2), "utf8");
console.log(JSON.stringify(stats, null, 2));
console.log("→ " + OUT);
