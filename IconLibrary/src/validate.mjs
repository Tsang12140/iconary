/**
 * validate.mjs —— 对构建产物做机器校验，任何一条失败即退出码 1
 * ---------------------------------------------------------------------------
 * 覆盖：分类数量、ID 唯一、文件存在、SVG 规格（24 网格 / 2px / currentColor）、
 *       路径数据合法性、硬编码颜色、脚本注入、精灵图完整性、demo 引用完整性、
 *       不同 ID 的同形图标（只警告）。
 *
 * 用法：npm run validate
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const errors = [];
const warns = [];
const pass = [];

const ok = (label, detail = "") => pass.push({ label, detail });
const bad = (label, detail) => errors.push({ label, detail });
const warn = (label, detail) => warns.push({ label, detail });

const read = (p) => fs.readFileSync(p, "utf8");
const manifest = JSON.parse(read(path.join(ROOT, "data", "manifest.json")));
const { icons } = JSON.parse(read(path.join(ROOT, "data", "icons.json")));

/* ── 1. 规模 ───────────────────────────────────────────────────────── */
const EXPECT_CATS = 13;
if (manifest.categories.length === EXPECT_CATS) ok(`分类数 = ${EXPECT_CATS}`);
else bad("分类数", `期望 ${EXPECT_CATS}，实际 ${manifest.categories.length}`);

if (icons.length >= 192) ok(`图标总数 ${icons.length} ≥ 192`);
else bad("图标总数", `仅 ${icons.length} 枚`);

const thin = manifest.categories.filter((c) => c.count < 12);
if (thin.length) bad("分类下限", thin.map((c) => `${c.name} 仅 ${c.count} 枚`).join("；"));
else ok("每类 ≥ 12 枚");

if (manifest.counts.total === icons.length) ok("manifest 计数与数据一致");
else bad("计数", `manifest ${manifest.counts.total} ≠ icons.json ${icons.length}`);

/* ── 2. ID / 命名 ──────────────────────────────────────────────────── */
const ids = icons.map((i) => i.id);
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupIds.length) bad("ID 唯一", `重复：${[...new Set(dupIds)].join(", ")}`);
else ok("ID 全局唯一");

const badSlug = icons.filter((i) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.id));
if (badSlug.length) bad("ID 格式", badSlug.map((i) => i.id).join(", "));
else ok("ID 均为 kebab-case");

const noName = icons.filter((i) => !i.name || !i.name.trim());
const noKw = icons.filter((i) => !Array.isArray(i.keywords) || i.keywords.length < 3);
if (noName.length) bad("中文名缺失", noName.map((i) => i.id).join(", "));
else ok("每枚图标均有中文名");
if (noKw.length) bad("关键词不足", noKw.map((i) => `${i.id}(${i.keywords?.length || 0})`).join(", "));
else ok("每枚图标 ≥ 3 个关键词");

/* ── 3. 文件 ───────────────────────────────────────────────────────── */
const missing = icons.filter((i) => !fs.existsSync(path.join(ROOT, i.path)));
if (missing.length) bad("SVG 文件缺失", missing.map((i) => i.path).join(", "));
else ok(`${icons.length} 个 SVG 文件全部存在`);

const pathMismatch = icons.filter((i) => i.path !== `icons/${i.categoryId}/${i.id}.svg`);
if (pathMismatch.length) bad("路径与分类不一致", pathMismatch.slice(0, 5).map((i) => i.id).join(", "));
else ok("文件路径 = icons/<分类>/<id>.svg");


/** 轻量 XML 结构检查：标签配对、引号闭合、自闭合合法 */
function isWellFormed(svg) {
  const src = svg.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(src))) {
    if (src.slice(consumed, m.index).trim()) return false;
    consumed = m.index + m[0].length;
    const [, closing, name, , selfClose] = m;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (src.slice(consumed).trim()) return false;
  return stack.length === 0;
}

/* ── 4. SVG 规格 ───────────────────────────────────────────────────── */
const COLOR_LITERAL = /(fill|stroke)="(?!none|currentColor)(#[0-9a-f]{3,8}|rgb|hsl|[a-z]+)"/i;
const SIZE_CONFLICT = /(?<![\w-])(width|height)="(?!24")/;
const issues = [];

for (const icon of icons) {
  const file = path.join(ROOT, icon.path);
  if (!fs.existsSync(file)) continue;
  const svg = read(file);
  const problems = [];

  if (!/viewBox="0 0 24 24"/.test(svg)) problems.push("viewBox 非 24 网格");
  if (!/stroke="currentColor"/.test(svg)) problems.push("缺少 currentColor");
  if (!/stroke-width="2"/.test(svg)) problems.push("描边非 2px");
  if (!/fill="none"/.test(svg)) problems.push("fill 非 none");
  if (/<script|on\w+\s*=|javascript:/i.test(svg)) problems.push("含脚本");
  if (COLOR_LITERAL.test(svg)) problems.push("硬编码颜色");
  const rootTag = svg.slice(svg.indexOf("<svg"), svg.indexOf(">", svg.indexOf("<svg")) + 1);
  if (SIZE_CONFLICT.test(rootTag)) problems.push("尺寸非 24");

  if (svg.includes("<<")) problems.push("标签重复");
  if (!isWellFormed(svg)) problems.push("标签未闭合");

  const body = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  const shapes = body.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g) || [];
  if (!shapes.length) problems.push("没有可绘制元素");

  for (const shape of shapes) {
    const d = shape.match(/\sd="([^"]*)"/);
    if (d) {
      if (!d[1].trim()) problems.push("path d 为空");
      else if (!/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-+eE]+$/.test(d[1])) problems.push("path d 含非法字符");
      else if (!/^[Mm]/.test(d[1].trim())) problems.push("path 未以 M 开头");
      else if (/NaN|undefined|null/.test(d[1])) problems.push("path 含 NaN/undefined");
    }
    for (const need of ["r", "cx", "cy", "x1", "x2", "y1", "y2", "points"]) {
      const m = shape.match(new RegExp(`\\s${need}="([^"]*)"`));
      if (m && !/^-?[\d.]+([\s,]-?[\d.]+)*$/.test(m[1])) problems.push(`${need} 值非法`);
    }
  }

  if (problems.length) issues.push(`${icon.id}: ${[...new Set(problems)].join(" / ")}`);
}

if (issues.length) bad("SVG 规格", issues.slice(0, 12).join("；") + (issues.length > 12 ? ` …共 ${issues.length} 项` : ""));
else ok("全部 SVG 符合 24 网格 / 2px / currentColor / 无硬编码色");

/* ── 5. 内联 SVG 与文件一致 ────────────────────────────────────────── */
const inlineMismatch = icons.filter((i) => !i.svg?.startsWith("<svg ") || !i.svg.includes(i.id));
if (inlineMismatch.length) bad("内联 SVG 异常", inlineMismatch.slice(0, 5).map((i) => i.id).join(", "));
else ok("数据内联 SVG 完整（可直接复制）");

/* ── 6. 同形检测（不同 ID 但几何完全一致） ─────────────────────────── */
const shapesOf = new Map();
for (const icon of icons) {
  if (!icon.svg) continue;
  const body = icon.svg.slice(icon.svg.indexOf(">") + 1, icon.svg.lastIndexOf("</svg>"));
  const fingerprint = createHash("sha1").update(body.replace(/\s+/g, " ").trim()).digest("hex");
  if (!shapesOf.has(fingerprint)) shapesOf.set(fingerprint, []);
  shapesOf.get(fingerprint).push(icon.id);
}
const twinGroups = [...shapesOf.values()].filter((g) => g.length > 1);
if (twinGroups.length) warn("不同 ID 的同形图标", twinGroups.map((g) => g.join(" = ")).join("；"));
else ok("无同形重复图标");

/* ── 7. 精灵图 ─────────────────────────────────────────────────────── */
const spritePath = path.join(ROOT, "icons", "sprite.svg");
if (!fs.existsSync(spritePath)) bad("精灵图缺失", "icons/sprite.svg");
else {
  const sprite = read(spritePath);
  const symbols = [...sprite.matchAll(/<symbol id="il-([a-z0-9-]+)"/g)].map((m) => m[1]);
  const missingSym = ids.filter((id) => !symbols.includes(id));
  if (symbols.length !== icons.length || missingSym.length)
    bad("精灵图不完整", `symbol ${symbols.length} / 图标 ${icons.length}，缺 ${missingSym.slice(0, 5).join(", ")}`);
  else ok(`sprite.svg 含全部 ${symbols.length} 个 symbol`);
}

/* ── 8. demo 页 ────────────────────────────────────────────────────── */
const demoPath = path.join(ROOT, "index.html");
if (!fs.existsSync(demoPath)) bad("demo 页缺失", "index.html");
else {
  const html = read(demoPath);
  const missed = ids.filter((id) => !html.includes(`"${id}"`));
  if (missed.length) bad("demo 数据不完整", `缺 ${missed.length} 枚：${missed.slice(0, 5).join(", ")}`);
  else ok(`index.html 内联全部 ${ids.length} 枚图标`);

  for (const feature of ["全选", "全不选", "复制选中", "下载 SVG"]) {
    if (!html.includes(feature)) bad("demo 功能缺失", feature);
  }
  if (!errors.length) ok("demo 含全选 / 全不选 / 复制 / 下载");
}

/* ── 报告 ─────────────────────────────────────────────────────────── */
const line = "─".repeat(64);
console.log(`\n${line}\nIconLibrary 校验报告 · ${new Date().toLocaleString("zh-CN")}\n${line}`);
for (const p of pass) console.log(`  ✓ ${p.label}${p.detail ? `  ${p.detail}` : ""}`);
for (const w of warns) console.log(`  ! ${w.label}  ${w.detail}`);
for (const e of errors) console.log(`  ✗ ${e.label}  ${e.detail}`);
console.log(line);
console.log(`通过 ${pass.length} · 警告 ${warns.length} · 失败 ${errors.length}`);

if (errors.length) {
  console.log(`\n校验未通过。\n`);
  process.exit(1);
}
console.log(`\n校验通过：${icons.length} 枚图标可直接使用。\n`);
