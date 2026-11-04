/**
 * merge-batch.mjs —— 把人工挑选的分片合并成 demo-batch 能吃的批次文件
 * ---------------------------------------------------------------------------
 * 输入：src/batch-<N>.raw-*.json，每条 ["分类id", "lucide-id", "中文名", ["关键词", …]]
 * 输出：src/batch-<N>.json  { 分类id: [{ id, name, keywords }] }
 *
 * 做的事情只有三件：去重、补足关键词（≥3）、按 CATEGORIES 顺序归类。
 * 用法：node src/merge-batch.mjs 500
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./catalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const N = process.argv[2] || "500";
const files = fs
  .readdirSync(HERE)
  .filter((f) => f.startsWith(`batch-${N}.raw-`) && f.endsWith(".json"))
  .sort();

const seen = new Map();
const rows = [];
for (const f of files) {
  for (const [cat, id, name, keywords] of JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"))) {
    if (seen.has(id)) throw new Error(`重复 id：${id}（${f} 与 ${seen.get(id)}）`);
    seen.set(id, f);
    const kw = [...new Set([...(keywords || []), id])];
    if (kw.length < 3) kw.push(name);
    rows.push({ cat, id, name, keywords: kw });
  }
}

const known = new Set(CATEGORIES.map((c) => c.id));
const out = {};
for (const r of rows) {
  if (!known.has(r.cat)) throw new Error(`未知分类：${r.cat} / ${r.id}`);
  (out[r.cat] ||= []).push({ id: r.id, name: r.name, keywords: r.keywords });
}

const ordered = {};
for (const c of CATEGORIES) if (out[c.id]) ordered[c.id] = out[c.id];

const target = path.join(HERE, `batch-${N}.json`);
fs.writeFileSync(target, JSON.stringify(ordered, null, 1) + "\n");

console.log(`batch-${N}.json · ${rows.length} 枚 / ${Object.keys(ordered).length} 类 ← ${files.length} 个分片`);
for (const c of CATEGORIES) if (ordered[c.id]) console.log(`  ${c.name}: ${ordered[c.id].length}`);
