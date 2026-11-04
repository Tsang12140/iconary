/**
 * finalize.mjs —— 人工命名结果 → data/icons.json（库的唯一数据源）
 * 索引对应 data/curated.json 里的顺序（即总览图编号）。
 * 用法：node scripts/finalize.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { toSvg } from "./svg-utils.mjs";

const curated = JSON.parse(readFileSync(new URL("../data/curated.json", import.meta.url), "utf8"));

/** 编号 → [中文名, 英文 slug, 类型, 标签] */
const MAP = {
  1: ["展开全部", "expand-all", "操作", ["群年鉴", "展开"]],
  2: ["返回顶部", "back-to-top", "操作", ["回顶", "滚动"]],
  3: ["成员", "members", "导航", ["群年鉴", "成员"]],
  4: ["颁奖台", "awards", "导航", ["群年鉴", "颁奖"]],
  5: ["时间线", "timeline", "导航", ["群年鉴", "时间"]],
  6: ["更多年份", "more-years", "操作", ["年份", "更多"]],
  7: ["勾选", "check", "状态", ["确认"]],
  8: ["荣誉徽章", "honor-badge", "品牌", ["打卡", "徽章"]],
  9: ["打卡应用图标", "clockin-app-icon", "品牌", ["打卡", "应用图标"]],
  10: ["打卡 Logo", "clockin-logo", "品牌", ["打卡", "logo"]],
  11: ["提示", "alert", "状态", ["报错"]],
  12: ["搜索", "search", "操作", ["查找"]],
  13: ["筛选", "filter", "操作", ["筛选"]],
  14: ["展开筛选", "chevron-down", "操作", ["展开"]],
  15: ["关闭", "close", "操作", ["关闭"]],
  16: ["上一项", "chevron-left", "导航", ["上一项"]],
  17: ["下一项", "chevron-right", "导航", ["下一项"]],
  18: ["剧集详情", "episodes", "导航", ["影视", "剧集"]],
  19: ["暂停", "pause", "媒体", ["播放控制"]],
  20: ["播放", "play", "媒体", ["播放控制"]],
  21: ["停止", "stop", "媒体", ["播放控制"]],
  22: ["复制", "copy", "操作", ["复制"]],
  31: ["团队", "team", "导航", ["团队", "成员"]],
  32: ["设置", "settings", "导航", ["设置"]],
  33: ["更多", "more", "操作", ["菜单"]],
  34: ["音效", "sound", "操作", ["音效", "声音"]],
  39: ["语音通话", "call", "媒体", ["电话", "通话"]],
  40: ["通话面板", "call-panel", "媒体", ["电话", "通话"]],
  41: ["个人头像", "avatar", "导航", ["头像", "个人"]],
  42: ["导航设置", "navigation", "导航", ["导航"]],
  43: ["欢迎语", "greeting", "导航", ["话术"]],
  44: ["测试日志", "logs", "导航", ["日志"]],
  45: ["采集节奏", "cadence", "导航", ["采集"]],
  46: ["品牌名单", "brands", "导航", ["品牌"]],
  47: ["门店收藏", "partner-star", "导航", ["门店", "收藏"]],
  48: ["员工权限", "staff", "导航", ["员工", "权限"]],
  52: ["科颜荟应用图标", "kyhui-app-icon", "品牌", ["科颜荟"]],
  54: ["科颜荟浅色图标", "kyhui-icon-light", "品牌", ["科颜荟"]],
  57: ["显示密码", "show-password", "操作", ["密码", "显示"]],
  59: ["隐藏密码", "hide-password", "操作", ["密码", "隐藏"]],
  60: ["科颜荟字标", "kyhui-wordmark", "品牌", ["科颜荟", "字标"]],
  64: ["电话", "phone", "操作", ["电话"]],
  73: ["分享", "share", "操作", ["分享"]],
  76: ["折叠代码", "collapse", "操作", ["代码", "折叠"]],
  77: ["复制代码", "copy-code", "操作", ["复制", "代码"]],
  78: ["复制完成", "copy-done", "状态", ["复制", "完成"]],
  79: ["日记", "diary", "导航", ["日记"]],
  80: ["梦境", "dream", "导航", ["梦境"]],
  85: ["相册", "gallery", "导航", ["相册"]],
  89: ["月相", "moon", "天气", ["月亮", "月相"]],
  91: ["打开链接", "open-link", "操作", ["链接"]],
  92: ["待办完成", "task-done", "状态", ["待办", "完成"]],
  93: ["回到顶部", "back-to-top", "操作", ["回顶"]],
  95: ["日出日落", "sun-event", "天气", ["天气", "太阳"]],
  96: ["天气提示", "weather-hint", "天气", ["天气"]],
  97: ["通知", "notification", "状态", ["通知", "提醒"]],
  100: ["解锁", "unlock", "安全", ["解锁", "隐私"]],
  106: ["支付宝", "alipay", "品牌", ["支付"]],
  107: ["向下箭头", "arrow-down", "箭头", ["箭头"]],
  108: ["向左箭头", "arrow-left", "箭头", ["箭头"]],
  109: ["向右箭头", "arrow-right", "箭头", ["箭头"]],
  110: ["向上箭头", "arrow-up", "箭头", ["箭头"]],
  111: ["通知", "bell", "状态", ["通知"]],
  112: ["GitHub", "brand-github", "品牌", ["GitHub"]],
  113: ["日历", "calendar", "数据", ["日期"]],
  114: ["柱状图", "chart-bar", "数据", ["图表"]],
  115: ["折线图", "chart-line", "数据", ["图表"]],
  116: ["勾选", "check", "状态", ["确认"]],
  117: ["展开", "chevron-down", "操作", ["展开"]],
  118: ["下一项", "chevron-right", "导航", ["下一项"]],
  119: ["时间", "clock", "状态", ["时间"]],
  120: ["云上传", "cloud-upload", "操作", ["上传"]],
  121: ["硬币", "coin", "数据", ["货币"]],
  122: ["复制", "copy", "操作", ["复制"]],
  123: ["数据库", "database", "数据", ["数据库"]],
  125: ["下载", "download", "操作", ["下载"]],
  126: ["更多", "ellipsis", "操作", ["菜单"]],
  127: ["更多（竖排）", "ellipsis-vertical", "操作", ["菜单"]],
  128: ["外链", "external-link", "操作", ["跳转"]],
  129: ["显示", "eye", "状态", ["可见"]],
  130: ["隐藏", "eye-off", "状态", ["隐藏"]],
  131: ["文本文件", "file-text", "文件", ["文件"]],
  132: ["文件夹", "folder", "文件", ["文件夹"]],
  133: ["筛选", "filter", "操作", ["筛选"]],
  134: ["GitHub", "github", "品牌", ["GitHub"]],
  135: ["收藏", "heart", "状态", ["收藏"]],
  136: ["首页", "home", "导航", ["首页"]],
  137: ["图片", "image", "媒体", ["图片"]],
  138: ["仪表盘", "layout-dashboard", "导航", ["仪表盘"]],
  139: ["链接", "link", "操作", ["链接"]],
  140: ["锁定", "lock", "安全", ["锁定"]],
  141: ["解锁", "lock-open", "安全", ["解锁"]],
  142: ["邮件", "mail", "通信", ["邮件"]],
  143: ["菜单", "menu", "导航", ["菜单"]],
  144: ["移除", "minus", "操作", ["减去"]],
  145: ["编辑", "pencil", "操作", ["编辑"]],
  146: ["添加", "plus", "操作", ["新增"]],
  147: ["收据", "receipt", "数据", ["收据"]],
  148: ["刷新", "refresh", "操作", ["刷新"]],
  149: ["搜索", "search", "操作", ["搜索"]],
  150: ["服务器", "server", "数据", ["服务器"]],
  151: ["设置", "settings", "操作", ["设置"]],
  152: ["手机", "smartphone", "设备", ["手机"]],
  153: ["星标", "star", "状态", ["星标"]],
  154: ["删除", "trash", "操作", ["删除"]],
  155: ["上传", "upload", "操作", ["上传"]],
  156: ["用户", "user", "用户", ["用户"]],
  157: ["成员", "users", "用户", ["成员"]],
  158: ["钱包", "wallet", "数据", ["钱包"]],
  159: ["微信", "wechat", "品牌", ["微信"]],
  160: ["关闭", "x", "操作", ["关闭"]],
  161: ["账号对比", "bulb", "导航", ["账号", "灵感"]],
  162: ["配方卡片", "bars", "导航", ["配方", "数据"]],
  163: ["视频打法", "video-frame", "导航", ["视频"]],
  164: ["反面教材", "video", "导航", ["视频", "反例"]],
  165: ["行动清单", "chat", "导航", ["清单"]],
  166: ["发帖排期", "schedule", "导航", ["排期"]],
  167: ["数据总表", "calendar", "导航", ["数据"]],
  168: ["目录", "toc", "导航", ["目录"]],
};

const PREFIX = {
  "chatx": "chatx", "clockin-b": "clockin", "films": "films", "gz-meiye": "gz",
  "lifeos": "lifeos", "ui": "ui", "xhs": "xhs", "investment-news-main": "invest",
};

const icons = [];
for (const [idxStr, [name, slug, type, tags]] of Object.entries(MAP)) {
  const c = curated[Number(idxStr) - 1];
  if (!c) { console.error("索引越界", idxStr); continue; }
  const project = c.project;
  const prefix = PREFIX[project] || project;
  const id = `${prefix}-${slug}`;
  if (icons.some((x) => x.id === id)) { console.error("重复 id", id, idxStr); continue; }
  icons.push({
    id,
    name,
    slug,
    project,
    type,
    tags: [...new Set([type, ...tags])],
    license: c.license,
    origin: "own" , // 下面按路径改写
    source: `${c.path}${c.line ? ":" + c.line : ""}`,
    viewBox: c.viewBox || "0 0 24 24",
    kind: c.kind,
    svg: toSvg(c),
  });
}

// 修正来源类型
for (const it of icons) {
  if (it.source.includes("ui/src/icons/sources/")) it.origin = "open-source";
  else if (/lucide|tabler|simple-icons/.test(it.license)) it.origin = "open-source";
}

writeFileSync(new URL("../data/icons.json", import.meta.url), JSON.stringify(icons, null, 2));
const byType = {};
for (const i of icons) byType[i.type] = (byType[i.type] || 0) + 1;
console.log(`共 ${icons.length} 个图标`);
console.log(byType);
console.log("按项目：", Object.entries(icons.reduce((a, i) => (a[i.project] = (a[i.project] || 0) + 1, a)), {}));
