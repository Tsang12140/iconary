/**
 * add-brand.mjs —— 补收「宽幅 / 体积大」的品牌资产
 * ---------------------------------------------------------------------------
 * 这类图标用 <img src="x.svg"> 引用，本身不是方形符号，scan 能扫到，
 * 但生成总览图时被 iconLike（viewBox ≤ 80 且 inner ≤ 1800）过滤掉了，
 * 所以从没进入命名环节。这里按路径点名补收。
 *
 * 用法：node scripts/add-brand.mjs
 */
import fs from "node:fs";
import { toSvg } from "./svg-utils.mjs";

const CANDIDATES = "D:/apps/icons/data/candidates.json";
const ICONS = "D:/apps/icons/data/icons.json";

/** path 片段 → [id, 中文名, 类型, 标签] */
const TARGETS = [
  ["gz-meiye/public/assets/logo-kyhui.svg", "gz-main-wordmark", "科颜荟字标（完整）", "品牌", ["科颜荟", "字标", "宽幅"]],
  ["lifeos/apps/web/public/favicon.svg", "lifeos-brand-mark", "LifeOS 标记", "品牌", ["LifeOS", "品牌标记"]],
];

const { icons: candidates } = JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));
const icons = JSON.parse(fs.readFileSync(ICONS, "utf8"));

let added = 0;
for (const [match, id, name, type, tags] of TARGETS) {
  if (icons.some((i) => i.id === id)) continue;
  const c = candidates.find((x) => (x.path || x.file || "").includes(match));
  if (!c) { console.log("候选里找不到", match); continue; }
  const project = match.split("/")[0];
  icons.push({
    id,
    name,
    slug: id.split("-").slice(1).join("-"),
    project,
    usedIn: [project],
    type,
    tags: [...new Set([type, ...tags])],
    license: "自有",
    origin: "own",
    source: `${c.path}${c.line ? ":" + c.line : ""}（<img> 引用）`,
    viewBox: c.viewBox,
    kind: c.kind,
    svg: toSvg(c),
  });
  added++;
}

fs.writeFileSync(ICONS, JSON.stringify(icons, null, 2));
console.log(`补收 ${added} 个品牌资产，共 ${icons.length} 个`);
