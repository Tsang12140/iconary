/**
 * sheet.mjs —— 把候选图标渲染成一张总览图，便于逐个看图命名
 * 用法：node scripts/sheet.mjs
 * 输出：data/sheet.png、data/sheet-map.tsv
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("C:\\Users\\Tsang\\Documents\\Trae-CN\\temp_20261101_01\\sharp-ref\\node_modules\\sharp");
import { toSvg, escapeXml } from "./svg-utils.mjs";

const items = JSON.parse(readFileSync(new URL("../data/curated.json", import.meta.url), "utf8"));
const PART = Number(process.argv[2] || 1);
const PER = 56;
const start = (PART - 1) * PER;
const page = items.slice(start, start + PER);
const COLS = 6, CELL = 168, ICON = 112;
const rows = Math.ceil(page.length / COLS);
const W = COLS * CELL, H = rows * CELL + 40;

const composites = [];
const cells = [];
for (let i = 0; i < page.length; i++) {
  const c = page[i];
  const x = (i % COLS) * CELL + (CELL - ICON) / 2;
  const y = Math.floor(i / COLS) * CELL + 34;
  let buf;
  try {
    const svg = toSvg(c, { size: ICON, color: "#111111" }).replace(/currentColor/g, "#111111");
    buf = await sharp(Buffer.from(svg, "utf8"), { density: 300 })
      .resize(ICON, ICON, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png().toBuffer();
  } catch {
    cells.push({ left: x, top: y, input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}"><rect width="100%" height="100%" fill="#ffe6e6"/></svg>`) });
    continue;
  }
  cells.push({ left: x, top: y, input: buf });
}

const labels = [];
for (let i = 0; i < page.length; i++) {
  const c = page[i];
  const x = (i % COLS) * CELL + 8;
  const rowY = Math.floor(i / COLS) * CELL;
  labels.push(`<text x="${x}" y="${rowY + 22}" font-family="Consolas, monospace" font-size="18" fill="#888">${start + i + 1}</text>`);
  labels.push(`<text x="${x}" y="${rowY + 152}" font-family="Segoe UI, sans-serif" font-size="12" fill="#aaa">${escapeXml(c.project).slice(0, 18)}</text>`);
}

const grid = [];
for (let i = 0; i <= rows; i++) grid.push(`<line x1="0" y1="${i * CELL + 24}" x2="${W}" y2="${i * CELL + 24}" stroke="#eee"/>`);
for (let i = 0; i <= COLS; i++) grid.push(`<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#eee"/>`);

function escapeXmlLocal(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const base = sharp({ create: { width: Math.floor(W), height: Math.floor(H), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });

await base.composite([...cells, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${grid.join("")}${labels.join("")}</svg>`), top: 0, left: 0 }]).png().toFile(`data/sheet-${PART}.png`);

writeFileSync(new URL(`../data/sheet-map-${PART}.tsv`, import.meta.url),
  page.map((c, i) => [start + i + 1, c.id, c.project, c.name, c.path, c.lucide || ""].join("\t")).join("\n"), "utf8");
console.log(`sheet-${PART}.png ${Math.floor(W)}x${Math.floor(H)} · ${page.length} icons (#${start + 1}-${start + page.length})`);
