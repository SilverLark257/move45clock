/**
 * 把「健康钟」插件安装进 DSH 的 desktop profile（或卸载 / 查看状态）。
 * ============================================================================
 *
 * 为什么不能直接用 `dsh plugin install`：
 *   桌面版 profile 由 Electron 应用独占管理，`dsh plugin --profile desktop`
 *   被硬禁用。所以这里做与插件管理器等价的三件事：
 *     1. profile 的 package.json dependencies 增加本包（file: 指向本目录）
 *     2. profile 的 dsh.profile.bundles 增加本包名（这一步才是「启用」的关键）
 *     3. node_modules 下建立目录联接，让 Node 解析能找到本包
 *
 * （本脚本裁剪自 dsh-work-diary/tools/install.js —— 那台机器上验证过的做法。
 *   去掉了 HTTP 探测：本插件宿主半边不注册路由，没东西可探。）
 *
 * 用法：
 *   node tools/install.js                  # 安装（或修复不完整的安装）
 *   node tools/install.js --uninstall      # 卸载
 *   node tools/install.js --status         # 只看状态，不改动
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(SELF_DIR, 'package.json'), 'utf8'));
const PKG_NAME = PKG.name;

// ── 命令行参数 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const MODE = argv.includes('--uninstall') ? 'uninstall'
  : argv.includes('--status') ? 'status'
    : 'install';
const profileArg = argv.find((a) => a.startsWith('--profile='));
const PROFILE_NAME = profileArg ? profileArg.slice('--profile='.length) : 'desktop';

// ── 路径探测 ──────────────────────────────────────────────────────────────
/** DSH 家目录（~/.dsh）。 */
function dshHome() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}

/**
 * 定位要安装的目标 profile 目录。
 * 判据是含 cordis.yml 或 cordis.patch.yml —— 光看目录名会把
 * profiles/node_modules 这种误判成 profile。
 */
function findProfileDir() {
  const home = dshHome();
  const root = path.join(home, 'profiles');
  const candidates = [
    path.join(root, PROFILE_NAME),
    path.join(root, 'desktop'),
    path.join(root, 'web')
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, 'cordis.yml')) || fs.existsSync(path.join(dir, 'cordis.patch.yml'))) {
      return dir;
    }
  }
  throw new Error(
    `没找到可用的 profile 目录。\n` +
      `  已尝试：${candidates.join('\n          ')}\n` +
      `  请先启动一次 DSH 桌面版，让它生成 profile。`
  );
}

const PROFILE_DIR = findProfileDir();
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');
const PROFILE_LOCK = path.join(PROFILE_DIR, 'pnpm-lock.yaml');
const LINK = path.join(PROFILE_DIR, 'node_modules', PKG_NAME);
// JSON 里的本地依赖用正斜杠，避免反斜杠被当成转义
const FILE_SPEC = 'file:' + SELF_DIR.replace(/\\/g, '/');

// ── 小工具 ────────────────────────────────────────────────────────────────
/** 读 JSON。 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 写 JSON（UTF-8 不带 BOM）。 */
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8' });
}

/** 改动前先备份。 */
function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

/**
 * 查 node_modules 里本包的联接状态。
 * 用 lstatSync 判「存在」而不是 existsSync：联接指向的目标被删/改名时会悬空。
 */
function linkState() {
  let stat;
  try {
    stat = fs.lstatSync(LINK);
  } catch {
    return { exists: false };
  }
  let target = null;
  try {
    target = fs.realpathSync(LINK);
  } catch {
    target = null;
  }
  return { exists: true, isLink: stat.isSymbolicLink(), target, dangling: target === null };
}

/** 打印安装状态，并返回「是否已完整安装」。 */
function status() {
  const pkg = readJson(PROFILE_PKG);
  const dep = (pkg.dependencies || {})[PKG_NAME];
  const bundles = ((pkg.dsh || {}).profile || {}).bundles || [];
  const inBundles = bundles.includes(PKG_NAME);
  const link = linkState();

  console.log(`profile        : ${PROFILE_DIR}`);
  console.log(`包名           : ${PKG_NAME}@${PKG.version}`);
  console.log(`源码目录       : ${SELF_DIR}`);
  console.log(`依赖声明       : ${dep ?? '(未声明)'}`);
  console.log(`bundles 含本包 : ${inBundles ? '是' : '否'}`);
  if (!link.exists) console.log('node_modules   : 无联接');
  else if (link.dangling) console.log('node_modules   : ⚠️ 悬空联接（目标已不存在）');
  else console.log(`node_modules   : 联接 -> ${link.target}`);

  if (link.exists && !link.dangling) {
    const actual = path.resolve(link.target).toLowerCase();
    if (actual !== SELF_DIR.toLowerCase()) {
      console.log(`  ⚠️ 联接指向的不是本目录（应为 ${SELF_DIR}）`);
    }
  }

  const installed = Boolean(dep) && inBundles && link.exists && !link.dangling;
  console.log(`\n结论           : ${installed ? '✅ 已安装且已启用' : '未完整安装'}`);
  return installed;
}

/** 执行安装（幂等：已就绪的部分不会重复改动）。 */
function install() {
  const pkg = readJson(PROFILE_PKG);
  let changed = false;

  // ① 依赖声明
  pkg.dependencies = pkg.dependencies || {};
  if (pkg.dependencies[PKG_NAME] !== FILE_SPEC) {
    pkg.dependencies[PKG_NAME] = FILE_SPEC;
    changed = true;
  }

  // ② bundles —— 这才是「启用」的关键
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = pkg.dsh.profile.bundles || (pkg.dsh.profile.bundles = []);
  if (!bundles.includes(PKG_NAME)) {
    bundles.push(PKG_NAME);
    changed = true;
  }

  if (changed) {
    const b1 = backup(PROFILE_PKG);
    const b2 = backup(PROFILE_LOCK);
    console.log(`已备份 package.json  -> ${b1}`);
    if (b2) console.log(`已备份 pnpm-lock.yaml -> ${b2}`);
    writeJson(PROFILE_PKG, pkg);
    console.log('已更新 profile 的 package.json（dependencies + dsh.profile.bundles）');
  } else {
    console.log('profile 的 package.json 已是目标状态，未改动');
  }

  // ③ 目录联接（悬空的先清掉再重建）
  const link = linkState();
  if (link.exists && link.dangling) {
    fs.unlinkSync(LINK);
    console.log('已清理悬空的旧联接');
  }
  if (!linkState().exists) {
    fs.mkdirSync(path.dirname(LINK), { recursive: true });
    fs.symlinkSync(SELF_DIR, LINK, 'junction');
    console.log(`已建立目录联接：\n  ${LINK}\n    -> ${SELF_DIR}`);
  } else {
    console.log(`目录联接已存在：${LINK}`);
  }

  console.log('\n--- 安装后状态 ---');
  const ok = status();
  console.log('');
  if (ok) {
    console.log('✅ 安装完成。请【完全退出并重启 DSH】，左下角就会出现健康钟的小鸡图标 🐣。');
  } else {
    console.log('❌ 安装后状态仍不完整，请把上面的输出贴给 AI。');
    process.exitCode = 1;
  }
}

/** 卸载（只删联接本身，绝不动源码目录）。 */
function uninstall() {
  const pkg = readJson(PROFILE_PKG);
  let changed = false;

  if (pkg.dependencies && PKG_NAME in pkg.dependencies) {
    delete pkg.dependencies[PKG_NAME];
    changed = true;
  }
  const bundles = ((pkg.dsh || {}).profile || {}).bundles;
  if (Array.isArray(bundles)) {
    const index = bundles.indexOf(PKG_NAME);
    if (index >= 0) {
      bundles.splice(index, 1);
      changed = true;
    }
  }

  if (changed) {
    const b1 = backup(PROFILE_PKG);
    console.log(`已备份 package.json -> ${b1}`);
    writeJson(PROFILE_PKG, pkg);
    console.log('已从 profile 的 package.json 移除本包');
  } else {
    console.log('profile 的 package.json 里本来就没有本包');
  }

  if (linkState().exists) {
    fs.unlinkSync(LINK);
    console.log(`已删除目录联接（源码目录 ${SELF_DIR} 未受影响）`);
  } else {
    console.log('目录联接本来就不存在');
  }

  console.log('\n--- 卸载后状态 ---');
  status();
}

// ── 入口 ──────────────────────────────────────────────────────────────────
if (MODE === 'install') install();
else if (MODE === 'uninstall') uninstall();
else status();
