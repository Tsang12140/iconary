/**
 * merge-usage.mjs —— 把「靠 import 使用」的图标库图标并进 data/icons.json
 * ---------------------------------------------------------------------------
 * lucide-usage.mjs 只负责统计，这里负责落库：
 *   1) 每个已有图标补 usedIn 字段（默认 [project]）
 *   2) 与已有图标同形（或同 slug）的，只把 clockin-b 记进 usedIn，不新增
 *   3) 全新的按 NAMES 表命名后追加，id 前缀 clockin
 *
 * 用法：node scripts/merge-usage.mjs
 */
import fs from "node:fs";

const ICONS = "D:/apps/icons/data/icons.json";
const USAGE = "D:/apps/icons/data/lucide-usage.json";
const PROJECT = "clockin-b";
const PREFIX = "clockin";

/** lucide 名 → [中文名, 类型, 标签] */
const NAMES = {
  "loader-2": ["加载中", "状态", ["加载", "等待"]],
  "check-circle-2": ["完成", "状态", ["勾选", "成功"]],
  "check-circle": ["成功", "状态", ["成功", "勾选"]],
  save: ["保存", "操作", ["保存", "提交"]],
  "rotate-ccw": ["撤销", "操作", ["撤销", "回退"]],
  "alert-triangle": ["警告", "状态", ["警告", "风险"]],
  sparkles: ["AI 生成", "状态", ["AI", "智能"]],
  "shield-check": ["安全校验", "安全", ["安全", "权限"]],
  "user-plus": ["添加成员", "用户", ["新增", "成员"]],
  "credit-card": ["银行卡", "数据", ["支付", "卡片"]],
  "book-open": ["打开书本", "文件", ["文档", "手册"]],
  "share-2": ["分享", "操作", ["分享", "转发"]],
  "calendar-days": ["日历日程", "数据", ["日期", "日程"]],
  "receipt-text": ["票据明细", "数据", ["收据", "明细"]],
  "sliders-horizontal": ["调节", "操作", ["设置", "筛选"]],
  "chevron-up": ["收起", "箭头", ["收起", "向上"]],
  "key-round": ["密钥", "安全", ["密码", "密钥"]],
  "thumbs-down": ["踩", "状态", ["反馈", "不喜欢"]],
  "thumbs-up": ["赞", "状态", ["反馈", "喜欢"]],
  "file-check-2": ["文件校验", "文件", ["文件", "完成"]],
  "wand-2": ["魔法棒", "操作", ["AI", "优化"]],
  flame: ["火焰", "状态", ["热度", "高温"]],
  snowflake: ["雪花", "天气", ["寒冷", "低温"]],
  percent: ["百分比", "数据", ["比例", "折扣"]],
  tag: ["标签", "数据", ["标签", "分类"]],
  ticket: ["券", "数据", ["券", "优惠"]],
  briefcase: ["公文包", "导航", ["岗位", "业务"]],
  tablet: ["平板", "设备", ["设备", "平板"]],
  laptop: ["笔记本", "设备", ["设备", "电脑"]],
  monitor: ["显示器", "设备", ["设备", "屏幕"]],
  "help-circle": ["帮助", "状态", ["帮助", "疑问"]],
  "trending-up": ["上升趋势", "数据", ["趋势", "增长"]],
  "play-circle": ["播放（圆形）", "媒体", ["播放", "视频"]],
  "user-round-plus": ["添加员工", "用户", ["新增", "员工"]],
  target: ["目标", "状态", ["目标", "靶心"]],
  camera: ["拍照", "媒体", ["拍照", "相机"]],
  "image-down": ["保存图片", "媒体", ["下载", "图片"]],
  "user-x": ["移除成员", "用户", ["移除", "成员"]],
  "user-check": ["成员确认", "用户", ["确认", "成员"]],
  "folder-open": ["打开文件夹", "文件", ["文件夹", "打开"]],
  "hard-drive": ["硬盘", "数据", ["存储", "磁盘"]],
  "plug-zap": ["接入", "操作", ["接入", "集成"]],
  send: ["发送", "通信", ["发送", "消息"]],
  "message-circle": ["消息气泡", "通信", ["消息", "聊天"]],
  "users-round": ["团队（圆角）", "用户", ["团队", "成员"]],
  "undo-2": ["回退", "操作", ["撤销", "回退"]],
  "building-2": ["门店", "导航", ["门店", "公司"]],
  "database-backup": ["数据备份", "数据", ["备份", "数据库"]],
  lightbulb: ["灵感", "状态", ["灵感", "想法"]],
  "log-out": ["退出登录", "操作", ["退出", "登出"]],
  "message-square": ["留言", "通信", ["留言", "评论"]],
  "scroll-text": ["长文本", "文件", ["文本", "说明"]],
  tags: ["多标签", "数据", ["标签", "分类"]],
  "user-round": ["单人（圆角）", "用户", ["用户", "员工"]],
  landmark: ["机构", "导航", ["机构", "银行"]],
  "volume-2": ["音量", "媒体", ["声音", "音量"]],
  "volume-x": ["静音", "媒体", ["静音", "声音"]],
  maximize: ["放大", "媒体", ["全屏", "放大"]],
  minimize: ["缩小", "媒体", ["全屏", "缩小"]],
  wrench: ["维修", "操作", ["工具", "维修"]],
  bookmark: ["书签", "文件", ["书签", "收藏"]],
  "map-pin": ["定位", "导航", ["位置", "定位"]],
  "wallet-cards": ["卡包", "数据", ["钱包", "支付"]],
  "circle-ellipsis": ["更多（圆形）", "操作", ["菜单", "更多"]],
  history: ["历史", "导航", ["历史", "记录"]],
  "settings-2": ["设置（简化）", "导航", ["设置"]],
  square: ["停止方块", "媒体", ["停止", "方形"]],
  "clipboard-list": ["清单", "文件", ["清单", "考勤"]],
  "panel-left-close": ["收起侧栏", "导航", ["侧栏", "收起"]],
  "panel-left-open": ["展开侧栏", "导航", ["侧栏", "展开"]],
};

const icons = JSON.parse(fs.readFileSync(ICONS, "utf8"));
const usage = JSON.parse(fs.readFileSync(USAGE, "utf8"));

const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
const innerOf = (svg) => (svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/) || ["", ""])[1];
const strip = (inner) =>
  inner.replace(/[<>]/g, "").replace(/fill="[^"]*"/g, "").replace(/stroke-width="[^"]*"/g, "");

/* 1) 补 usedIn */
for (const it of icons) if (!it.usedIn) it.usedIn = [it.project];

const byGeom = new Map();
const bySlug = new Map();
for (const it of icons) {
  const k = strip(norm(innerOf(it.svg)));
  if (!byGeom.has(k)) byGeom.set(k, it);
  if (!bySlug.has(it.slug)) bySlug.set(it.slug, it);
}

let merged = 0;
const added = [];
const unknown = [];

for (const u of usage.icons) {
  const hit = byGeom.get(strip(norm(u.inner))) || bySlug.get(u.name);
  if (hit) {
    if (!hit.usedIn.includes(PROJECT)) hit.usedIn.push(PROJECT);
    merged++;
    continue;
  }
  const meta = NAMES[u.name];
  if (!meta) { unknown.push(u.name); continue; }
  const [name, type, tags] = meta;
  added.push({
    id: `${PREFIX}-${u.name}`,
    name,
    slug: u.name,
    project: PROJECT,
    usedIn: [PROJECT],
    type,
    tags: [...new Set([type, ...tags])],
    license: "ISC · Lucide",
    origin: "open-source",
    source: `${PROJECT} · lucide-react（${u.files[0]}${u.files.length > 1 ? " 等 " + u.files.length + " 处" : ""}）`,
    viewBox: u.viewBox,
    kind: "stroke",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${u.viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${u.inner}</svg>`,
  });
}

/* id 冲突兜底 */
for (const it of added) if (icons.some((x) => x.id === it.id)) it.id += "-2";
icons.push(...added);

fs.writeFileSync(ICONS, JSON.stringify(icons, null, 2));
console.log(`合并进已有图标 ${merged} 个，新增 ${added.length} 个，共 ${icons.length} 个`);
if (unknown.length) console.log("缺命名：", unknown.join(" "));
