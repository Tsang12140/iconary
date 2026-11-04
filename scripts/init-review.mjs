/**
 * init-review.mjs —— 从 matched.json 生成可编辑的 data/curated.json
 * ---------------------------------------------------------------------------
 * 只保留“项目成品里真的出现过”的图标（按项目/路径白名单）。
 * 名字优先级：aria-label/title > 上下文中文 > lucide 官方名 > 组件名。
 * 后续人工修正写进 data/corrections.json（id → 覆盖字段 / drop）。
 *
 * 用法：node scripts/init-review.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const matched = JSON.parse(readFileSync(new URL("../data/matched.json", import.meta.url), "utf8"));

const KEEP = (c) => {
  switch (c.project) {
    case "ui": return true;
    case "gz-meiye": return c.path.startsWith("gz-meiye/public/");
    case "chatx": return c.path.includes("06_yearbook");
    case "lifeos": return c.path.startsWith("lifeos/apps/web/");
    case "films": return c.path === "films/index.html";
    case "xhs": return c.path === "xhs/index.html";
    case "clockin-b":
      return /^(clockin-b\/app\/icon\.svg|clockin-b\/public\/favicon\.svg|clockin-b\/public\/honor-badge\.svg|clockin-b\/logo\.svg)$/.test(c.path);
    case "investment-news-main": return true;
    default: return false;
  }
};

/** 中文语义 → [中文名, 英文 slug, 类型, 额外标签] */
const WORDS = {
  保存更改: ["保存", "save", "操作", ["保存", "提交"]],
  保存: ["保存", "save", "操作", ["保存"]],
  线索: ["线索池", "leads", "导航", ["线索", "客户"]],
  公海: ["公海", "lead-pool", "导航", ["线索", "公海"]],
  看板: ["看板", "dashboard", "导航", ["数据", "看板"]],
  外呼: ["外呼", "outbound", "导航", ["电话", "外呼"]],
  采集: ["采集", "collect", "导航", ["采集", "抓取"]],
  团队: ["团队", "team", "导航", ["团队", "成员"]],
  设置: ["设置", "settings", "导航", ["设置"]],
  更多: ["更多", "more", "导航", ["菜单"]],
  个人头像: ["个人头像", "avatar", "导航", ["头像", "个人"]],
  导航设置: ["导航设置", "navigation", "导航", ["导航"]],
  欢迎语: ["欢迎语", "greeting", "导航", ["话术", "欢迎"]],
  测试日志: ["测试日志", "logs", "导航", ["日志"]],
  采集节奏: ["采集节奏", "cadence", "导航", ["采集", "节奏"]],
  品牌名单: ["品牌名单", "brands", "导航", ["品牌"]],
  已合作门店: ["已合作门店", "partners", "导航", ["门店", "合作"]],
  员工权限: ["员工权限", "staff", "导航", ["员工", "权限"]],
  拨打电话: ["拨打电话", "call", "操作", ["电话", "拨打"]],
  重拨: ["重拨", "redial", "操作", ["电话"]],
  跳过: ["跳过", "skip", "操作", ["跳过", "下一条"]],
  上一条: ["上一条", "prev", "操作", ["上一条"]],
  退回: ["退回", "back", "操作", ["退回"]],
  复制: ["复制", "copy", "操作", ["复制"]],
  收起: ["收起", "collapse", "操作", ["收起"]],
  关闭: ["关闭", "close", "操作", ["关闭"]],
  静音: ["静音", "mute", "媒体", ["麦克风", "静音"]],
  结束: ["挂断", "hangup", "媒体", ["电话", "挂断"]],
  本次对话: ["对话记录", "transcript", "媒体", ["对话", "记录"]],
  显示密码: ["显示密码", "show-password", "操作", ["密码", "显示"]],
  隐藏密码: ["隐藏密码", "hide-password", "操作", ["密码", "隐藏"]],
  展开全部: ["展开全部", "expand-all", "操作", ["展开"]],
  选择成员: ["选择成员", "pick-member", "操作", ["成员"]],
  前往颁奖台: ["颁奖台", "awards", "导航", ["颁奖"]],
  前往群史: ["群史", "chronicle", "导航", ["群史"]],
  成员速览: ["成员速览", "members", "导航", ["成员"]],
  账号对比: ["账号对比", "compare", "导航", ["对比"]],
  配方卡片: ["配方卡片", "recipes", "导航", ["配方"]],
  视频打法: ["视频打法", "video", "导航", ["视频"]],
  反面教材: ["反面教材", "flop", "导航", ["反例"]],
  行动清单: ["行动清单", "action-list", "导航", ["清单"]],
  发帖排期: ["发帖排期", "schedule", "导航", ["排期"]],
  数据总表: ["数据总表", "data-table", "导航", ["数据"]],
  目录: ["目录", "toc", "导航", ["目录"]],
};

const LUCIDE_CN = {
  copy: ["复制", "复制"], "chevron-down": ["展开", "收起"], "chevron-up": ["收起", "展开"],
  "chevron-left": ["上一项", "导航"], "chevron-right": ["下一项", "导航"],
  "arrow-up": ["向上", "箭头"], "arrow-down": ["向下", "箭头"], "arrow-left": ["向左", "箭头"], "arrow-right": ["向右", "箭头"],
  search: ["搜索", "查找"], x: ["关闭", "关闭"], check: ["勾选", "确认"], plus: ["添加", "新增"],
  minus: ["移除", "减去"], trash: ["删除", "删除"], edit: ["编辑", "编辑"], settings: ["设置", "设置"],
  user: ["用户", "用户"], users: ["成员", "成员"], phone: ["电话", "电话"], mail: ["邮件", "邮件"],
  calendar: ["日历", "日期"], clock: ["时间", "时间"], filter: ["筛选", "筛选"], download: ["下载", "下载"],
  upload: ["上传", "上传"], share: ["分享", "分享"], refresh: ["刷新", "刷新"], link: ["链接", "链接"],
  image: ["图片", "图片"], video: ["视频", "视频"], play: ["播放", "播放"], pause: ["暂停", "暂停"],
  mic: ["麦克风", "语音"], bell: ["通知", "提醒"], heart: ["收藏", "喜欢"], star: ["星标", "收藏"],
  home: ["首页", "首页"], menu: ["菜单", "菜单"], more: ["更多", "菜单"], info: ["提示", "信息"],
  alert: ["警告", "警告"], eye: ["显示", "可见"], "eye-off": ["隐藏", "隐藏"], lock: ["锁定", "安全"],
  folder: ["文件夹", "文件"], file: ["文件", "文件"], sun: ["晴天", "天气"], moon: ["夜间", "天气"],
  "log-out": ["退出", "登出"], "log-in": ["登录", "登录"], "external-link": ["外链", "跳转"],
  "refresh-cw": ["刷新", "同步"], "corner-down-left": ["回车", "确认"], expand: ["展开", "展开"],
};

const TYPE_FROM_WORDS = (w) => (w && w[2]) || "其他";
const clean = (s) => (s || "").replace(/\s+/g, "").trim();

/** 从 afterText/beforeText 里找最长命中词 */
function wordHit(c) {
  const buckets = [c.afterText || "", c.beforeText || "", ...(c.labels || [])];
  for (const text of buckets) {
    if (!text) continue;
    const t = clean(text);
    let best = null;
    for (const k of Object.keys(WORDS)) {
      if (t.includes(k) && (!best || k.length > best.length)) best = k;
    }
    if (best) return { word: best, data: WORDS[best] };
  }
  return null;
}

const isBrandPath = (p) => /logo|favicon|icon\.svg|kyhui|brand|maskable/i.test(p);

const curated = [];
for (const c of matched.icons) {
  if (!KEEP(c)) continue;
  const label = (c.labels || []).map((s) => s.replace(/^(aria-label|title|alt|name)=?/i, "")).find((s) => s && /[\u4e00-\u9fa5]/.test(s));
  let name, slug, type, extra = [];
  if (c.lucide) {
    const cn = LUCIDE_CN[c.lucide] || [c.lucide, ""];
    name = cn[0]; slug = c.lucide; type = cn[1] || "其他";
    extra = [c.lucide];
  } else {
    const hit = label ? { word: label, data: WORDS[label] } : wordHit(c);
    if (hit && hit.data) {
      [name, slug, type, extra] = hit.data;
      if (hit.word !== hit.data[0]) extra = [...extra, hit.word];
    } else if (label) {
      name = label; slug = ""; type = "其他"; extra = [];
    } else {
      const base = (c.name || c.file || "").replace(/^icon$/i, "").replace(/\.svg$/i, "");
      name = base || c.project + "图标";
      slug = /^[a-z0-9-_]+$/i.test(base) ? base.toLowerCase() : "";
      type = isBrandPath ? "品牌" : "其他";
    }
  }
  if (isBrandPath(c.path) || /品牌|logo/i.test(c.name)) type = "品牌";
  if (!slug) {
    // 中文名没有英文 slug 时，先用项目名占位，人工复核会改
    slug = `${c.project.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${c.id.slice(0, 4)}`;
  }
  const projectTag = c.project === "investment-news-main" ? "投资资讯" : c.project;
  curated.push({
    id: c.id,
    keep: true,
    project: c.project,
    name: name.trim(),
    slug: slug.trim(),
    type,
    tags: [...new Set([projectTag, type, ...extra, ...(type === "导航" ? ["导航"] : [])])],
    license: c.path.startsWith("ui/src/icons/sources/")
      ? (/tabler/.test(c.path) ? "MIT · Tabler" : /simple-icons/.test(c.path) ? "CC0 · Simple Icons" : "ISC · Lucide")
      : c.lucide ? "ISC · Lucide" : "自有",
    source: c.source,
    path: c.path,
    line: c.line || 0,
    viewBox: c.viewBox,
    kind: c.kind,
    attrs: c.attrs,
    inner: c.inner,
    lucide: c.lucide || null,
  });
}

writeFileSync(new URL("../data/curated.json", import.meta.url), JSON.stringify(curated, null, 2));
const byType = {};
for (const c of curated) byType[c.type] = (byType[c.type] || 0) + 1;
console.log(`保留 ${curated.length} 个`);
console.log(byType);
