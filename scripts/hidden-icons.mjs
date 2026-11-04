/**
 * hidden-icons.mjs —— 查「不在 <svg> 里出现」的图标来源
 * ---------------------------------------------------------------------------
 * scan.mjs 只认内联 <svg> 和独立 .svg 文件。以下这些都查不到：
 *   1) 图标字体      @font-face + .woff/.ttf（iconfont、阿里图标库）
 *   2) 图标库 CSS    material-icons / font-awesome / bootstrap-icons / remixicon
 *   3) CSS 引用的图  background-image:url(x.svg)、mask-image
 *   4) <img src="x.svg">
 *   5) SVG sprite    <symbol id> + <use href="#id">
 *   6) 用 emoji 顶图标
 *
 * 用法：node scripts/hidden-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "D:/apps";
/* 只看这些项目；go/postgresql/xianyu 等快照与第三方目录已排除 */
const PROJECTS = [
  "menu", "MemoTrace-master", "oss", "drive", "coco", "ButtonSight",
  "gz-meiye", "lifeos", "films", "xhs", "chatx", "ui", "investment-news-main",
  "clockin-b", "guess", "CipherTalk", "MEMO",
];

const SKIP_DIR = /node_modules|\.git|\.next|\.runtime|\.venv|venv|site-packages|node-v|dist|build|\.cache|backups|outputs|test-results|\.pytest_cache|tmp|temp|\.trae|\.workbuddy|\.review|file|uploads|logs|coverage|\.cdp\d|Extensions|CRX_INSTALL|playwright-report|\.pytest_cache/;
const TEXT_EXT = /\.(html?|css|scss|less|tsx|jsx|ts|js|mjs|vue|svelte|php|astro|svg)$/i;

const RULES = [
  ["图标字体 @font-face", /@font-face[\s\S]{0,300}?(\.woff2?|\.ttf|\.otf)/i],
  ["iconfont 类名", /iconfont|icon-?(font|moon|park)/i],
  ["Material Icons", /material-icons|material-symbols|Material Icons/i],
  ["Font Awesome", /font-awesome|fontawesome|@fortawesome/i],
  ["Bootstrap Icons", /bootstrap-icons|class=["'][^"']*\bbi bi-/i],
  ["Remix Icon", /remixicon|class=["'][^"']*\bri-[a-z]/i],
  ["Iconify", /iconify|api\.iconify\.design/i],
  ["CSS 引用 svg", /url\(\s*['"]?[^)'"]*\.svg/i],
  ["mask-image", /(?:-webkit-)?mask-image/i],
  ["img 引用 svg", /<img[^>]+src=["'][^"']*\.svg/i],
  ["SVG sprite", /<symbol\b|<use\s+(?:xlink:)?href/i],
  ["内联 data:svg", /data:image\/svg\+xml/i],
];

/* emoji 粗筛：只看源码里是否大量出现 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

const result = new Map();
for (const p of PROJECTS) result.set(p, { files: 0, hits: [], emoji: 0, emojiSamples: [], fonts: [] });

function walk(project, dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const rec = result.get(project);
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (SKIP_DIR.test(full.slice(ROOT.length))) continue;
    if (e.isDirectory()) { walk(project, full); continue; }
    if (/\.(woff2?|ttf|otf|eot)$/i.test(e.name)) rec.fonts.push(full.slice(ROOT.length + 1));
    if (!TEXT_EXT.test(e.name)) continue;
    let src;
    try { src = fs.readFileSync(full, "utf8"); } catch { continue; }
    if (src.length > 3_000_000) continue;
    rec.files++;
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, "/");
    for (const [label, re] of RULES) {
      const m = src.match(re);
      if (m) rec.hits.push({ rule: label, file: rel, sample: m[0].slice(0, 120).replace(/\s+/g, " ") });
    }
    const em = src.match(EMOJI);
    if (em) {
      rec.emoji += em.length;
      if (rec.emojiSamples.length < 6) rec.emojiSamples.push({ file: rel, chars: [...new Set(em)].slice(0, 8).join("") });
    }
  }
}

for (const p of PROJECTS) walk(p, path.join(ROOT, p));

/* 汇总 */
for (const [p, rec] of result) {
  const byRule = {};
  for (const h of rec.hits) (byRule[h.rule] ||= []).push(h);
  const rules = Object.entries(byRule).map(([k, v]) => `${k}×${v.length}`).join(" ");
  console.log(`\n== ${p}  源文件 ${rec.files}  emoji ${rec.emoji}  字体文件 ${rec.fonts.length}`);
  if (rec.fonts.length) console.log(`   字体：${rec.fonts.slice(0, 6).join(", ")}`);
  if (rules) console.log(`   命中：${rules}`);
  for (const [rule, list] of Object.entries(byRule)) {
    if (rule === "iconfont 类名" || rule === "CSS 引用 svg" || rule === "img 引用 svg") {
      console.log(`     · ${rule} 例：${list.slice(0, 3).map((x) => x.file).join(", ")}`);
    }
  }
  if (rec.emojiSamples.length) console.log(`    emoji 例：${rec.emojiSamples.map((e) => e.chars + "@" + e.file.split("/").pop()).join("  ")}`);
}
