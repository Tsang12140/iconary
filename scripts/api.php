<?php
declare(strict_types=1);

/*
 * 图标仓 · 账号与偏好接口
 * 与 index.html 同目录（宝塔默认 PHP 即可，无需数据库 / 无需扩展）
 *
 * 账号：读同目录 .env（ADMIN_USER / ADMIN_PASS / USER_USER / USER_PASS / SESSION_SECRET / ADMIN_AI_KEY）
 * 存储：data/library.enc
 *   MAGIC(8)="STORE001" + salt(16) + iv(12) + ciphertext + tag(16)
 *   AES-256-GCM，密钥 = PBKDF2-SHA256(SESSION_SECRET, salt, 210000, 32)
 *   里面有 prefs（三态偏好）、submissions（上传待审 / 已通过）、renames（管理员改名 / 改别名 / 换分类）、
 *   cats（管理员新建的类别）、catMap（类别改名历史，投稿时用它把旧名归一）
 *
 * 接口：
 *   GET  api.php?action=ping          探活（判断是否部署在 PHP 环境）
 *   GET  api.php?action=selftest      加密回环自检（只吐长度，不吐明文）
 *   POST api.php {action:"login", user, pass}                 → {token, user}
 *   GET  api.php?action=state&token=…                          浏览页初始化（匿名也能拿 extras/renames/cats）
 *   POST api.php {action:"set", token, id, state}              三态标记 like|dislike|hide|null
 *   POST api.php {action:"submit", fp, name, alias, scene, type, tags, svg}  上传待审（也可带 items 批量）
 *   POST api.php {action:"submitBulk", fp, items:[{name,alias,svg},…]}   agent 批量上传，记成 agent-XXXX，单次 ≤50、每指纹每天 ≤100
 *   POST api.php {action:"review", token, id, decision}        管理员：approve|reject
 *   POST api.php {action:"rename", token, id, name, alias, scene, tags}  管理员：改名 / 改别名 / 换分类
 *   POST api.php {action:"cat", token, op:add|rename|remove, name, from, to, move}  管理员：类别增删改
 *   POST api.php {action:"delete", token, id}                  管理员：删除投稿
 *   GET  api.php?action=prefs&user=…&pass=…                    agent 直接读偏好（也支持 X-Icon-User / X-Icon-Pass 头）
 *
 * 公开只读（给 AI agent，免登录、GET、CORS *，只吐公开图标）：
 *   GET  api.php?action=search&q=删除&limit=8&scene=商业金融    搜图标
 *   GET  api.php?action=svg&id=trash                            取 SVG 源码，并计一次下载
 *   GET  api.php?action=catalog[&scene=…]                       全量清单（不含 svg）
 *   GET  api.php?action=skill | prompt | llms                   给 agent 的文档，地址按请求域名现算
 *   AI 管理员身份：任一请求带 X-Icon-Key 头（或 ?key=）且等于 .env 的 ADMIN_AI_KEY，
 *   即按管理员处理：state 能读统计，search / svg / catalog / skill 记为「管理员 AI」，
 *   不写进公开下载量、访客数和对外 AI 统计。
 */

const MAGIC = 'STORE001';
const KDF_ITER = 210000;
const RATE_MAX = 5;
const RATE_WINDOW = 900;
const RATE_COOL = 60;
const ALLOWED_STATES = ['like', 'dislike', 'hide'];
/* 上传限额：一个指纹一天最多 100 个，单次请求最多 50 个（网页端一次最多拖 10 个） */
const UPLOAD_DAY_MAX = 100;
const UPLOAD_BATCH_MAX = 50;
const RULES = '选图标时：被标为「不喜欢」和「隐藏」的图标已经从 search / catalog 结果里剔掉了，你搜不到；只有用户明确点名某个 id 时，才允许用 ?action=svg 直接取。被标为「喜欢」的优先采纳，不论搜索还是按分类浏览，它们都排在结果最前面。taste 字段是从已标记图标里统计出的分类倾向，可用来推断用户口味，而不是只看单个 id。';
/* 分类固定 13 类，顺序固定。与 scripts/taxonomy.mjs 的 CATEGORIES 保持一致 */
const SCENE_ORDER = ['基础操作', '页面导航', '人际沟通', 'AI 自动化', '数据统计', '商业金融', '文件知识', '媒体创作', '开发技术', '时间任务', '地图出行', '生活服务', '状态反馈'];

define('DATA_DIR', __DIR__ . '/data');
define('STORE_FILE', DATA_DIR . '/library.enc');
define('STATE_FILE', DATA_DIR . '/.throttle.json');
/* 复制 / 下载的原始点击先追加到这个明文日志里（一行一次），再攒批并进加密 store。
   原因：加解密一次要跑 21 万轮 PBKDF2，每个图标访问都走一遍会把接口拖到几百毫秒。 */
define('HITS_FILE', DATA_DIR . '/.hits.log');
/* 访客 / 搜索 / API 调用的明文事件日志，和下载计数分开攒批 */
define('ANALYTICS_FILE', DATA_DIR . '/.analytics.log');
/* 当天已计过下载的「图标|指纹」：按天自动重置，用来保证一个用户对一枚图标一天只加一次下载量 */
define('DL_FILE', DATA_DIR . '/.dl.php');
/* 计数快照：公开接口只读它，不碰加密库，所以搜图 / 取图都很快 */
define('STATS_FILE', DATA_DIR . '/.stats.php');
/* 偏好快照：公开接口要按「不喜欢 / 隐藏」过滤，但不能为了一次搜索去解密整库 */
define('PREFS_FILE', DATA_DIR . '/.prefs.php');
/* 公开图标的改名 + 已过审投稿快照，同上 */
define('SNAPSHOT_FILE', DATA_DIR . '/.public.php');
define('ENV_FILE', __DIR__ . '/.env');

/* ── 配置 ───────────────────────────────────────────── */

function cfg(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $c = [];
    if (is_file(ENV_FILE)) {
        $lines = @file(ENV_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ((array)$lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $p = strpos($line, '=');
            if ($p === false) {
                continue;
            }
            $k = trim(substr($line, 0, $p));
            $v = trim(substr($line, $p + 1));
            if (strlen($v) > 1 && ($v[0] === '"' || $v[0] === "'") && substr($v, -1) === $v[0]) {
                $v = substr($v, 1, -1);
            }
            $c[$k] = $v;
        }
    }
    foreach (['ADMIN_USER', 'ADMIN_PASS', 'USER_USER', 'USER_PASS', 'SESSION_SECRET', 'ADMIN_AI_KEY', 'TOKEN_TTL', 'MAX_UPLOAD'] as $k) {
        $e = getenv($k);
        if ($e !== false && $e !== '') {
            $c[$k] = $e;
        }
    }
    $c += [
        'ADMIN_USER' => 'admin',
        'ADMIN_PASS' => '',
        'USER_USER' => 'guest',
        'USER_PASS' => '',
        'SESSION_SECRET' => 'change-me-in-env',
        'ADMIN_AI_KEY' => '',
        'TOKEN_TTL' => '86400',
        'MAX_UPLOAD' => '262144',
    ];
    return $c;
}

/* ── 输出 ───────────────────────────────────────────── */

function out(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400, string $flag = ''): void
{
    $r = ['ok' => false, 'error' => $msg];
    if ($flag !== '') {
        $r['need'] = $flag;
    }
    out($r, $code);
}

function ok(array $data): void
{
    out(array_merge(['ok' => true], $data));
}

/* ── 限流（只用于登录失败） ─────────────────────────── */

function readThrottle(): array
{
    if (!is_file(STATE_FILE)) {
        return ['fails' => [], 'until' => 0];
    }
    $j = json_decode((string)@file_get_contents(STATE_FILE), true);
    $fails = [];
    $until = 0;
    if (is_array($j)) {
        foreach ((array)($j['fails'] ?? []) as $t) {
            $fails[] = (int)$t;
        }
        $until = (int)($j['until'] ?? 0);
    }
    return ['fails' => $fails, 'until' => $until];
}

function writeThrottle(array $s): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    @file_put_contents(STATE_FILE, json_encode($s), LOCK_EX);
    @chmod(STATE_FILE, 0600);
}

function guardThrottle(): void
{
    $st = readThrottle();
    $now = time();
    if ($st['until'] > $now) {
        fail('尝试过于频繁，请 ' . ($st['until'] - $now) . ' 秒后再试', 429);
    }
    $recent = recentFails($st['fails'], $now);
    if (count($recent) >= RATE_MAX) {
        writeThrottle(['fails' => $recent, 'until' => $now + RATE_COOL]);
        fail('尝试过于频繁，请 ' . RATE_COOL . ' 秒后再试', 429);
    }
}

function recentFails(array $fails, int $now): array
{
    $r = [];
    foreach ($fails as $t) {
        if ($t > $now - RATE_WINDOW) {
            $r[] = $t;
        }
    }
    return $r;
}

function noteFail(): void
{
    $st = readThrottle();
    $now = time();
    $recent = recentFails($st['fails'], $now);
    $recent[] = $now;
    $until = count($recent) >= RATE_MAX ? $now + RATE_COOL : 0;
    writeThrottle(['fails' => $recent, 'until' => $until]);
}

function noteOk(): void
{
    writeThrottle(['fails' => [], 'until' => 0]);
}

/* ── 加解密 ─────────────────────────────────────────── */

function deriveKey(string $secret, string $salt): string
{
    return hash_pbkdf2('sha256', $secret, $salt, KDF_ITER, 32, true);
}

function seal(string $secret, array $store): string
{
    $salt = random_bytes(16);
    $iv = random_bytes(12);
    $key = deriveKey($secret, $salt);
    $plain = json_encode($store, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($ct === false) {
        fail('加密失败：服务器 openssl 不可用', 500);
    }
    return MAGIC . $salt . $iv . $ct . $tag;
}

function unseal(string $secret, string $blob): array
{
    $len = strlen($blob);
    if ($len < 8 + 16 + 12 + 16 || substr($blob, 0, 8) !== MAGIC) {
        fail('数据文件格式异常', 500);
    }
    $salt = substr($blob, 8, 16);
    $iv = substr($blob, 24, 12);
    $tag = substr($blob, -16);
    $ct = substr($blob, 36, $len - 52);
    $key = deriveKey($secret, $salt);
    $pt = openssl_decrypt($ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($pt === false) {
        fail('数据文件解不开：SESSION_SECRET 可能被改过', 500);
    }
    $store = json_decode($pt, true);
    if (!is_array($store)) {
        fail('数据文件内容异常', 500);
    }
    return $store;
}

function analyticsBase(): array
{
    /* people：指纹 => ['n' => 访问次数, 'last' => 最后访问时间]；admins：被认成管理员设备的指纹 */
    return ['days' => [], 'searches' => [], 'zero' => [], 'api' => [], 'people' => [], 'admins' => []];
}

/** 指纹 → 好记的 4 个字母（去掉容易看混的 I / O） */
function visitorCode(string $fp): string
{
    $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    $n = (int)hexdec(substr(hash('sha256', 'v' . $fp), 0, 8));
    $out = '';
    for ($i = 0; $i < 4; $i++) {
        $out .= $alpha[$n % 24];
        $n = intdiv($n, 24);
    }
    return $out;
}

/** 指纹 → 游客名：游客 + 4 个字母 */
function visitorName(string $fp): string
{
    return '游客' . visitorCode($fp);
}

function emptyStore(): array
{
    return ['version' => 5, 'updatedAt' => null, 'prefs' => [], 'submissions' => [], 'renames' => [], 'cats' => [], 'catMap' => [], 'stats' => [], 'votes' => [], 'voters' => [], 'uploads' => [], 'analytics' => analyticsBase()];
}

function loadStore(): array
{
    if (!is_file(STORE_FILE)) {
        return emptyStore();
    }
    $blob = (string)@file_get_contents(STORE_FILE);
    if ($blob === '') {
        return emptyStore();
    }
    $s = unseal(cfg()['SESSION_SECRET'], $blob);
    foreach (['prefs', 'submissions', 'renames', 'cats', 'catMap', 'stats', 'votes', 'voters', 'uploads'] as $k) {
        if (!isset($s[$k]) || !is_array($s[$k])) {
            $s[$k] = [];
        }
    }
    if (!isset($s['analytics']) || !is_array($s['analytics'])) {
        $s['analytics'] = analyticsBase();
    } else {
        $s['analytics'] = array_merge(analyticsBase(), $s['analytics']);
    }
    /* cats 只保留字符串，避免历史脏数据把 sql/数组塞进来 */
    $s['cats'] = array_values(array_filter($s['cats'], 'is_string'));
    return $s;
}

function saveStore(array $s): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    $s["version"] = 5;
    $s['updatedAt'] = gmdate('c');
    $blob = seal(cfg()['SESSION_SECRET'], $s);
    $tmp = STORE_FILE . '.tmp';
    if (@file_put_contents($tmp, $blob, LOCK_EX) === false) {
        fail('无法写入 data 目录，请检查权限（755 / 属主 www）', 500);
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, STORE_FILE)) {
        @unlink($tmp);
        fail('数据文件落盘失败', 500);
    }
    @chmod(STORE_FILE, 0600);
    /* 顺手刷一份明文快照，让公开接口不必解密（见 publicSnapshot） */
    writeSnapshot(snapshotOf($s));
}

/* ── 会话 ───────────────────────────────────────────── */

function b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64urlDecode(string $s): string
{
    return (string)base64_decode(strtr($s, '-_', '+/'), true);
}

function sign(string $payload): string
{
    return hash_hmac('sha256', $payload, cfg()['SESSION_SECRET']);
}

function makeToken(string $role, string $name): string
{
    $payload = b64url(json_encode([
        'r' => $role,
        'u' => $name,
        'e' => time() + (int)cfg()['TOKEN_TTL'],
    ], JSON_UNESCAPED_UNICODE));
    return $payload . '.' . sign($payload);
}

function readToken(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 2) {
        return null;
    }
    if (!hash_equals(sign($parts[0]), $parts[1])) {
        return null;
    }
    $j = json_decode(b64urlDecode($parts[0]), true);
    if (!is_array($j) || (int)($j['e'] ?? 0) < time()) {
        return null;
    }
    $role = $j['r'] ?? '';
    if (!in_array($role, ['admin', 'user'], true)) {
        return null;
    }
    return ['role' => $role, 'name' => (string)($j['u'] ?? ''), 'exp' => (int)$j['e']];
}

function tokenFrom(array $body): string
{
    $h = (string)($_SERVER['HTTP_X_ICON_TOKEN'] ?? '');
    if ($h !== '') {
        return $h;
    }
    if (isset($_GET['token'])) {
        return (string)$_GET['token'];
    }
    return isset($body['token']) ? (string)$body['token'] : '';
}

function optionalUser(array $body): ?array
{
    $t = tokenFrom($body);
    if ($t === '') {
        return null;
    }
    return readToken($t);
}

function requireUser(array $body): array
{
    $u = optionalUser($body);
    if (!$u) {
        fail('需要登录', 401, 'need_login');
    }
    return $u;
}

function requireAdmin(array $body): array
{
    $u = requireUser($body);
    if ($u['role'] !== 'admin') {
        fail('需要管理员权限', 403, 'need_admin');
    }
    return $u;
}

/** 管理员 key 也能过：给 agent 用的只读写入口（改名 / 审核），删除和类别操作仍然只认登录 */
function requireAdminOrAi(array $body): array
{
    if (aiKeyValid()) {
        return ['role' => 'admin', 'name' => 'agent-ai', 'exp' => time() + 3600];
    }
    return requireAdmin($body);
}

/** 用 .env 里的账号密码验身；先比管理员，再比普通用户 */
function checkCredentials(string $user, string $pass): ?array
{
    $c = cfg();
    $pairs = [
        ['ADMIN_USER', 'ADMIN_PASS', 'admin'],
        ['USER_USER', 'USER_PASS', 'user'],
    ];
    foreach ($pairs as $p) {
        list($uk, $pk, $role) = $p;
        if ($c[$pk] === '') {
            continue;
        }
        if (hash_equals((string)$c[$uk], $user) && hash_equals((string)$c[$pk], $pass)) {
            return ['name' => $user, 'role' => $role];
        }
    }
    return null;
}

function credsFrom(array $body): array
{
    $u = (string)($_SERVER['HTTP_X_ICON_USER'] ?? '');
    $p = (string)($_SERVER['HTTP_X_ICON_PASS'] ?? '');
    if ($u === '' && isset($_GET['user'])) {
        $u = (string)$_GET['user'];
    }
    if ($p === '' && isset($_GET['pass'])) {
        $p = (string)$_GET['pass'];
    }
    if ($u === '' && isset($body['user'])) {
        $u = (string)$body['user'];
    }
    if ($p === '' && isset($body['pass'])) {
        $p = (string)$body['pass'];
    }
    return [$u, $p];
}

/* ── 图标数据 ───────────────────────────────────────── */

function readIndex(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $f = __DIR__ . '/index.json';
    if (!is_file($f)) {
        return $cache;
    }
    $j = json_decode((string)@file_get_contents($f), true);
    if (!is_array($j) || !isset($j['icons']) || !is_array($j['icons'])) {
        return $cache;
    }
    foreach ($j['icons'] as $it) {
        if (isset($it['id'])) {
            $cache[(string)$it['id']] = $it;
        }
    }
    return $cache;
}

/** data/base.php：项目来源 + 品牌图标（只经管理员接口下发） */
function baseData(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $f = DATA_DIR . '/base.php';
    $cache = is_file($f) ? (require $f) : [];
    if (!is_array($cache)) {
        $cache = [];
    }
    return $cache;
}

function brandById(string $id): ?array
{
    foreach ((array)(baseData()['brands'] ?? []) as $b) {
        if (is_array($b) && (string)($b['id'] ?? '') === $id) {
            return $b;
        }
    }
    return null;
}

function approvedSubmissions(array $store): array
{
    $r = [];
    foreach ($store['submissions'] as $s) {
        if (($s['status'] ?? '') === 'approved') {
            $r[] = $s;
        }
    }
    return $r;
}

/* ── 类别（scene）───────────────────────────────────────
   类别不是一个独立实体，它就是每个图标的 scene 字段。所以「改类别名」
   等于把属于它的图标逐个写上新的 scene（存进 renames / submissions）。
   好处是导出的 index.json、agent 读到的数据天然一致，不用在读取端再套一层映射。 */

function iconScene(array $store, string $id, string $fallback): string
{
    if (isset($store['renames'][$id]['scene'])) {
        return (string)$store['renames'][$id]['scene'];
    }
    return $fallback;
}

function setIconScene(array &$store, string $id, string $to): void
{
    $cur = isset($store['renames'][$id]) && is_array($store['renames'][$id]) ? $store['renames'][$id] : [];
    $cur['scene'] = $to;
    $store['renames'][$id] = $cur;
}

/** 把某个类别下的全部图标搬到 $to（空字符串 = 未标注），返回搬动的条数 */
function moveScene(array &$store, string $from, string $to): int
{
    $n = 0;
    foreach (readIndex() as $id => $it) {
        $id = (string)$id;
        if (iconScene($store, $id, (string)($it['scene'] ?? '')) === $from) {
            setIconScene($store, $id, $to);
            $n++;
        }
    }
    foreach ((array)(baseData()['brands'] ?? []) as $b) {
        $id = (string)($b['id'] ?? '');
        if ($id === '') {
            continue;
        }
        if (iconScene($store, $id, (string)($b['scene'] ?? '')) === $from) {
            setIconScene($store, $id, $to);
            $n++;
        }
    }
    foreach ($store['submissions'] as $i => $s) {
        if ((string)($s['scene'] ?? '') === $from) {
            $store['submissions'][$i]['scene'] = $to;
            $n++;
        }
    }
    return $n;
}

/** 现有类别名（公开索引 + 品牌 + 投稿 + 管理员新建的），用于判重 */
function knownScenes(array $store): array
{
    $m = [];
    foreach (readIndex() as $it) {
        $s = (string)($it['scene'] ?? '');
        if ($s !== '') {
            $m[$s] = true;
        }
    }
    foreach ((array)(baseData()['brands'] ?? []) as $b) {
        $s = (string)($b['scene'] ?? '');
        if ($s !== '') {
            $m[$s] = true;
        }
    }
    foreach ($store['submissions'] as $s) {
        $sc = (string)($s['scene'] ?? '');
        if ($sc !== '') {
            $m[$sc] = true;
        }
    }
    foreach ($store['cats'] as $c) {
        $m[(string)$c] = true;
    }
    return array_keys($m);
}

/** 旧类别名 → 新分类名。与 scripts/taxonomy.mjs 的 OLD 表保持一致 */
function sceneAlias(string $s): string
{
    static $m = [
        '操作' => '基础操作',
        '导航' => '页面导航',
        '状态' => '状态反馈',
        '媒体' => '媒体创作',
        '数据' => '数据统计',
        '天气' => '生活服务',
        '安全' => '人际沟通',
        '箭头' => '页面导航',
        '设备' => '开发技术',
        '用户' => '人际沟通',
        '文件' => '文件知识',
        '电商交易' => '商业金融',
        '财务支付' => '商业金融',
        '用户组织' => '人际沟通',
        '沟通社交' => '人际沟通',
        '医疗美业' => '生活服务',
        '未标注' => '待归类',
    ];
    $s = trim($s);
    if ($s === '') {
        return '待归类';
    }
    return $m[$s] ?? $s;
}

function publicExtra(array $s): array
{
    return [
        'id' => $s['id'],
        'name' => $s['name'],
        'alias' => $s['alias'] ?? '',
        'scene' => sceneAlias((string)($s['scene'] ?? '')),
        'project' => '上传',
        'usedIn' => ['上传'],
        'license' => '用户投稿',
        'origin' => 'own',
        'source' => 'upload / ' . ($s['by'] ?? ''),
        /* byKind 才是「谁传的」：human / agent；kind 表示这是上传图标 */
        'byKind' => (($s['byKind'] ?? '') === 'agent' || str_starts_with((string)($s['by'] ?? ''), 'agent-')) ? 'agent' : 'human',
        'viewBox' => $s['viewBox'] ?? '',
        'kind' => 'upload',
        'file' => null,
        'svg' => $s['svg'],
    ];
}

function topOf(array $counter, int $n): array
{
    arsort($counter);
    $r = [];
    foreach ($counter as $k => $v) {
        $r[] = ['name' => (string)$k, 'count' => (int)$v];
        if (count($r) >= $n) {
            break;
        }
    }
    return $r;
}

function tasteOf(array $ids): array
{
    $idx = readIndex();
    $extra = [];
    foreach (approvedSubmissions(loadStore()) as $s) {
        $extra[(string)$s['id']] = $s;
    }
    $scene = [];
    foreach ($ids as $id) {
        $it = $idx[$id] ?? ($extra[$id] ?? null);
        if ($it === null) {
            continue;
        }
        if (isset($it['scene']) && $it['scene'] !== '') {
            $sc = (string)$it['scene'];
            $scene[$sc] = ($scene[$sc] ?? 0) + 1;
        }
    }
    return ['scenes' => topOf($scene, 4)];
}

function briefOf(array $counts, array $taste): string
{
    $parts = [];
    foreach ([['like', '喜欢'], ['dislike', '不喜欢'], ['hide', '隐藏']] as $s) {
        list($key, $label) = $s;
        if ($counts[$key] < 1) {
            continue;
        }
        $seg = $label . ' ' . $counts[$key] . ' 个';
        $scenes = [];
        foreach ($taste[$key]['scenes'] as $t) {
            $scenes[] = $t['name'];
        }
        if ($scenes) {
            $seg .= '，偏 ' . implode('/', $scenes) . ' 类';
        }
        $parts[] = $seg;
    }
    if (!count($parts)) {
        return '还没有任何标记。用户标记后才会出现口味信号。';
    }
    return implode('；', $parts) . '。';
}


function prefsPayload(array $store): array
{
    $prefs = $store['prefs'];
    $lists = ['like' => [], 'dislike' => [], 'hide' => []];
    foreach ($prefs as $id => $st) {
        if (in_array($st, ALLOWED_STATES, true)) {
            $lists[$st][] = (string)$id;
        }
    }
    $counts = [
        'like' => count($lists['like']),
        'dislike' => count($lists['dislike']),
        'hide' => count($lists['hide']),
    ];
    $total = count(readIndex()) + count(approvedSubmissions($store));
    $counts['none'] = max(0, $total - $counts['like'] - $counts['dislike'] - $counts['hide']);
    $taste = [
        'like' => tasteOf($lists['like']),
        'dislike' => tasteOf($lists['dislike']),
        'hide' => tasteOf($lists['hide']),
    ];
    return [
        'updatedAt' => $store['updatedAt'],
        'total' => $total,
        'counts' => $counts,
        'prefs' => (object)$prefs,
        'lists' => $lists,
        'taste' => $taste,
        'brief' => briefOf($counts, $taste),
        'rules' => RULES,
    ];
}

/* ── 校验 ───────────────────────────────────────────── */

function cleanText($v, string $field, int $max): string
{
    if (!is_string($v)) {
        fail($field . ' 必须是字符串', 400);
    }
    $v = trim($v);
    if ($v === '' || mb_strlen($v) > $max) {
        fail($field . ' 不能为空且不超过 ' . $max . ' 字', 400);
    }
    return $v;
}

function cleanOptionalText($v, string $field, int $max): string
{
    if ($v === null || $v === '') {
        return '';
    }
    if (!is_string($v)) {
        fail($field . ' 必须是字符串', 400);
    }
    $v = trim($v);
    if (mb_strlen($v) > $max) {
        fail($field . ' 不超过 ' . $max . ' 字', 400);
    }
    return $v;
}

function cleanTags($v): array
{
    if ($v === null || $v === '') {
        return [];
    }
    if (is_string($v)) {
        $v = preg_split('/[,，\s]+/u', $v) ?: [];
    }
    if (!is_array($v)) {
        fail('tags 需为数组或逗号分隔字符串', 400);
    }
    $r = [];
    foreach ($v as $t) {
        if (!is_string($t)) {
            continue;
        }
        $t = trim($t);
        if ($t === '' || mb_strlen($t) > 16) {
            continue;
        }
        $r[] = $t;
        if (count($r) >= 6) {
            break;
        }
    }
    return $r;
}

function cleanId($v): string
{
    if (!is_string($v) || !preg_match('/^[A-Za-z0-9._-]{1,80}$/', $v)) {
        fail('id 不合法', 400);
    }
    return $v;
}

/** 浏览器指纹（前端算好传来的），只接受短 token；没有就返回空串 */
function cleanFp($v): string
{
    if (!is_string($v) || !preg_match('/^[A-Za-z0-9._-]{4,64}$/', $v)) {
        return '';
    }
    return $v;
}

/** AI 拿 .env 里的 ADMIN_AI_KEY 证明自己是管理员：优先 X-Icon-Key 头，其次 ?key= */
function aiKeyValid(): bool
{
    $k = (string)cfg()['ADMIN_AI_KEY'];
    if ($k === '') {
        return false;
    }
    $got = (string)($_SERVER['HTTP_X_ICON_KEY'] ?? '');
    if ($got === '' && isset($_GET['key'])) {
        $got = (string)$_GET['key'];
    }
    return $got !== '' && hash_equals($k, $got);
}

function cleanSvg($v): string
{
    if (!is_string($v)) {
        fail('svg 必须是字符串', 400);
    }
    $svg = trim($v);
    if (strlen($svg) > (int)cfg()['MAX_UPLOAD']) {
        fail('SVG 超过大小上限', 413);
    }
    /* 实体必须先拦：DOCTYPE 的内部子集里可以塞 <!ENTITY，先剔 DOCTYPE 会把它一起删掉 */
    if (stripos($svg, '<!ENTITY') !== false) {
        fail('SVG 含有不允许的内容：<!ENTITY', 400);
    }
    /* <!DOCTYPE svg …> 是合法声明，Illustrator / Inkscape / Sketch 导出都会带，
       直接剔除而不是拒收 */
    $svg = trim((string)preg_replace('/<!DOCTYPE\b[^>\[]*(?:\[[\s\S]*?\])?[^>]*>/i', '', $svg));
    if (strpos($svg, '<svg') === false || strpos($svg, '</svg>') === false) {
        fail('不是完整的 SVG', 400);
    }
    foreach (['<script', 'onload=', 'onclick=', 'javascript:'] as $bad) {
        if (stripos($svg, $bad) !== false) {
            fail('SVG 含有不允许的内容：' . $bad, 400);
        }
    }
    return $svg;
}

function viewBoxOf(string $svg): string
{
    if (preg_match('/viewBox\s*=\s*"([^"]+)"/i', $svg, $m)) {
        return $m[1];
    }
    if (preg_match('/width\s*=\s*"(\d+)"[\s\S]*?height\s*=\s*"(\d+)"/i', $svg, $m)) {
        return '0 0 ' . $m[1] . ' ' . $m[2];
    }
    return '';
}

/* ── 公开只读接口（给 AI agent）─────────────────────────
   目标：agent 只要知道一个域名，就能自己搜、自己取，不用登录也不用读文档。
   全部 GET + CORS，只吐公开图标（不含品牌，不含项目名）。
   为了不让每次请求都跑一遍 PBKDF2，重命名 / 过审投稿 / 计数都另存一份明文快照在 data/ 下，
   快照是 .php 文件，直接访问只会执行、不会输出内容。 */

function corsOut(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
}

/** 当前部署地址（跟着请求走，换域名 / 加反代路径都不用改配置） */
function baseUrl(): string
{
    $https = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $host = (string)($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $dir = str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api.php')));
    $dir = rtrim($dir, '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

function snapshotOf(array $store): array
{
    return [
        'renames' => $store['renames'] ?? [],
        'extras' => array_values(array_map('publicExtra', approvedSubmissions($store))),
    ];
}

function writeSnapshot(array $snap): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    $code = "<?php\n/* 自动生成，别手改：公开图标的改名 + 已过审投稿，给 api.php 的只读接口用。 */\nreturn "
        . var_export($snap, true) . ";\n";
    $tmp = SNAPSHOT_FILE . '.tmp';
    if (@file_put_contents($tmp, $code, LOCK_EX) !== false) {
        @rename($tmp, SNAPSHOT_FILE);
        @chmod(SNAPSHOT_FILE, 0640);
    }
}

function publicSnapshot(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    if (is_file(SNAPSHOT_FILE)) {
        $x = @include SNAPSHOT_FILE;
        if (is_array($x) && isset($x['renames'], $x['extras'])) {
            $c = $x;
            return $c;
        }
    }
    $c = snapshotOf(loadStore());
    writeSnapshot($c);
    return $c;
}

/** 公开图标：id => [id,name,alias,scene,license,viewBox,svg]（已套用改名，已并入过审投稿） */
function publicIcons(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $snap = publicSnapshot();
    $rn = is_array($snap['renames']) ? $snap['renames'] : [];
    $out = [];
    foreach (readIndex() as $id => $it) {
        if (!is_array($it)) {
            continue;
        }
        $out[(string)$id] = normIcon($it, $rn[$id] ?? []);
    }
    foreach ((array)$snap['extras'] as $it) {
        if (!is_array($it) || !isset($it['id'])) {
            continue;
        }
        $x = normIcon($it, $rn[$it['id']] ?? []);
        $out[$x['id']] = $x;
    }
    return $cache = $out;
}

function normIcon(array $it, $over): array
{
    if (is_array($over) && $over) {
        $it = array_merge($it, $over);
    }
    return [
        'id' => (string)($it['id'] ?? ''),
        'name' => (string)($it['name'] ?? ''),
        'alias' => (string)($it['alias'] ?? ''),
        'scene' => sceneAlias((string)($it['scene'] ?? '')),
        'license' => (string)($it['license'] ?? ''),
        'viewBox' => (string)($it['viewBox'] ?? '0 0 24 24'),
        'svg' => (string)($it['svg'] ?? ''),
    ];
}

function splitWords(string $s): array
{
    $x = preg_split('/[\s,，、\/|]+/u', $s, -1, PREG_SPLIT_NO_EMPTY);
    return is_array($x) ? $x : [];
}

/** 打分；-1 = 没命中。多词之间是「都要命中」 */
function scoreIcon(array $it, array $tokens): int
{
    $id = mb_strtolower($it['id']);
    $name = mb_strtolower($it['name']);
    $alias = mb_strtolower($it['alias']);
    $atoms = splitWords($alias);
    $total = 0;
    foreach ($tokens as $t) {
        if ($t === '') {
            continue;
        }
        if ($id === $t) {
            $total += 120;
        } elseif ($name === $t) {
            $total += 110;
        } elseif (in_array($t, $atoms, true)) {
            $total += 75;
        } elseif (strpos($id, $t) === 0) {
            $total += 60;
        } elseif (mb_strpos($name, $t) === 0) {
            $total += 55;
        } elseif (strpos($id, $t) !== false) {
            $total += 40;
        } elseif (mb_strpos($name, $t) !== false) {
            $total += 35;
        } elseif (mb_strpos($alias, $t) !== false) {
            $total += 20;
        } else {
            return -1;
        }
    }
    return $total;
}

function searchHits(string $q, string $scene, int $limit, array $stats): array
{
    $tokens = splitWords(mb_strtolower(trim($q)));
    $want = $scene === '' ? '' : sceneAlias($scene);
    $hits = [];
    foreach (publicIcons() as $it) {
        if ($want !== '' && $it['scene'] !== $want) {
            continue;
        }
        $score = 0;
        if ($tokens) {
            $score = scoreIcon($it, $tokens);
            if ($score < 0) {
                continue;
            }
        }
        $hits[] = ['score' => $score] + $it;
    }
    $use = static function (string $id) use ($stats): int {
        return (int)($stats[$id]['copy'] ?? 0) + (int)($stats[$id]['download'] ?? 0);
    };
    /* 标了「喜欢」的永远排在前面，再按匹配度 / 使用量排 */
    $prefs = prefMap();
    $liked = static function (array $it) use ($prefs): int {
        return (($prefs[$it['id']] ?? '') === 'like') ? 0 : 1;
    };
    usort($hits, static function (array $a, array $b) use ($use, $liked): int {
        if (($d = $liked($a) <=> $liked($b)) !== 0) {
            return $d;
        }
        if ($a['score'] !== $b['score']) {
            return $b['score'] <=> $a['score'];
        }
        $ua = $use($a['id']);
        $ub = $use($b['id']);
        if ($ua !== $ub) {
            return $ub <=> $ua;
        }
        return strcmp($a['id'], $b['id']);
    });
    if ($limit > 0) {
        $hits = array_slice($hits, 0, $limit);
    }
    return $hits;
}

function briefIcon(array $it): array
{
    return [
        'id' => $it['id'],
        'name' => $it['name'],
        'scene' => $it['scene'],
        'alias' => $it['alias'],
        'license' => $it['license'],
        'viewBox' => $it['viewBox'],
        'svg_url' => baseUrl() . '/api.php?action=svg&id=' . rawurlencode($it['id']),
    ];
}

/* ── 计数：明文日志 → 攒批进加密库 ─────────────────── */

function hitLog(string $id, string $op): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    @file_put_contents(HITS_FILE, $id . ' ' . $op . "\n", FILE_APPEND | LOCK_EX);
}

/** 今天这个指纹是不是已经给这枚图标计过下载了；顺手记上。返回 true = 已经计过 */
function dlSeen(string $id, string $who): bool
{
    $today = date('Y-m-d');
    $row = is_file(DL_FILE) ? @include DL_FILE : null;
    if (!is_array($row) || ($row['d'] ?? '') !== $today || !is_array($row['k'] ?? null)) {
        $row = ['d' => $today, 'k' => []];
    }
    $key = $id . '|' . $who;
    if (isset($row['k'][$key])) {
        return true;
    }
    $row['k'][$key] = 1;
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    $code = "<?php\n/* 自动生成，别手改：当天已计过下载的图标 + 指纹。 */\nreturn "
        . var_export($row, true) . ";\n";
    @file_put_contents(DL_FILE, $code, LOCK_EX);
    @chmod(DL_FILE, 0640);
    return false;
}

function statCache(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $c = [];
    if (is_file(STATS_FILE)) {
        $x = @include STATS_FILE;
        if (is_array($x)) {
            $c = $x;
        }
    }
    return $c;
}

/** data/.prefs.php：id => like|dislike|hide 的明文快照 */
function prefMap(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    $c = [];
    if (is_file(PREFS_FILE)) {
        $x = @include PREFS_FILE;
        if (is_array($x)) {
            $c = $x;
        }
    }
    return $c;
}

function syncPrefMap(array $prefs): void
{
    $old = prefMap();
    if ($old === $prefs) {
        return;
    }
    $code = "<?php\nreturn " . var_export($prefs, true) . ";\n";
    $tmp = PREFS_FILE . '.tmp';
    if (@file_put_contents($tmp, $code, LOCK_EX) !== false) {
        @rename($tmp, PREFS_FILE);
        @chmod(PREFS_FILE, 0640);
    }
}

/** 被标成「不喜欢」或「隐藏」的 id：不给 agent 挑 */
function blockedIds(): array
{
    $out = [];
    foreach (prefMap() as $id => $st) {
        if ($st === 'dislike' || $st === 'hide') {
            $out[(string)$id] = true;
        }
    }
    return $out;
}

function writeStatCache(array $stats): void
{
    $code = "<?php\n/* 自动生成，别手改：复制 / 下载次数快照（公开发接口只读它，避免每次解密）。 */\nreturn "
        . var_export($stats, true) . ";\n";
    $tmp = STATS_FILE . '.tmp';
    if (@file_put_contents($tmp, $code, LOCK_EX) !== false) {
        @rename($tmp, STATS_FILE);
        @chmod(STATS_FILE, 0640);
    }
}

/** 把日志里的点击并进加密库；返回合并后的 store，没活干返回 null */
function flushHits(): ?array
{
    if (!is_file(HITS_FILE) || (int)@filesize(HITS_FILE) === 0) {
        return null;
    }
    /* 先改名再读：并发追加会写进新的日志文件，不会丢 */
    $tmp = HITS_FILE . '.' . getmypid();
    if (!@rename(HITS_FILE, $tmp)) {
        return null;
    }
    $raw = (string)@file_get_contents($tmp);
    @unlink($tmp);
    if ($raw === '') {
        return null;
    }
    $store = loadStore();
    $n = 0;
    foreach (preg_split('/\r?\n/', $raw) ?: [] as $line) {
        $p = explode(' ', trim($line));
        if (count($p) !== 2) {
            continue;
        }
        [$id, $op] = $p;
        if ($op !== 'copy' && $op !== 'download') {
            continue;
        }
        if (!preg_match('/^[A-Za-z0-9._-]{1,80}$/', $id)) {
            continue;
        }
        $cur = $store['stats'][$id] ?? ['copy' => 0, 'download' => 0];
        $cur[$op] = (int)($cur[$op] ?? 0) + 1;
        $store['stats'][$id] = $cur;
        $n++;
    }
    if ($n === 0) {
        return null;
    }
    saveStore($store);
    writeStatCache($store['stats']);
    return $store;
}

/** 访客 / 搜索 / API 调用先写明文事件，state 时攒批进加密库 */
function hitEvent(array $e): void
{
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0750, true);
    }
    $e['ts'] = time();
    @file_put_contents(ANALYTICS_FILE, json_encode($e, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

function flushAnalytics(array $store): array
{
    if (!is_file(ANALYTICS_FILE) || (int)@filesize(ANALYTICS_FILE) === 0) {
        return $store;
    }
    $tmp = ANALYTICS_FILE . '.' . getmypid();
    if (!@rename(ANALYTICS_FILE, $tmp)) {
        return $store;
    }
    $raw = (string)@file_get_contents($tmp);
    @unlink($tmp);
    if ($raw === '') {
        return $store;
    }
    $a = $store['analytics'];
    foreach (['days', 'searches', 'zero', 'api', 'people', 'admins'] as $k) {
        if (!is_array($a[$k] ?? null)) {
            $a[$k] = [];
        }
    }
    $lines = preg_split('/\r?\n/', $raw) ?: [];
    /* 先扫一遍管理员事件：同一批里「登录前的匿名访问」也要按管理员设备排除 */
    foreach ($lines as $line) {
        if (strpos($line, '"t":"admin"') === false) {
            continue;
        }
        $e = json_decode(trim($line), true);
        $fp = is_array($e) ? substr((string)($e['fp'] ?? ''), 0, 16) : '';
        if ($fp !== '') {
            $a['admins'][$fp] = 1;
        }
    }
    $n = 0;
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] !== '{') {
            continue;
        }
        $e = json_decode($line, true);
        if (!is_array($e)) {
            continue;
        }
        $day = date('Y-m-d', (int)($e['ts'] ?? time()));
        if (!isset($a['days'][$day]) || !is_array($a['days'][$day])) {
            $a['days'][$day] = ['views' => 0, 'visitors' => [], 'human' => 0, 'agent' => 0, 'search' => 0, 'zero' => 0, 'api' => 0, 'aia' => 0];
        }
        $b = &$a['days'][$day];
        $t = (string)($e['t'] ?? '');
        /* 带管理员 AI Key 的流量单独计数，不混进对外看的搜索 / 取图 / 接口量 */
        if (!empty($e['adm']) && in_array($t, ['dl', 'search', 'api'], true)) {
            $b['aia'] = (int)($b['aia'] ?? 0) + 1;
            unset($b);
            $n++;
            continue;
        }
        if ($t === 'visit' || $t === 'admin') {
            $fp = substr((string)($e['fp'] ?? ''), 0, 16);
            if ($t === 'admin' && $fp !== '') {
                $a['admins'][$fp] = 1;
            }
            /* 管理员设备：只记进 people（好让面板显示「管理员」），不计访问次数 / 独立访客 */
            if ($t !== 'admin' && !($fp !== '' && isset($a['admins'][$fp]))) {
                $b['views'] = (int)$b['views'] + 1;
                if ($fp !== '' && count($b['visitors']) < 3000) {
                    $b['visitors'][$fp] = 1;
                }
            }
            if ($fp !== '') {
                $p = $a['people'][$fp] ?? ['n' => 0, 'last' => 0];
                $p['n'] = (int)($p['n'] ?? 0) + 1;
                $p['last'] = (int)($e['ts'] ?? time());
                $a['people'][$fp] = $p;
            }
        } elseif ($t === 'dl') {
            $src = (string)($e['src'] ?? '');
            if ($src === 'agent') {
                if (($e['counted'] ?? true) !== false) {
                    $b['agent'] = (int)$b['agent'] + 1;
                }
                if (($e['api'] ?? '') === 'svg') {
                    $a['api']['svg'] = (int)($a['api']['svg'] ?? 0) + 1;
                    $b['api'] = (int)$b['api'] + 1;
                }
            } elseif ($src === 'human') {
                $b['human'] = (int)$b['human'] + 1;
            }
        } elseif ($t === 'search') {
            $q = trim((string)($e['q'] ?? ''));
            $q = function_exists('mb_substr') ? mb_substr($q, 0, 40, 'UTF-8') : substr($q, 0, 40);
            $hits = (int)($e['n'] ?? 0);
            $b['search'] = (int)$b['search'] + 1;
            $a['api']['search'] = (int)($a['api']['search'] ?? 0) + 1;
            $b['api'] = (int)$b['api'] + 1;
            if ($q !== '') {
                $a['searches'][$q] = (int)($a['searches'][$q] ?? 0) + 1;
                if ($hits === 0) {
                    $b['zero'] = (int)$b['zero'] + 1;
                    $a['zero'][$q] = (int)($a['zero'][$q] ?? 0) + 1;
                }
            }
        } elseif ($t === 'api') {
            $k = (string)($e['k'] ?? '');
            if (in_array($k, ['search', 'svg', 'catalog', 'skill'], true)) {
                $a['api'][$k] = (int)($a['api'][$k] ?? 0) + 1;
                $b['api'] = (int)$b['api'] + 1;
            }
        }
        unset($b);
        $n++;
    }
    if ($n === 0) {
        return $store;
    }
    $cut = date('Y-m-d', strtotime('-120 days'));
    foreach (array_keys($a['days']) as $d) {
        if ($d < $cut) {
            unset($a['days'][$d]);
        }
    }
    foreach (['searches', 'zero'] as $k) {
        arsort($a[$k]);
        $a[$k] = array_slice($a[$k], 0, 200, true);
    }
    /* people 只留最近 120 天活跃过的，最多 500 个设备 */
    $pCut = time() - 120 * 86400;
    foreach ($a['people'] as $fp => $p) {
        if ((int)($p['last'] ?? 0) < $pCut) {
            unset($a['people'][$fp]);
        }
    }
    if (count($a['people']) > 500) {
        uasort($a['people'], function ($x, $y) {
            return (int)($y['last'] ?? 0) <=> (int)($x['last'] ?? 0);
        });
        $a['people'] = array_slice($a['people'], 0, 500, true);
    }
    $store['analytics'] = $a;
    saveStore($store);
    return $store;
}

function analyticsSummary(array $store): array
{
    $a = is_array($store['analytics'] ?? null) ? $store['analytics'] : analyticsBase();
    foreach (['days', 'searches', 'zero', 'api', 'people', 'admins'] as $k) {
        if (!is_array($a[$k] ?? null)) {
            $a[$k] = [];
        }
    }
    $admins = $a['admins'];
    $days = [];
    $uniq = [];
    for ($i = 13; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime('-' . $i . ' days'));
        $r = $a['days'][$d] ?? [];
        $v = is_array($r['visitors'] ?? null) ? $r['visitors'] : [];
        /* 老数据里可能混进了管理员设备，展示时再滤一遍 */
        if ($admins) {
            $v = array_diff_key($v, $admins);
        }
        foreach (array_keys($v) as $fp) {
            $uniq[$fp] = 1;
        }
        $days[] = [
            'd' => $d,
            'views' => (int)($r['views'] ?? 0),
            'visitors' => count($v),
            'human' => (int)($r['human'] ?? 0),
            'agent' => (int)($r['agent'] ?? 0),
            'search' => (int)($r['search'] ?? 0),
            'zero' => (int)($r['zero'] ?? 0),
            'api' => (int)($r['api'] ?? 0),
            'aia' => (int)($r['aia'] ?? 0),
        ];
    }
    $sum = function (string $k) use ($days): int {
        $n = 0;
        foreach ($days as $d) {
            $n += (int)$d[$k];
        }
        return $n;
    };
    $top = [];
    foreach ($store['stats'] as $id => $s) {
        $n = (int)($s['download'] ?? 0) + (int)($s['copy'] ?? 0);
        if ($n > 0) {
            $top[] = ['id' => (string)$id, 'n' => $n];
        }
    }
    usort($top, function ($x, $y) { return $y['n'] <=> $x['n']; });
    $top = array_slice($top, 0, 8);
    $votes = ['up' => 0, 'down' => 0];
    foreach ($store['votes'] as $v) {
        $votes['up'] += (int)($v['up'] ?? 0);
        $votes['down'] += (int)($v['down'] ?? 0);
    }
    $topVoted = [];
    foreach ($store['votes'] as $id => $v) {
        if ((int)($v['up'] ?? 0) > 0) {
            $topVoted[] = ['id' => (string)$id, 'up' => (int)$v['up'], 'down' => (int)($v['down'] ?? 0)];
        }
    }
    usort($topVoted, function ($x, $y) { return $y['up'] <=> $x['up']; });
    $topVoted = array_slice($topVoted, 0, 6);
    $pending = 0;
    foreach ($store['submissions'] as $s) {
        if (($s['status'] ?? '') === 'pending') {
            $pending++;
        }
    }
    $pairs = function (array $map): array {
        $out = [];
        foreach ($map as $q => $n) {
            $out[] = ['q' => (string)$q, 'n' => (int)$n];
        }
        return $out;
    };
    /* 最近来访：按指纹起名，管理员设备单独标出来 */
    $people = [];
    foreach ($a['people'] as $fp => $p) {
        $fp = (string)$fp;
        $isAdmin = isset($admins[$fp]);
        $people[] = [
            'name' => $isAdmin ? '管理员' : visitorName($fp),
            'n' => (int)($p['n'] ?? 0),
            'last' => (int)($p['last'] ?? 0),
            'admin' => $isAdmin,
        ];
    }
    usort($people, function ($x, $y) { return $y['last'] <=> $x['last']; });
    $people = array_slice($people, 0, 12);
    return [
        'days' => $days,
        'views' => $sum('views'),
        'visitors' => count($uniq),
        'human' => $sum('human'),
        'agent' => $sum('agent'),
        'search' => $sum('search'),
        'zero' => $sum('zero'),
        'api' => $a['api'],
        'topIcons' => $top,
        'topSearches' => array_slice($pairs($a['searches']), 0, 8),
        'zeroSearches' => array_slice($pairs($a['zero']), 0, 8),
        'votes' => $votes,
        'topVoted' => $topVoted,
        'pending' => $pending,
        'adminAi' => $sum('aia'),
        'visitorsList' => $people,
    ];
}

/* ── 给 agent 的文档（内容跟着部署地址生成）────────── */

function catLine(): string
{
    $n = [];
    foreach (publicIcons() as $it) {
        $n[$it['scene']] = ($n[$it['scene']] ?? 0) + 1;
    }
    $parts = [];
    foreach (SCENE_ORDER as $k) {
        if (isset($n[$k])) {
            $parts[] = $k . ' ' . $n[$k];
        }
    }
    foreach ($n as $k => $v) {
        if (!in_array($k, SCENE_ORDER, true)) {
            $parts[] = $k . ' ' . $v;
        }
    }
    return implode(' · ', $parts);
}

function promptDoc(): string
{
    $tpl = <<<'TXT'
图标来自下面这个库。

  搜索：curl -s "{{BASE}}/api.php?action=search&q=删除&limit=8"
        中英文都行，已按相关度排好，取第一条。
  取图：curl -s "{{BASE}}/api.php?action=svg&id=trash"
        返回的就是 <svg>…</svg> 原文。

库里 {{COUNT}} 枚 24×24 线性图标：{{CATS}}。
它们都是这个样子——24 网格、viewBox 固定 0 0 24 24、描边 2（少数 3）、颜色写 currentColor：

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
  <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
</svg>

取回来整段放进 JSX / HTML 就行：大小交给外层 class（w-4 h-4），颜色交给外层 color。
库里描边 2 和 3 都有，取到多粗就用多粗。

搜「删除」没有结果时，依次换 delete / trash / remove / 清空 再搜；
还没有就告诉用户库里没有这枚，请他到 {{BASE}} 上传（免登录，过审后入库）。
如果用户一次要补很多枚，可以批量上传：POST action=submitBulk，带固定 fp 和 items 数组，
具体用法见 {{BASE}}/skills/icon-library/ 。
用户如果给了管理员 key，请求带 `X-Icon-Key: <key>` 头即可被记成管理员 AI；
带 key 还能直接改名（`action=rename`）、审核（`action=review`），上传也会直接通过。

完整文档：curl -s "{{BASE}}/skills/icon-library/"
TXT;
    return str_replace(
        ['{{BASE}}', '{{COUNT}}', '{{CATS}}'],
        [baseUrl(), (string)count(publicIcons()), catLine()],
        $tpl
    );
}

function skillDoc(): string
{
    $tpl = <<<'MD'
---
name: icon-library
description: 从「图标仓」检索并取用线性 SVG 图标（{{COUNT}} 枚，中文 / 英文关键词都能搜）。当用户要加图标、找图标，或你要给按钮、导航、空状态、功能入口配一枚图标时使用。
---

**这是一份自包含的 skill 文件。** 把本文件放到你所用的 agent 的 skill 目录（目录名 `icon-library`，文件名 `SKILL.md`）就算装好，不需要再读别的文档。Claude Code、WorkBuddy、Codex、Gemini CLI、Cursor 读的是 `SKILL.md`；TRAE 读 `.trae/rules/` 或 `AGENTS.md`——文件名不同，内容一样。不确定路径时问用户一句比猜快。

# 图标仓

{{COUNT}} 枚 24×24 线性图标，覆盖：{{CATS}}。只读公开接口，不用登录。颜色是 `currentColor`，跟着外层 `color` 走。

接口根：`{{BASE}}/api.php`

## 0. 用户给了 key 就带上（可选）

如果用户说“我的 key 是 xxx”“用管理员身份”，就把这个值放进请求头：

```bash
curl -s -H "X-Icon-Key: <key>" "{{BASE}}/api.php?action=search&q=删除"
```

- 有 key 不改变搜索结果、取图内容或权限，只是把调用记成「管理员 AI」，不计入站点的访客 / 对外 AI 下载量。
- 也可以写成 `&key=<key>`，但 header 更干净，也不会进访问日志。
- 用户没给 key 就正常请求，**不要自己编一个**，也不要把它写进代码或提交到仓库。

## 1. 搜

```bash
curl -s "{{BASE}}/api.php?action=search&q=删除&limit=8"
```

```json
{"ok":true,"total":3,"items":[{"id":"trash","name":"删除","scene":"基础操作",
 "alias":"删除 trash delete 垃圾桶 移除 清空 remove","license":"ISC · Lucide","viewBox":"0 0 24 24",
 "svg_url":"{{BASE}}/api.php?action=svg&id=trash"}]}
```

- `q` 中英文都行；空格分隔多个词时要求全部命中
- `scene` 按分类过滤；`limit` 默认 12、最多 50；不传 `q` 就返回用得最多的图标
- 结果已按「相关度 → 使用次数」排好，**默认取第一条**

## 2. 取

```bash
curl -s "{{BASE}}/api.php?action=svg&id=trash"
```

返回 `<svg …>…</svg>` 原文，`Content-Type: image/svg+xml`，可直接内联进 HTML / JSX / Vue。

## 3. 全量清单（多数情况用不到）

```bash
curl -s "{{BASE}}/api.php?action=catalog"                  # id / 名称 / 别名 / 分类，不含 svg（约 100KB，gzip 后 25KB）
curl -s "{{BASE}}/api.php?action=catalog&scene=商业金融"
```

## 4. 批量上传（agent 用）

用户明确说要往库里补一批图标时，直接批量提交，不用一枚一枚传：

```bash
curl -s -X POST "{{BASE}}/api.php" \
  -H "Content-Type: application/json" \
  -d '{"action":"submitBulk","fp":"agent-your-name",
       "items":[{"name":"删除","alias":"删除 delete trash","svg":"<svg …>…</svg>"},
                {"name":"设置","alias":"设置 settings gear","svg":"<svg …>…</svg>"}]}'
```

- `fp` 是你给自己起的固定身份（4–64 位字母数字），服务器会把它记成 `agent-XXXX`，管理员审核时一眼能看出是 agent 传的。**同一套 agent 每次都传同一个 fp**，不要每次换。
- 单次最多 50 个，每个指纹每天最多 100 个；超了返回 429。
- 每个 item 必填 `name` 和 `svg`；`alias` 可写也可在顶层写一份共享的。SVG 单枚 ≤256KB，必须是 `<svg>` 根节点。
- 不带 key 提交后进待审；带管理员 key 直接通过、立刻对外可见。返回 `{"ok":true,"ids":[…],"count":N,"status":"pending|approved","remaining":R}`。
- 只有用户明确要求“补这些图标 / 批量上传”时才做，不要自己主动往库里塞东西。

## 5. 帮用户改已有图标（需要管理员 key）

用户把管理员 key 给你之后，除了读统计，还能直接帮他改：

```bash
# 改名称 / 别名 / 分类 / 标签，只改传了的字段
curl -s -X POST "{{BASE}}/api.php" \
  -H "Content-Type: application/json" -H "X-Icon-Key: <key>" \
  -d '{"action":"rename","id":"trash","name":"删除","alias":"删除 delete trash remove"}'

# 审核待审：decision = approve / reject
curl -s -X POST "{{BASE}}/api.php" \
  -H "Content-Type: application/json" -H "X-Icon-Key: <key>" \
  -d '{"action":"review","id":"up-20261105-a1b2c3","decision":"approve"}'
```

- 带 key 的 `submitBulk` 上传会**直接通过**，不用再等管理员点审核；每天仍限 100 个。
- 改之前先用 `search` / `catalog` 拿到准确 `id`，把「id → 新名称 / 新别名」列出来给用户确认，再一条条改；不要批量瞎改。
- 不能做：删除图标、改类别结构；这两类只认网页登录。
- key 只在请求头里用，别写进代码、别提交到仓库。

## 规矩

1. **先搜。** 库里这些是同一套网格、同一套粗细，自己画的混进去一眼看得出来。
2. **整段照搬**：`<svg …>` 连同 `viewBox="0 0 24 24"`、`stroke-width`、`stroke-linecap` 一起用。库里 2 和 3 都有，取到多粗就用多粗；颜色是 `currentColor`，跟着外层 `color` 走，大小由外层 class 决定。
3. 一次取一枚。`catalog` 留给「我要看全部」的场合。
4. 搜不到就换词：中文 → 英文 → 近义词 → 更抽象的说法（「删除」→ delete / trash / remove / 清空）。
5. 库里没有这枚时，直接告诉用户，并建议他去 {{BASE}} 上传（免登录，过审后入库）。
6. 别名里塞了大量同义词，命中别名时挑最贴近当前语境的那条。

## 许可

多数是 ISC · Lucide，另有自有图标和少量 CC BY 4.0 / MIT。商用都可以；需要署名时按返回里的 `license` 写。
MD;
    return str_replace(
        ['{{BASE}}', '{{COUNT}}', '{{CATS}}'],
        [baseUrl(), (string)count(publicIcons()), catLine()],
        $tpl
    );
}

function llmsDoc(): string
{
    $tpl = <<<'TXT'
# 图标仓

> {{COUNT}} 枚 24×24 线性 SVG 图标，中英文关键词都能搜。只读公开接口，无需登录。

## 装成 skill

本站本身就是一个 skill：`{{BASE}}/skills/icon-library/`（同一份内容也在 `{{BASE}}/api.php?action=skill`）。存进你所用的 agent 的 skill 目录即装好，之后它自己会知道什么时候该来搜图标。

## 接口

- 搜索：{{BASE}}/api.php?action=search&q=删除&limit=8
- 取 SVG：{{BASE}}/api.php?action=svg&id=trash
- 全量清单：{{BASE}}/api.php?action=catalog
- 批量上传（agent，POST action=submitBulk，带固定 fp）：{{BASE}}/api.php
- 给 agent 的完整用法：{{BASE}}/api.php?action=skill
- 给人看的网页：{{BASE}}/

## 分类

{{CATS}}
TXT;
    return str_replace(
        ['{{BASE}}', '{{COUNT}}', '{{CATS}}'],
        [baseUrl(), (string)count(publicIcons()), catLine()],
        $tpl
    );
}

/* ── 路由 ───────────────────────────────────────────── */

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$body = [];
$action = isset($_GET['action']) ? (string)$_GET['action'] : '';

if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0750, true);
}

if ($method === 'POST') {
    $ct = (string)($_SERVER['CONTENT_TYPE'] ?? '');
    if (stripos($ct, 'application/json') === false) {
        fail('请求需为 application/json', 415);
    }
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) {
        fail('JSON 解析失败', 400);
    }
    if (isset($body['action']) && is_string($body['action'])) {
        $action = $body['action'];
    }
}

if ($action === '') {
    fail('缺少 action', 400);
}

/* ── 公开只读：搜索 / 取图 / 清单 / 文档 ───────────── */

if ($action === 'search') {
    corsOut();
    $q = (string)($_GET['q'] ?? '');
    $scene = (string)($_GET['scene'] ?? '');
    $limit = (int)($_GET['limit'] ?? 12);
    if ($limit < 1) {
        $limit = 12;
    }
    if ($limit > 50) {
        $limit = 50;
    }
    $hits = searchHits($q, $scene, 0, statCache());
    /* 标为「不喜欢」/「隐藏」的不出现在 agent 能看到的列表里 */
    $blocked = blockedIds();
    if ($blocked) {
        $hits = array_values(array_filter($hits, function ($it) use ($blocked) {
            return !isset($blocked[(string)$it['id']]);
        }));
    }
    $out = [];
    foreach (array_slice($hits, 0, $limit) as $it) {
        $out[] = briefIcon($it);
    }
    hitEvent(['t' => 'search', 'q' => $q, 'n' => count($hits), 'adm' => aiKeyValid()]);
    ok([
        'q' => $q,
        'scene' => $scene,
        'total' => count($hits),
        'items' => $out,
        'tip' => count($hits) ? '取第一条即可；取图用 items[].svg_url' : '换个词再搜：中文 / 英文 / 近义词',
    ]);
}

if ($action === 'svg') {
    corsOut();
    $id = (string)($_GET['id'] ?? '');
    $icons = publicIcons();
    if ($id === '' || !isset($icons[$id]) || $icons[$id]['svg'] === '') {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo "没有这个 id：{$id}\n先搜：api.php?action=search&q=关键词\n";
        exit;
    }
    /* 取一次算一次使用（人和 agent 同口径）；同一来源 IP 一天对同一枚只计一次。
       日志满了就顺手并进加密库 */
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $who = 'ip-' . substr(md5($ip === '' ? 'unknown' : $ip), 0, 12);
    $aiAdmin = aiKeyValid();
    /* 管理员自己的 AI 取图不写进公开下载量，只记进「管理员 AI」 */
    $counted = $aiAdmin ? false : !dlSeen($id, $who);
    if ($counted) {
        hitLog($id, 'download');
    }
    hitEvent(['t' => 'dl', 'src' => 'agent', 'id' => $id, 'counted' => $counted, 'api' => 'svg', 'adm' => $aiAdmin]);
    if ((int)@filesize(HITS_FILE) > 200000) {
        flushHits();
    }
    header('Content-Type: image/svg+xml; charset=utf-8');
    header('Cache-Control: public, max-age=86400');
    header('X-Icon-Id: ' . $id);
    echo $icons[$id]['svg'];
    exit;
}

if ($action === 'catalog') {
    corsOut();
    $scene = (string)($_GET['scene'] ?? '');
    $want = $scene === '' ? '' : sceneAlias($scene);
    $items = [];
    $blocked = blockedIds();
    foreach (publicIcons() as $it) {
        if ($want !== '' && $it['scene'] !== $want) {
            continue;
        }
        if ($blocked && isset($blocked[(string)$it['id']])) {
            continue;
        }
        unset($it['svg']);
        $it['_o'] = array_search($it['scene'], SCENE_ORDER, true);
        $items[] = $it;
    }
    $prefs = prefMap();
    usort($items, static function (array $a, array $b) use ($prefs): int {
        $la = (($prefs[$a['id']] ?? '') === 'like') ? 0 : 1;
        $lb = (($prefs[$b['id']] ?? '') === 'like') ? 0 : 1;
        if ($la !== $lb) {
            return $la <=> $lb;
        }
        $oa = $a['_o'] === false ? 99 : $a['_o'];
        $ob = $b['_o'] === false ? 99 : $b['_o'];
        return $oa === $ob ? strcmp($a['id'], $b['id']) : $oa <=> $ob;
    });
    foreach ($items as &$it) {
        unset($it['_o']);
    }
    unset($it);
    hitEvent(['t' => 'api', 'k' => 'catalog', 'adm' => aiKeyValid()]);
    ok(['count' => count($items), 'items' => $items]);
}

if ($action === 'skill' || $action === 'prompt' || $action === 'llms') {
    hitEvent(['t' => 'api', 'k' => 'skill', 'adm' => aiKeyValid()]);
    corsOut();
    $doc = $action === 'skill' ? skillDoc() : ($action === 'prompt' ? promptDoc() : llmsDoc());
    header('Content-Type: ' . ($action === 'llms' ? 'text/plain' : 'text/markdown') . '; charset=utf-8');
    header('Cache-Control: public, max-age=300');
    if ($action === 'skill') {
        /* 这几行只有 curl / agent 看得到，人打开网页看不到。
           指向一个「长得像文件」的地址，省得 agent 去猜 api.php?action= 是什么。 */
        header('Link: <' . baseUrl() . '/skills/icon-library/>; rel="alternate"; type="text/markdown"; title="icon-library skill"');
        header('X-Skill-Name: icon-library');
        header('X-Skill-Install: skills/icon-library/SKILL.md');
    }
    echo $doc;
    exit;
}

if ($action === 'ping') {
    ok([
        'server' => true,
        'php' => PHP_VERSION,
        'openssl' => extension_loaded('openssl'),
        'hasStore' => is_file(STORE_FILE),
        'hasEnv' => is_file(ENV_FILE),
        'accounts' => [
            'admin' => cfg()['ADMIN_PASS'] !== '',
            'user' => cfg()['USER_PASS'] !== '',
        ],
    ]);
}

if ($action === 'selftest') {
    $secret = 'selftest-' . bin2hex(random_bytes(4));
    $sample = ['version' => 2, 'updatedAt' => gmdate('c'), 'prefs' => ['demo-a' => 'like'], 'submissions' => [], 'renames' => []];
    $blob = seal($secret, $sample);
    $back = unseal($secret, $blob);
    ok([
        'server' => true,
        'openssl' => extension_loaded('openssl'),
        'cipher' => 'aes-256-gcm',
        'kdf' => 'pbkdf2-sha256',
        'iterations' => KDF_ITER,
        'blobBytes' => strlen($blob),
        'magic' => substr($blob, 0, 8),
        'roundTrip' => $back === $sample,
        'writable' => is_dir(DATA_DIR) && is_writable(DATA_DIR),
        'hasEnv' => is_file(ENV_FILE),
        'secretReplaced' => cfg()['SESSION_SECRET'] !== 'change-me-in-env',
    ]);
}

if ($action === 'login') {
    guardThrottle();
    list($user, $pass) = credsFrom($body);
    if ($user === '' || $pass === '') {
        fail('请输入用户名和密码', 400);
    }
    $who = checkCredentials($user, $pass);
    if ($who === null) {
        noteFail();
        $st = readThrottle();
        $left = max(0, RATE_MAX - count(recentFails($st['fails'], time())));
        fail('用户名或密码不对，还可尝试 ' . $left . ' 次', 401, 'bad_credentials');
    }
    noteOk();
    ok(['token' => makeToken($who['role'], $who['name']), 'user' => $who]);
}

if ($action === 'track') {
    /* 复制 / 下载计数。故意不要求登录：agent 直接调接口取图，也该算一次使用。
       只认 copy / download 两种，别的字段一概不存，避免被当成任意写接口。
       两种都合并成「下载」；带指纹时同一设备同一天对同一枚图标只计一次。 */
    $id = cleanId($body['id'] ?? null);
    $op = (string)($body['op'] ?? '');
    if ($op !== 'copy' && $op !== 'download') {
        fail('op 只能是 copy 或 download', 400);
    }
    $fp = cleanFp($body['fp'] ?? null);
    $counted = true;
    if ($fp !== '' && dlSeen($id, $fp)) {
        $counted = false;
    } else {
        /* 只追加一行明文日志，不下发也不回读；下一次 state 时攒批并进加密库 */
        hitLog($id, 'download');
        hitEvent(['t' => 'dl', 'src' => 'human', 'id' => $id]);
    }
    ok(['id' => $id, 'op' => $op, 'counted' => $counted]);
}

if ($action === 'vote') {
    /* 点赞 / 点踩：没登录也能投，一人一票，换方向就挪一票，再点同一方向取消。
       用浏览器指纹认人；权重高的图标排序时往前站。 */
    $id = cleanId($body['id'] ?? null);
    $dir = (string)($body['dir'] ?? '');
    if (!in_array($dir, ['up', 'down', 'clear'], true)) {
        fail('dir 只能是 up / down / clear', 400);
    }
    $fp = cleanFp($body['fp'] ?? null);
    if ($fp === '') {
        fail('需要设备标识（浏览器指纹）', 400);
    }
    $icons = publicIcons();
    if (!isset($icons[$id])) {
        fail('没找到这个图标', 404);
    }
    $store = loadStore();
    $key = $id . '|' . $fp;
    $prev = (string)($store['voters'][$key] ?? '');
    $v = $store['votes'][$id] ?? ['up' => 0, 'down' => 0];
    if ($dir === 'clear' || $prev === $dir) {
        if ($prev === 'up' || $prev === 'down') {
            $v[$prev] = max(0, (int)($v[$prev] ?? 0) - 1);
        }
        unset($store['voters'][$key]);
        $dir = '';
    } else {
        if ($prev === 'up' || $prev === 'down') {
            $v[$prev] = max(0, (int)($v[$prev] ?? 0) - 1);
        }
        $v[$dir] = (int)($v[$dir] ?? 0) + 1;
        $store['voters'][$key] = $dir;
    }
    if ((int)($v['up'] ?? 0) + (int)($v['down'] ?? 0) <= 0) {
        unset($store['votes'][$id]);
        $v = ['up' => 0, 'down' => 0];
    } else {
        $store['votes'][$id] = $v;
    }
    saveStore($store);
    ok([
        'id' => $id,
        'up' => (int)($v['up'] ?? 0),
        'down' => (int)($v['down'] ?? 0),
        'mine' => $dir,
        'updatedAt' => $store['updatedAt'],
    ]);
}

if ($action === 'state') {
    $user = optionalUser($body);
    $realAdmin = $user !== null && $user['role'] === 'admin';
    /* AI 带 X-Icon-Key（或 ?key=）也能按管理员认：读统计、改名、审核、上传直接通过；
       删除图标和改类别结构仍然只认网页登录 */
    $isAdmin = $realAdmin || aiKeyValid();
    $fp = cleanFp($_GET['fp'] ?? null);
    if ($fp !== '') {
        $hfp = substr(hash('sha256', $fp), 0, 16);
        /* 管理员设备单独记成 admin 事件：记住这枚指纹，之后一律不计进访客 */
        hitEvent(['t' => $isAdmin ? 'admin' : 'visit', 'fp' => $hfp]);
    }
    /* 先把这期间攒下的复制 / 下载 / 访客事件并进库，页面拿到的就是最新计数 */
    $store = flushHits() ?? loadStore();
    /* 访客事件每次刷新都有，但解密 + 加密一次要跑 21 万轮 PBKDF2，不能每次页面加载都做。
       普通访客只在日志堆大时才并库；管理员每次取状态都并，保证面板数字是新的。 */
    if ($isAdmin || (int)@filesize(ANALYTICS_FILE) > 200000) {
        $store = flushAnalytics($store);
    }
    syncPrefMap($store['prefs']);
    $extras = [];
    foreach (approvedSubmissions($store) as $s) {
        $extras[] = publicExtra($s);
    }
    $pending = [];
    if ($realAdmin) {
        foreach ($store['submissions'] as $s) {
            if (($s['status'] ?? '') === 'pending') {
                $pending[] = publicExtra($s) + ['status' => 'pending', 'by' => $s['by'] ?? '', 'at' => $s['at'] ?? ''];
            }
        }
    }
    $payload = [
        'updatedAt' => $store['updatedAt'],
        'user' => $user ? ['name' => $user['name'], 'role' => $user['role'], 'exp' => $user['exp']] : null,
        'renames' => (object)$store['renames'],
        'cats' => $store['cats'],
        'catMap' => (object)$store['catMap'],
        'extras' => $extras,
        'pending' => $pending,
        /* 下载 / 点赞次数：前端据此排序和展示 */
        'stats' => (object)$store['stats'],
        /* 点赞 / 点踩：默认排序和「综合热度」都读它 */
        'votes' => (object)$store['votes'],
        /* 标记对所有人公开，但前端只在管理员模式用它做筛选，不再据此置顶 */
        'prefs' => (object)$store['prefs'],
        /* 统计只给管理员 */
        'analytics' => $isAdmin ? analyticsSummary($store) : null,
    ];
    ok($payload);
}

if ($action === 'prefs') {
    if (optionalUser($body) === null) {
        list($user, $pass) = credsFrom($body);
        if ($user === '' || $pass === '') {
            fail('需要登录或提供 user/pass', 401, 'need_login');
        }
        guardThrottle();
        if (checkCredentials($user, $pass) === null) {
            noteFail();
            fail('用户名或密码不对', 401, 'bad_credentials');
        }
        noteOk();
    }
    ok(prefsPayload(loadStore()));
}

if ($action === 'base') {
    requireAdmin($body);
    $base = baseData();
    if (!$base) {
        fail('缺少 data/base.php，请重新构建并上传', 500);
    }
    ok($base);
}

if ($action === 'set') {
    $u = requireUser($body);
    $id = cleanId($body['id'] ?? null);
    $state = $body['state'] ?? null;
    if ($state === '') {
        $state = null;
    }
    if ($state !== null && (!is_string($state) || !in_array($state, ALLOWED_STATES, true))) {
        fail('state 只能是 like / dislike / hide / null', 400);
    }
    $store = loadStore();
    if ($state === null) {
        unset($store['prefs'][$id]);
    } else {
        $store['prefs'][$id] = $state;
    }
    saveStore($store);
    syncPrefMap($store['prefs']);
    ok([
        'updatedAt' => $store['updatedAt'],
        'prefs' => (object)$store['prefs'],
        /* 带回加成后的计数，前端不用等下次刷新就能重新排 */
        'votes' => (object)$store['votes'],
        'stats' => (object)$store['stats'],
    ]);
}

if ($action === 'submit' || $action === 'submitBulk') {
    /* 不登录也能投稿：没 token 就记成「游客XXXX」；agent 走 submitBulk 记成「agent-XXXX」。
       每个指纹一天最多 100 个，网页端一次最多拖 10 个，接口单次最多 50 个。 */
    $u = optionalUser($body);
    $store = loadStore();
    /* 管理员登录上传直接通过；带管理员 key 的 agent 也直接通过，但每天 100 个的额度照样算 */
    $realAdmin = $u !== null && $u['role'] === 'admin';
    $isAdmin = $realAdmin || aiKeyValid();
    $isAgent = $action === 'submitBulk' || !empty($body['agent']);
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $rawFp = cleanFp($body['fp'] ?? $_GET['fp'] ?? null);
    if ($rawFp === '') {
        $rawFp = 'ip-' . substr(md5($ip === '' ? 'unknown' : $ip), 0, 12);
    }
    $hfp = substr(hash('sha256', $rawFp), 0, 16);
    $by = $u ? (string)$u['name'] : ($isAgent ? 'agent-' . visitorCode($hfp) : visitorName($hfp));

    $items = $body['items'] ?? null;
    if ($items === null) {
        $items = [[
            'name' => $body['name'] ?? null,
            'alias' => $body['alias'] ?? null,
            'scene' => $body['scene'] ?? null,
            'type' => $body['type'] ?? null,
            'tags' => $body['tags'] ?? null,
            'svg' => $body['svg'] ?? null,
        ]];
    }
    if (!is_array($items) || !$items) {
        fail('没有收到要上传的图标', 400);
    }
    if (count($items) > UPLOAD_BATCH_MAX) {
        fail('一次最多 ' . UPLOAD_BATCH_MAX . ' 个，分几批发吧', 400);
    }

    $day = date('Y-m-d');
    $used = (int)($store['uploads'][$day][$hfp] ?? 0);
    $n = count($items);
    if (!$realAdmin && $used + $n > UPLOAD_DAY_MAX) {
        $left = max(0, UPLOAD_DAY_MAX - $used);
        fail('这个指纹今天已经传了 ' . $used . ' 个，上限 ' . UPLOAD_DAY_MAX . ' 个，还剩 ' . $left . ' 个名额', 429);
    }

    $created = [];
    foreach ($items as $i => $it) {
        $at = $i + 1;
        if (!is_array($it)) {
            fail('第 ' . $at . ' 条格式不对', 400);
        }
        $name = cleanText($it['name'] ?? null, '名称', 40);
        $alias = cleanOptionalText($it['alias'] ?? $body['alias'] ?? null, '别名', 160);
        /* 用户上传不再填类别：没填就进「待归类」，填了旧类别名也归一过来 */
        $scene = sceneAlias((string)cleanOptionalText($it['scene'] ?? $body['scene'] ?? null, '分类', 40));
        if ($scene !== '' && isset($store['catMap'][$scene])) {
            $scene = (string)$store['catMap'][$scene];
        }
        $type = cleanOptionalText($it['type'] ?? $body['type'] ?? null, '类型', 16);
        $tags = cleanTags($it['tags'] ?? $body['tags'] ?? null);
        try {
            $svg = cleanSvg($it['svg'] ?? null);
        } catch (Throwable $ex) {
            fail('第 ' . $at . ' 个：' . $ex->getMessage(), 400);
        }
        $id = 'up-' . date('Ymd') . '-' . bin2hex(random_bytes(3));
        $store['submissions'][] = [
            'id' => $id,
            'name' => $name,
            'alias' => $alias,
            'scene' => $scene,
            'type' => $type,
            'tags' => $tags,
            'svg' => $svg,
            'viewBox' => viewBoxOf($svg),
            'status' => $isAdmin ? 'approved' : 'pending',
            'by' => $by,
            'byKind' => $isAgent ? 'agent' : 'human',
            'fp' => $hfp,
            'ip' => $ip,
            'at' => gmdate('c'),
        ];
        $created[] = $id;
    }

    if (!$realAdmin) {
        $store['uploads'][$day][$hfp] = $used + $n;
        /* 上传额度只留最近 30 天 */
        $cut = date('Y-m-d', strtotime('-30 days'));
        foreach (array_keys($store['uploads']) as $d) {
            if ((string)$d < $cut) {
                unset($store['uploads'][$d]);
            }
        }
    }
    saveStore($store);
    ok([
        'id' => $created[0],
        'ids' => $created,
        'count' => count($created),
        'status' => $isAdmin ? 'approved' : 'pending',
        'remaining' => $isAdmin ? null : max(0, UPLOAD_DAY_MAX - $used - $n),
        'updatedAt' => $store['updatedAt'],
    ]);
}

if ($action === 'review') {
    requireAdminOrAi($body);
    $id = cleanId($body['id'] ?? null);
    $decision = (string)($body['decision'] ?? '');
    if (!in_array($decision, ['approve', 'reject'], true)) {
        fail('decision 只能是 approve / reject', 400);
    }
    $store = loadStore();
    $hit = false;
    foreach ($store['submissions'] as $i => $s) {
        if ($s['id'] === $id) {
            $store['submissions'][$i]['status'] = $decision === 'approve' ? 'approved' : 'rejected';
            $store['submissions'][$i]['reviewedAt'] = gmdate('c');
            $hit = true;
            break;
        }
    }
    if (!$hit) {
        fail('没找到这条投稿', 404);
    }
    saveStore($store);
    ok(['updatedAt' => $store['updatedAt']]);
}

if ($action === 'rename') {
    requireAdminOrAi($body);
    $id = cleanId($body['id'] ?? null);
    $patch = [];
    foreach (['name' => 40, 'alias' => 160, 'scene' => 40] as $k => $max) {
        if (array_key_exists($k, $body)) {
            $patch[$k] = cleanOptionalText($body[$k], $k, $max);
        }
    }
    if (array_key_exists('tags', $body)) {
        $patch['tags'] = cleanTags($body['tags']);
    }
    if (!count($patch)) {
        fail('没有要改的字段', 400);
    }
    if (array_key_exists('name', $patch) && $patch['name'] === '') {
        fail('名称不能为空', 400);
    }
    $store = loadStore();
    $isSubmission = false;
    foreach ($store['submissions'] as $i => $s) {
        if ($s['id'] === $id) {
            foreach ($patch as $k => $v) {
                $store['submissions'][$i][$k] = $v;
            }
            $isSubmission = true;
            break;
        }
    }
    if (!$isSubmission) {
        if (!isset(readIndex()[$id]) && brandById($id) === null) {
            fail('没找到这个图标', 404);
        }
        $cur = $store['renames'][$id] ?? [];
        $store['renames'][$id] = array_merge($cur, $patch);
    }
    saveStore($store);
    ok(['updatedAt' => $store['updatedAt'], 'id' => $id, 'patch' => $patch]);
}

/* 类别：add 新增 / rename 改名（连带把图标搬到新名下）/ remove 删除（图标移走） */
if ($action === 'cat') {
    requireAdmin($body);
    $op = (string)($body['op'] ?? '');
    $store = loadStore();

    if ($op === 'add') {
        $name = cleanText($body['name'] ?? null, '类别名', 40);
        if (!in_array($name, knownScenes($store), true)) {
            $store['cats'][] = $name;
        }
        saveStore($store);
        ok(['cats' => $store['cats'], 'updatedAt' => $store['updatedAt'], 'name' => $name]);
    }

    if ($op === 'rename' || $op === 'remove') {
        /* 类别是从 index.json 里逐个图标反查的：缺了它改不动，早点说清楚，
           别让管理员以为点了没反应 */
        if (!count(readIndex())) {
            fail('服务器上找不到 index.json，无法按类别批量改；请把 dist 里的 index.json 一起上传', 500);
        }
    }

    if ($op === 'rename') {
        $from = cleanText($body['from'] ?? null, '原类别名', 40);
        $to = cleanText($body['to'] ?? null, '新类别名', 40);
        if ($from === $to) {
            fail('新旧名字一样，不用改', 400);
        }
        $moved = moveScene($store, $from, $to);
        $cats = [];
        foreach ($store['cats'] as $c) {
            $cats[] = $c === $from ? $to : $c;
        }
        $store['cats'] = array_values(array_unique($cats));
        foreach ($store['catMap'] as $k => $v) {
            if ($v === $from) {
                $store['catMap'][$k] = $to;
            }
        }
        $store['catMap'][$from] = $to;
        saveStore($store);
        ok([
            'cats' => $store['cats'],
            'catMap' => (object)$store['catMap'],
            'moved' => $moved,
            'updatedAt' => $store['updatedAt'],
        ]);
    }

    if ($op === 'remove') {
        $from = cleanText($body['name'] ?? null, '类别名', 40);
        $move = cleanOptionalText($body['move'] ?? '', '移到的类别', 40);
        if ($move === $from) {
            fail('不能移到自己身上', 400);
        }
        $moved = moveScene($store, $from, $move);
        $cats = [];
        foreach ($store['cats'] as $c) {
            if ($c !== $from) {
                $cats[] = $c;
            }
        }
        $store['cats'] = array_values($cats);
        foreach ($store['catMap'] as $k => $v) {
            if ($v === $from) {
                $store['catMap'][$k] = $move;
            }
        }
        saveStore($store);
        ok([
            'cats' => $store['cats'],
            'catMap' => (object)$store['catMap'],
            'moved' => $moved,
            'updatedAt' => $store['updatedAt'],
        ]);
    }

    fail('op 只能是 add / rename / remove', 400);
}

if ($action === 'delete') {
    requireAdmin($body);
    $id = cleanId($body['id'] ?? null);
    $store = loadStore();
    $keep = [];
    $hit = false;
    foreach ($store['submissions'] as $s) {
        if ($s['id'] === $id) {
            $hit = true;
            continue;
        }
        $keep[] = $s;
    }
    if (!$hit) {
        fail('没找到这条投稿', 404);
    }
    $store['submissions'] = $keep;
    unset($store['prefs'][$id]);
    saveStore($store);
    syncPrefMap($store['prefs']);
    ok(['updatedAt' => $store['updatedAt']]);
}

fail('未知 action', 400);
