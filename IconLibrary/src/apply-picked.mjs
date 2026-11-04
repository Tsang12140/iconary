/**
 * apply-picked.mjs —— 把待选页勾中的编号落到 catalog.mjs
 * ---------------------------------------------------------------------------
 * 输入：$TEMP/picked.json（[{ id, name, cat, keywords }]，已按编号还原）
 * 行为：在各分类 icons 数组末尾以 e() 追加，tier = extra。
 * 只改 catalog.mjs，不碰 icons/ 与 data/（那是 build 的事）。
 * 用法：node src/apply-picked.mjs
 */
import fs from "node:fs";
import path from "node:path";

const PICKED = path.join(process.env.TEMP, "picked.json");
const CATALOG = "src/catalog.mjs";

const picked = JSON.parse(fs.readFileSync(PICKED, "utf8"));
const byCat = {};
for (const p of picked) (byCat[p.cat] ||= []).push(p);

const src = fs.readFileSync(CATALOG, "utf8");
const existing = new Set([...src.matchAll(/(?:^|[^a-z])[ce]\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
const clash = picked.filter((p) => existing.has(p.id));
if (clash.length) throw new Error("已存在于 catalog：" + clash.map((c) => c.id).join(", "));

const lines = src.split(/\r?\n/);
const EOL = src.includes("\r\n") ? "\r\n" : "\n";
const out = [];
let cur = null;
let inserted = 0;

for (const line of lines) {
  const m = line.match(/^ {4}id: "([a-z0-9-]+)",$/);
  if (m) cur = m[1];
  if (cur && /^ {4}\],$/.test(line) && byCat[cur]) {
    for (const p of byCat[cur]) {
      const kws = "[" + p.keywords.map((k) => JSON.stringify(k)).join(", ") + "]";
      out.push(`      e(${JSON.stringify(p.id)}, ${JSON.stringify(p.name)}, ${kws}),`);
      inserted++;
    }
    delete byCat[cur];
    cur = null;
  }
  out.push(line);
}

const left = Object.keys(byCat);
if (left.length) throw new Error("这些分类没找到插入点：" + left.join(", "));

fs.writeFileSync(CATALOG, out.join(EOL));
console.log(`catalog.mjs 追加 ${inserted} 条`);
for (const p of picked.slice(0, 0)) void p;
