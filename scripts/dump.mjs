/**
 * dump.mjs —— 打印某个项目的候选项，供人工/AI 审核
 * 用法：node scripts/dump.mjs [project] [--all]
 */
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../data/matched.json", import.meta.url), "utf8"));
const project = process.argv[2];
const showAll = process.argv.includes("--all");
const junk = /linearGradient|radialGradient|<filter|<mask|<image|foreignObject/;
const iconLike = (c) => {
  const vb = (c.viewBox || "").split(" ").map(Number);
  return vb[2] && vb[3] && vb[2] <= 80 && vb[3] <= 80 && !junk.test(c.inner) && c.inner.length <= 1800;
};
const list = d.icons.filter((c) => (project ? c.project === project : true) && (showAll || iconLike(c)));
let i = 0;
for (const c of list) {
  const attrs = [...c.inner.matchAll(/<([a-zA-Z]+)\s*([^>]*)>/g)].map((m) => m[1]).filter((x) => x !== "path");
  const ds = [...c.inner.matchAll(/d="([^"]*)"/g)].map((m) => m[1]).join(" | ");
  const near = (c.near || "").replace(/\s+/g, " ").slice(0, 140);
  console.log(`#${++i} [${c.id}] ${c.project} | ${c.path.replace(c.project + "/", "")}${c.line ? ":" + c.line : ""}`);
  console.log(`   name=${c.name} vb=${c.viewBox} kind=${c.kind} len=${c.inner.length} tags=${attrs.join(",")} used=${c.used} occ=${c.occurrences}${c.lucide ? " LUCIDE=" + c.lucide : ""}`);
  console.log(`   d=${ds.slice(0, 220)}`);
  if (near) console.log(`   near=${near}`);
}
console.log(`\n[${list.length} items]`);
