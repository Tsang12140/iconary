/**
 * IconLibrary · 运行时模块（纯 ESM，无依赖，Node / 浏览器 / 打包器通用）
 * ---------------------------------------------------------------------------
 *   import { searchIcons, renderIcon, ICONS } from "./IconLibrary/library/index.mjs";
 *
 *   searchIcons("支付")                  → 命中数组
 *   renderIcon("credit-card", { size: 20 })  → '<svg …>'
 *
 * 数据来自 ./icons.mjs（构建产物），与 data/icons.json 内容一致。
 */
import { MANIFEST, ICONS } from "./icons.mjs";

export { MANIFEST, ICONS };
export const categories = MANIFEST.categories;
export const total = ICONS.length;

const byId = new Map(ICONS.map((icon) => [icon.id, icon]));

/** 每条记录预先拼好的小写检索串 */
const SHORT = /^[a-z0-9]{1,2}$/;
const haystack = new Map(
  ICONS.map((icon) => [
    icon.id,
    [icon.name, icon.id, icon.category, icon.tier, ...(icon.keywords || [])]
      .join(" ")
      .toLowerCase(),
  ])
);

export function getIcon(id) {
  return byId.get(id) || null;
}

export function hasIcon(id) {
  return byId.has(id);
}

export function svgOf(id) {
  return byId.get(id)?.svg || "";
}

/**
 * 关键词检索。空格分隔 = AND。
 * @param {string} query
 * @param {{ category?: string, tier?: "core"|"extra", limit?: number }} [options]
 */
export function searchIcons(query = "", options = {}) {
  const tokens = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const icon of ICONS) {
    if (options.category && icon.categoryId !== options.category) continue;
    if (options.tier && icon.tier !== options.tier) continue;
    const hay = haystack.get(icon.id);
    if (!tokens.every((token) => (SHORT.test(token) ? new RegExp(`(^|\\s)${token}($|\\s)`).test(hay) : hay.includes(token)))) continue;
    out.push(icon);
    if (options.limit && out.length >= options.limit) break;
  }
  return out;
}

export function iconsByCategory(categoryId) {
  return ICONS.filter((icon) => icon.categoryId === categoryId);
}

/**
 * 生成一段可直接插入 DOM 的 SVG 字符串。
 * @param {string} id
 * @param {{ size?: number|string, className?: string, strokeWidth?: number, title?: string }} [options]
 */
export function renderIcon(id, options = {}) {
  const icon = byId.get(id);
  if (!icon) return "";
  const { size = 24, className = "", strokeWidth = 2, title = "" } = options;

  let svg = icon.svg;
  if (size !== 24) {
    svg = svg.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
  }
  if (strokeWidth !== 2) svg = svg.replace('stroke-width="2"', `stroke-width="${strokeWidth}"`);
  if (className) svg = svg.replace('class="', `class="${className} `);
  if (title) {
    svg = svg
      .replace('aria-hidden="true"', 'role="img"')
      .replace(">", `><title>${escapeHtml(title)}</title>`);
  }
  return svg;
}

/** CSS background-image / <img src> 用的 Data URI */
export function toDataUri(id) {
  const svg = byId.get(id)?.svg;
  if (!svg) return "";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 生成 <use> 引用精灵图的片段（需自行部署 icons/sprite.svg） */
export function spriteRef(id, { size = 24, className = "il-icon", href = "sprite.svg" } = {}) {
  return `<svg class="${className}" width="${size}" height="${size}" aria-hidden="true"><use href="${href}#il-${id}"/></svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
