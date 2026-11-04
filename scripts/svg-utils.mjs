/**
 * svg-utils.mjs —— 图标清洗与输出（sheet / build 复用）
 */
const CAMEL = {
  strokeWidth: "stroke-width", strokeLinecap: "stroke-linecap", strokeLinejoin: "stroke-linejoin",
  fillRule: "fill-rule", clipRule: "clip-rule", strokeMiterlimit: "stroke-miterlimit",
  strokeOpacity: "stroke-opacity", fillOpacity: "fill-opacity",
};
const KEEP_ATTR = ["stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "stroke-miterlimit", "stroke-opacity", "fill-opacity", "opacity"];

function parseAttrs(s) {
  const out = {};
  for (const m of (s || "").matchAll(/([a-zA-Z:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
    out[CAMEL[m[1]] || m[1]] = m[2].slice(1, -1);
  }
  return out;
}

/** 生成可独立使用的 svg 字符串 */
export function toSvg(c, { size = 0, color = "currentColor" } = {}) {
  const a = parseAttrs(c.attrs);
  const viewBox = c.viewBox || a.viewBox || "0 0 24 24";
  const parts = ['xmlns="http://www.w3.org/2000/svg"', `viewBox="${viewBox}"`];
  if (size) parts.push(`width="${size}"`, `height="${size}"`);
  const fill = a.fill || (c.kind === "stroke" ? "none" : color);
  parts.push(`fill="${fill}"`);
  const stroke = a.stroke || (c.kind === "stroke" ? color : "");
  if (stroke) parts.push(`stroke="${stroke}"`);
  for (const k of KEEP_ATTR) if (a[k] != null) parts.push(`${k}="${a[k]}"`);
  return `<svg ${parts.join(" ")}>${c.inner}</svg>`;
}

export function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
