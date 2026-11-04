/**
 * match.mjs —— 把候选项与 lucide 官方图标集做几何指纹比对
 * 命中就说明这个图标来自 lucide，可以直接用 lucide 的名字（准确率最高）。
 * 用法：node scripts/match.mjs
 * 输出：data/matched.json
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LUCIDE = "C:\\Users\\Tsang\\Documents\\Trae-CN\\temp_20261101_01\\lucide-ref\\node_modules\\lucide-static\\icons";
const SRC = new URL("../data/candidates.json", import.meta.url);

const GEOM = ["d", "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "transform", "fill-rule", "clip-rule", "pathLength"];
function geomKey(inner) {
  const out = [];
  for (const m of inner.matchAll(/<([a-zA-Z]+)\s*(.*?)>/gs)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const parts = [];
    for (const g of GEOM) {
      const re = new RegExp(g + "=\"([^\"]*)\"");
      const a = attrs.match(re);
      if (a) parts.push(g + ":" + a[1].replace(/\s+/g, ""));
    }
    out.push(tag + "(" + parts.join(";") + ")");
  }
  return out.join(">");
}

const lucide = new Map();
for (const f of readdirSync(LUCIDE)) {
    if (!f.endsWith(".svg")) continue;
  const name = f.replace(".svg", "");
  const src = readFileSync(join(LUCIDE, f), "utf8");
  const inner = (src.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i) || [])[1] || "";
  const key = geomKey(inner);
  if (!lucide.has(key)) lucide.set(key, name);
}

const data = JSON.parse(readFileSync(SRC, "utf8"));
const junk = /linearGradient|radialGradient|<filter|<mask|<image|foreignObject/;
const iconLike = (c) => {
  const vb = (c.viewBox || "").split(" ").map(Number);
  return vb[2] && vb[3] && vb[2] <= 80 && vb[3] <= 80 && !junk.test(c.inner) && c.inner.length <= 1800;
};

let hit = 0, total = 0;
const icons = data.icons.map((c) => {
  if (!iconLike(c)) return { ...c, lucide: null };
  total++;
  const key = geomKey(c.inner);
  let name = lucide.get(key) || null;
  if (!name) {
    // 退化匹配：只比第一段路径（有些项目合了多段 path）
    const firstPath = c.inner.match(/<path[^>]*>/);
    if (firstPath) {
      const fp = geomKey(firstPath[0]);
      for (const [k, v] of lucide) {
        if (k.startsWith(fp)) { name = v; break; }
      }
    }
  }
  if (name) hit++;
  return { ...c, lucide: name };
});

writeFileSync(new URL("../data/matched.json", import.meta.url), JSON.stringify({ stats: { ...data.stats, total, hit }, icons }, null, 2));
console.log(`lucide 命中 ${hit}/${total}`);
const byP = {};
for (const c of icons) if (c.lucide) byP[c.project] = (byP[c.project] || 0) + 1;
console.log(byP);
