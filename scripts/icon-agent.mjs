#!/usr/bin/env node
/*
 * 图标仓 · agent 命令行
 *
 * 给本机 / 项目里的 AI 用：自动读 scripts/.env 里的 ADMIN_USER / ADMIN_PASS，
 * 登录拿 token 后再调管理接口，不用手工拼 JSON，也不用手动管理 token。
 *
 * 用法：
 *   node scripts/icon-agent.mjs whoami
 *   node scripts/icon-agent.mjs search 删除 --limit 8
 *   node scripts/icon-agent.mjs rename trash --alias "删除 delete trash remove"
 *   node scripts/icon-agent.mjs review up-20261105-a1b2c3 approve
 *   node scripts/icon-agent.mjs stats
 *   node scripts/icon-agent.mjs upload ./icons            # 文件名当名称
 *   node scripts/icon-agent.mjs upload ./batch.json       # 带名称 / 别名 / 分类的清单
 *
 * 清单 batch.json：
 *   [{"file":"a.svg","name":"删除","alias":"delete trash","scene":"基础操作"}]
 *
 * 站点地址默认 https://ai.dnbox.cn/icon，可用 ICON_BASE 环境变量覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_SVG = 262144;

function readEnv() {
  const files = [
    path.join(ROOT, 'scripts', '.env'),
    path.join(ROOT, 'dist', '.env'),
    path.join(ROOT, '.env'),
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const out = {};
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      let v = s.slice(i + 1).trim();
      if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) v = v.slice(1, -1);
      out[s.slice(0, i).trim()] = v;
    }
    return out;
  }
  return {};
}

const ENV = readEnv();
const BASE = (process.env.ICON_BASE || ENV.ICON_BASE || 'https://ai.dnbox.cn/icon').replace(/\/+$/, '');
const API = BASE + '/api.php';

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

async function post(body) {
  let r;
  try {
    r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    die(`连不上 ${API}：${e.message}`);
  }
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    die(`接口返回的不是 JSON（HTTP ${r.status}）：${text.slice(0, 120)}`);
  }
}

async function get(params) {
  const q = new URLSearchParams(params);
  let r;
  try {
    r = await fetch(`${API}?${q}`);
  } catch (e) {
    die(`连不上 ${API}：${e.message}`);
  }
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    die(`接口返回的不是 JSON（HTTP ${r.status}）：${text.slice(0, 120)}`);
  }
}

async function login() {
  if (!ENV.ADMIN_USER || !ENV.ADMIN_PASS) {
    die('scripts/.env 里没有 ADMIN_USER / ADMIN_PASS');
  }
  const r = await post({ action: 'login', user: ENV.ADMIN_USER, pass: ENV.ADMIN_PASS });
  if (!r.ok) die(r.error || '登录失败');
  if (!r.token) die('登录成功但没拿到 token');
  return r.token;
}

async function admin(payload) {
  return post({ ...payload, token: await login() });
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function out(r) {
  console.log(JSON.stringify(r, null, 2));
}

const cmd = process.argv[2];
if (!cmd) {
  console.log('用法：node scripts/icon-agent.mjs <whoami|search|rename|review|upload|stats> …');
  process.exit(0);
}

if (cmd === 'whoami') {
  const token = await login();
  const r = await get({ action: 'state', token, fp: 'agent-cli' });
  out({ ok: !!r.ok, base: BASE, user: r.user ?? null });
} else if (cmd === 'search') {
  const q = process.argv[3] || '';
  const r = await get({ action: 'search', q, limit: arg('limit', '8') });
  out(r);
} else if (cmd === 'rename') {
  const id = process.argv[3];
  if (!id) die('用法：rename <id> [--name 新名称] [--alias 别名] [--scene 分类]');
  const body = { action: 'rename', id };
  for (const k of ['name', 'alias', 'scene', 'tags']) {
    const v = arg(k);
    if (v !== undefined) body[k] = k === 'tags' ? v.split(/[,\s]+/).filter(Boolean) : v;
  }
  out(await admin(body));
} else if (cmd === 'review') {
  const id = process.argv[3];
  const decision = process.argv[4];
  if (!id || !['approve', 'reject'].includes(decision)) die('用法：review <id> approve|reject');
  out(await admin({ action: 'review', id, decision }));
} else if (cmd === 'stats') {
  const token = await login();
  const r = await get({ action: 'state', token, fp: 'agent-cli' });
  out({ ok: r.ok, analytics: r.analytics ?? null, user: r.user ?? null });
} else if (cmd === 'audit') {
  /* 列上传的图标里缺别名 / 缺分类的，待审在前、已通过按新到旧 */
  const token = await login();
  const r = await get({ action: 'state', token, fp: 'agent-cli' });
  if (!r.ok) die(r.error || '拿不到状态');
  const rows = [
    ...(r.pending || []).map(x => ({ ...x, status: 'pending', byKind: x.byKind || 'human' })),
    ...(r.extras || []).slice().reverse().map(x => ({ ...x, status: 'approved', byKind: x.byKind || 'human' })),
  ];
  const onlyAgent = process.argv.includes('--agent');
  const scoped = rows.filter(x => (x.byKind === 'agent') === onlyAgent);
  const bad = scoped.filter(x => !String(x.alias || '').trim() || !String(x.scene || '').trim());
  const limit = +(arg('limit', '200'));
  const list = process.argv.includes('--all') ? scoped : bad;
  out({
    ok: true,
    uploads: rows.length,
    human: rows.filter(x => x.byKind === 'human').length,
    agent: rows.filter(x => x.byKind === 'agent').length,
    pending: (r.pending || []).length,
    approved: (r.extras || []).length,
    missing: bad.length,
    items: list.slice(0, limit).map(x => ({
      id: x.id,
      name: x.name,
      alias: x.alias || '',
      scene: x.scene || '',
      status: x.status,
      by: x.by || x.source || '',
      at: x.at || '',
    })),
  });
} else if (cmd === 'upload') {
  const src = process.argv[3];
  if (!src) die('用法：upload <目录 | batch.json> [--alias 别名] [--scene 分类]');
  const sharedAlias = arg('alias', '');
  const sharedScene = arg('scene', '');
  let items = [];
  if (src.toLowerCase().endsWith('.json')) {
    const manifest = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!Array.isArray(manifest)) die('清单必须是数组');
    for (const it of manifest) {
      if (!it.file || !it.name) die('清单每项都要有 file 和 name');
      const file = path.resolve(path.dirname(src), it.file);
      const svg = fs.readFileSync(file, 'utf8');
      if (svg.length > MAX_SVG) die(`${it.file} 超过 256KB`);
      items.push({
        name: it.name,
        alias: it.alias || sharedAlias,
        scene: it.scene || sharedScene,
        tags: it.tags || [],
        svg,
      });
    }
  } else {
    const dir = path.resolve(src);
    if (!fs.existsSync(dir)) die('找不到目录：' + dir);
    const files = fs.readdirSync(dir).filter(f => /\.svg$/i.test(f)).sort();
    if (!files.length) die('目录里没有 .svg');
    for (const f of files) {
      const svg = fs.readFileSync(path.join(dir, f), 'utf8');
      if (svg.length > MAX_SVG) die(`${f} 超过 256KB`);
      items.push({
        name: f.replace(/\.svg$/i, '').replace(/_+/g, ' ').trim(),
        alias: sharedAlias,
        scene: sharedScene,
        svg,
      });
    }
  }
  if (items.length > 50) die('单次最多 50 个，分几批');
  /* 标成 agent 上传：审核队列里能和人传的区分开，也方便之后只补人类的别名 */
  const r = await admin({ action: 'submitBulk', agent: true, fp: 'agent-cli', items });
  out({ ok: r.ok, count: r.count, status: r.status, ids: r.ids, remaining: r.remaining, error: r.error });
} else {
  die('不认识这个命令：' + cmd);
}
