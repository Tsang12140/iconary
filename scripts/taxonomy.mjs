/**
 * taxonomy.mjs —— 全站唯一的分类口径
 * ---------------------------------------------------------------------------
 * 以前分类有三套并行：`scene`（行业场景）、`type`（类型）、`tags[0]`（标签），
 * 结果是同一个东西在侧栏出现三次，而且老图标用两字分类（操作/导航），
 * 图标库用四字分类（基础操作/页面导航），前后不一致。这里收口成一套：
 *
 *   - 只有 13 个分类，全部四字，顺序固定（侧栏按这个顺序排，不按数量排）
 *   - 老的两字分类、拆出来的旧分类名，全部映射进来
 *   - 逐枚修正：老图标的分类本来就是按项目随手分的，需要一枚一枚挪
 *
 * 新增图标只能落进 TAXONOMY 里的名字；上传的图默认进「待归类」，由管理员再分。
 */

export const TAXONOMY = [
  { id: "base", name: "基础操作", desc: "增删改查与日常操作的原子动作" },
  { id: "nav", name: "页面导航", desc: "布局、菜单、面板、方向箭头" },
  { id: "social", name: "人际沟通", desc: "账号、成员、权限，以及消息邮件电话" },
  { id: "ai", name: "AI 自动化", desc: "模型、机器人与自动化流程" },
  { id: "data", name: "数据统计", desc: "图表、数据库与监控分析" },
  { id: "commerce", name: "商业金融", desc: "购物包裹、货币支付与账目" },
  { id: "files", name: "文件知识", desc: "文件、文件夹与文档资料" },
  { id: "media", name: "媒体创作", desc: "图片、音视频与创作工具" },
  { id: "dev", name: "开发技术", desc: "代码、版本控制与硬件设备" },
  { id: "time", name: "时间任务", desc: "日期、日程、倒计时与待办" },
  { id: "travel", name: "地图出行", desc: "定位、地图与交通出行" },
  { id: "life", name: "生活服务", desc: "饮食、家居、天气与健康护理" },
  { id: "status", name: "状态反馈", desc: "加载、提醒、情绪与结果状态" },
];

export const CATEGORY_NAMES = TAXONOMY.map((c) => c.name);

/** 待归类：上传默认落这里，只有管理员看得到 */
export const INBOX = "待归类";

/** 旧分类名 → 新分类名（含 16 类时期被合并掉的四个） */
const OLD = {
  操作: "基础操作",
  导航: "页面导航",
  状态: "状态反馈",
  媒体: "媒体创作",
  数据: "数据统计",
  天气: "生活服务",
  安全: "人际沟通",
  箭头: "页面导航",
  设备: "开发技术",
  用户: "人际沟通",
  文件: "文件知识",
  电商交易: "商业金融",
  财务支付: "商业金融",
  用户组织: "人际沟通",
  沟通社交: "人际沟通",
  医疗美业: "生活服务",
};

/**
 * 逐枚修正：老的 114 枚是按项目随手分的，「操作」里塞了电话和调色板、
 * 「导航」里塞了相册和日历。这里按图标本身该被搜到的地方重新落位。
 */
const FIX = {
  // 操作
  "arrow-up-right-from-square": "基础操作",
  "back-to-top": "基础操作",
  "back-to-top-2": "基础操作",
  "circle-ellipsis": "基础操作",
  close: "基础操作",
  xmark: "基础操作",
  "cloud-upload": "基础操作",
  collapse: "开发技术",
  copy: "基础操作",
  "copy-2": "基础操作",
  download: "基础操作",
  "ellipsis-vertical": "基础操作",
  more: "基础操作",
  plus: "基础操作",
  minus: "基础操作",
  "expand-all": "基础操作",
  filter: "基础操作",
  search: "基础操作",
  link: "基础操作",
  "open-link": "基础操作",
  "rotate-ccw": "基础操作",
  "more-years": "时间任务",
  palette: "媒体创作",
  sound: "媒体创作",
  phone: "人际沟通",
  share: "人际沟通",
  "plug-zap": "开发技术",
  wrench: "开发技术",
  "log-out": "人际沟通",
  "show-password": "人际沟通",
  "hide-password": "人际沟通",

  // 导航
  avatar: "人际沟通",
  members: "人际沟通",
  team: "人际沟通",
  staff: "人际沟通",
  greeting: "人际沟通",
  awards: "人际沟通",
  briefcase: "商业金融",
  bulb: "数据统计",
  bars: "数据统计",
  cadence: "时间任务",
  "calendar-2": "数据统计",
  chat: "时间任务",
  diary: "生活服务",
  dream: "生活服务",
  episodes: "媒体创作",
  video: "媒体创作",
  "video-frame": "媒体创作",
  gallery: "媒体创作",
  "layout-dashboard": "数据统计",
  logs: "开发技术",
  navigation: "页面导航",
  "panel-left-close": "页面导航",
  "panel-left-open": "页面导航",
  "partner-star": "商业金融",
  schedule: "时间任务",
  settings: "基础操作",
  "settings-2": "基础操作",
  timeline: "时间任务",
  toc: "文件知识",

  // 数据
  calendar: "时间任务",
  "chart-bar": "数据统计",
  "chart-line": "数据统计",
  database: "数据统计",
  "database-backup": "数据统计",
  coin: "商业金融",
  receipt: "商业金融",
  wallet: "商业金融",
  ticket: "商业金融",
  server: "开发技术",
  tag: "基础操作",

  // 媒体
  call: "人际沟通",
  "call-panel": "人际沟通",
};

/** 把任意来源的分类名收口成 13 类之一；认不出就返回「待归类」 */
export function normalizeScene(name) {
  const s = String(name || "").trim();
  if (!s) return INBOX;
  if (CATEGORY_NAMES.includes(s)) return s;
  if (OLD[s]) return OLD[s];
  return INBOX;
}

/** 图标落在哪个分类：先看逐枚修正，再按 scene / 旧标签 / 旧类型收口 */
export function sceneOfIcon(it) {
  const id = String(it.id || "").replace(/^lib-/, "");
  if (it.origin !== "open-source" && FIX[id]) return FIX[id];
  const raw = it.scene || (it.tags && it.tags[0]) || it.type || "";
  return normalizeScene(raw);
}

/** 侧栏排序：按 TAXONOMY 顺序，不按数量（数量一变，位置就跳） */
export function sceneOrder(name) {
  const i = CATEGORY_NAMES.indexOf(name);
  return i < 0 ? (name === INBOX ? 999 : 998) : i;
}
