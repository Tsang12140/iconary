/**
 * lucide-usage.mjs —— 统计项目里通过 import 使用的图标库图标
 * ---------------------------------------------------------------------------
 * 内联 <svg> 会被 scan.mjs 收到；但 <Users/> 这种来自 lucide-react 的组件
 * 在源码里没有 svg 实体，必须靠 import 语句反查。
 * 输出 data/lucide-usage.json：每个图标名 → 用到的文件、次数、SVG 实体。
 *
 * 用法：node scripts/lucide-usage.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC_ROOTS = [
  "D:/apps/clockin-b/app",
  "D:/apps/clockin-b/components",
  "D:/apps/clockin-b/lib",
];
const SKIP = /node_modules|\.next|\.runtime|test-results|backups|outputs|\.git|dist/;
const EXT = /\.(tsx|ts|jsx|js|vue|svelte)$/;
const LUCIDE_DIR = "C:/Users/Tsang/Documents/Trae-CN/temp_20261101_01/lucide-ref/node_modules/lucide-static/icons";
const OUT = "D:/apps/icons/data/lucide-usage.json";

/* PascalCase → lucide 文件名（kebab） */
const toKebab = (s) =>
  s.replace(/([a-z])([A-Z])/g, "$1-$2")
   .replace(/([A-Za-z])(\d)/g, "$1-$2")
   .toLowerCase();

const files = [];
function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (EXT.test(e.name)) files.push(p);
  }
}
for (const r of SRC_ROOTS) walk(r);

const usage = new Map(); // PascalName → { files:[], count }

/* import { A, B as C } from 'lucide-react'  以及跨行写法 */
const RE = /import\s+(type\s+)?(?:[^"'{}]*,\s*)?\{([^}]*)\}\s*from\s+["']lucide-react["']/g;

for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (!src.includes("lucide-react")) continue;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m[1]) continue; // import type { LucideIcon } 不算
    for (const raw of m[2].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name || !/^[A-Z]/.test(name)) continue;
      if (name === "LucideIcon" || name === "Icon") continue; // 类型 / 命名空间占位
      const rec = usage.get(name) || { files: [], count: 0 };
      const rel = path.relative("D:/apps", f).replace(/\\/g, "/");
      if (!rec.files.includes(rel)) rec.files.push(rel);
      rec.count++;
      usage.set(name, rec);
    }
  }
}

/* 取 SVG 实体 */
const icons = [];
const missing = [];
for (const [pascal, rec] of [...usage.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const kebab = toKebab(pascal);
  const p = path.join(LUCIDE_DIR, kebab + ".svg");
  if (!fs.existsSync(p)) { missing.push(`${pascal} → ${kebab}`); continue; }
  const raw = fs.readFileSync(p, "utf8");
  const vb = (raw.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 24 24";
  const inner = (raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [])[1] || "";
  icons.push({ pascal, name: kebab, viewBox: vb, inner: inner.replace(/\s+/g, " ").trim(), count: rec.count, files: rec.files });
}

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: icons.length, icons, missing }, null, 2));
console.log(`扫描 ${files.length} 个源文件，命中 ${icons.length} 个图标`);
if (missing.length) console.log("未找到实体：", missing.join(", "));
console.log("Top 15：" + icons.slice(0, 15).map((i) => `${i.name}(${i.count})`).join(" "));
