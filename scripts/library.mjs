/**
 * library.mjs —— 把 IconLibrary 并进图标仓
 * ---------------------------------------------------------------------------
 * 数据源：IconLibrary/data/icons.json（由 IconLibrary/src/build.mjs 从
 * lucide-static 安装包里抽取生成，不要手改这一份）。
 *
 * 映射到图标仓的字段：
 *   id/slug   lib-<lucide id>     公开 id 带 lib- 前缀，绝不抢现有图标的 id
 *   scene     分类                只有 13 类，见 scripts/taxonomy.mjs
 *   alias     关键词              中英文搜索词，进搜索也进卡片副行
 *   origin    open-source         来源维度归到「开源移植」
 *   license   ISC · Lucide
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "IconLibrary", "data", "icons.json");
const MANIFEST = path.join(ROOT, "IconLibrary", "data", "manifest.json");

/** 统一根标签：去掉 library 自带的 class / aria / 宽高，只留 24 网格 + currentColor */
function canonicalSvg(svg) {
  const open = svg.indexOf("<svg");
  if (open < 0) return svg.trim();
  const headEnd = svg.indexOf(">", open) + 1;
  const body = svg
    .slice(headEnd, svg.lastIndexOf("</svg>"))
    .replace(/\s*\n\s*/g, "")
    .trim();
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    "</svg>"
  );
}

export function loadLibrary() {
  if (!fs.existsSync(SRC)) {
    console.warn("！没找到 IconLibrary/data/icons.json，跳过图标库。先跑：node IconLibrary/src/build.mjs");
    return { icons: [], meta: null };
  }
  const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const list = Array.isArray(data) ? data : data.icons || [];
  const meta = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : null;

  const icons = list.map((it) => {
    const id = `lib-${it.id}`;
    const keywords = (it.keywords || []).filter(Boolean);
    return {
      id,
      name: it.name,
      slug: id,
      project: "lucide",
      // 分类只有一套口径（scripts/taxonomy.mjs），scene 直接用图标库的分类名
      scene: it.category,
      alias: keywords.join(" "),
      license: "ISC · Lucide",
      origin: "open-source",
      source: `lucide-static@${it.sourceVersion}/icons/${it.id}.svg`,
      viewBox: "0 0 24 24",
      kind: "stroke",
      svg: canonicalSvg(it.svg),
      usedIn: ["lucide"],
      // 只给构建期统计用，不进产物
      _category: it.category,
      _tier: it.tier,
    };
  });

  return { icons, meta };
}
