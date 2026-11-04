/**
 * fetch-fa.mjs —— 补收 menu 页面里用到的 Font Awesome 6 图标
 * ---------------------------------------------------------------------------
 * menu/index.html 通过 CDN 引 FA 字体，源码里只有 <i class="fa-solid fa-xxx">，
 * 没有 svg 实体。这里按类名从 fontawesome-free 包取官方 SVG。
 *
 * 用法：node scripts/fetch-fa.mjs
 */
import fs from "node:fs";

const HTML = "D:/apps/menu/index.html";
const ICONS = "D:/apps/icons/data/icons.json";
const CDN = (n) => `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/svgs/solid/${n}.svg`;
const PROJECT = "menu";
const PREFIX = "menu";

/** FA 名 → [中文名, 类型, 标签] */
const NAMES = {
  unlock: ["解锁", "安全", ["解锁", "进入"]],
  plus: ["添加", "操作", ["新增"]],
  download: ["下载", "操作", ["下载"]],
  palette: ["调色板", "操作", ["配色", "主题"]],
  check: ["勾选", "状态", ["确认", "完成"]],
  spinner: ["加载中", "状态", ["加载", "等待"]],
  xmark: ["关闭", "操作", ["关闭", "清除"]],
  copy: ["复制", "操作", ["复制"]],
  "arrow-up-right-from-square": ["外链", "操作", ["跳转", "打开"]],
};

const html = fs.readFileSync(HTML, "utf8");
const names = [...new Set(
  [...html.matchAll(/\bfa-(?:solid|regular|brands)\s+fa-([a-z0-9-]+)/g)]
    .map((m) => m[1])
    .filter((n) => n !== "spin")
)];

const icons = JSON.parse(fs.readFileSync(ICONS, "utf8"));
let added = 0;
const failed = [];

for (const name of names) {
  const id = `${PREFIX}-${name}`;
  if (icons.some((i) => i.id === id)) continue;
  const meta = NAMES[name];
  if (!meta) { failed.push(name + "（缺命名）"); continue; }
  let raw;
  try {
    const res = await fetch(CDN(name));
    if (!res.ok) { failed.push(`${name}（HTTP ${res.status}）`); continue; }
    raw = await res.text();
  } catch (e) {
    failed.push(`${name}（${e.message}）`);
    continue;
  }
  const vb = (raw.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 512 512";
  const inner = (raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [])[1]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const [cn, type, tags] = meta;
  icons.push({
    id,
    name: cn,
    slug: name,
    project: PROJECT,
    usedIn: [PROJECT],
    type,
    tags: [...new Set([type, "Font Awesome", ...tags])],
    license: "CC BY 4.0 · Font Awesome Free",
    origin: "open-source",
    source: `menu/index.html（fa-solid fa-${name}，CDN 引用）`,
    viewBox: vb,
    kind: "fill",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="currentColor">${inner}</svg>`,
  });
  added++;
}

fs.writeFileSync(ICONS, JSON.stringify(icons, null, 2));
console.log(`menu 用到 ${names.length} 个 FA 图标，新增 ${added} 个，共 ${icons.length} 个`);
if (failed.length) console.log("未收录：", failed.join("; "));
