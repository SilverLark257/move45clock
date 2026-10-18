/**
 * DSH 健康钟插件 —— 宿主半边（Host half）
 * ============================================================================
 *
 * 第 3 轮改判（最重要的一次）：
 *   原来计时放在浏览器里。只要 DSH 被最小化到托盘，浏览器定时器会被 Chromium
 *   节流，而且弹窗画在隐藏的窗口里，人根本看不见 —— 这就是「完全没有弹窗」。
 *
 *   现在计时搬到宿主进程（Node 侧，不随窗口隐藏而停），到点由宿主：
 *     1. 把状态切成「休息」；
 *     2. 调 tools/wake-window.ps1 把 DSH 窗口从托盘 / 最小化状态叫回前台；
 *     3. 客户端（浏览器半边）恢复可见后立刻拉一次状态，把休息卡片画出来。
 *
 *   宿主只做三件事：计时、切状态、叫醒窗口。UI 全部在 lib/client.js。
 *
 * 两半之间怎么通话（照本机已验证的 work-diary / dshmarket 做法）：
 *   · 宿主用 ctx.webServer.register({ kind: 'exact', path, handler }) 挂 HTTP 路由；
 *   · 浏览器用 fetch('/dsh-clock/rpc/...') 直接请求；
 *   · 不用 host.call —— 静态安装的插件拿不到动态插件那套通道（work-diary 实测结论）。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock, PLANS } from './clock-core.js';

/** 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-clock';

/** API 前缀。刻意避开 /api（DSH 在那上面挂了鉴权 fence，exact 路由也最好别往里凑）。 */
const API_PREFIX = '/dsh-clock/rpc';

/**
 * 开发模式开关：
 *   true  = 工作 2 分钟、休息 20 秒（方便反复测试）；
 *   false = 正式 45 分钟 + 计划自带的 10～15 分钟。
 * 第 7 轮验收通过后已切到 false。下次要测试时改回 true，并完全重启 DSH。
 */
const DEV_MODE = false;
const WORK_MS = (DEV_MODE ? 2 * 60 : 45 * 60) * 1000;
const DEV_REST_MS = 20 * 1000;

/** 每 1 秒推进一次状态机（只做比较，不累加，睡眠醒来也能立刻发现超时）。 */
const TICK_MS = 1000;

/** 插件目录（lib/index.js 的上一级）。 */
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 叫醒窗口的 PowerShell 脚本。 */
const WAKE_SCRIPT = path.join(PLUGIN_DIR, 'tools', 'wake-window.ps1');

/**
 * Windows 自带 PowerShell 5.1 的绝对路径。
 * 用绝对路径 + 纯 ASCII 脚本，避免 PATH / 编码（AGENTS.md 里踩过的坑）。
 */
const POWERSHELL = (() => {
  const root = process.env.SystemRoot || process.env.windir;
  if (root) {
    const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'powershell.exe';
})();

/** 写 JSON 响应。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body))
  });
  res.end(body);
}

/** 客户端需要知道的两个「展示用」参数：是不是测试模式、一轮多少秒。 */
function describe(clock) {
  return {
    ...clock.snapshot(),
    devMode: DEV_MODE,
    workSeconds: Math.round(WORK_MS / 1000)
  };
}

/**
 * 宿主入口。
 * @param ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  const clock = createClock({
    workMs: WORK_MS,
    restMsFor: (plan) => (DEV_MODE ? DEV_REST_MS : plan.restMinutes * 60 * 1000)
  });

  /** 上一次叫醒窗口的时间，防止「到点 + 手动测试」连发两次。 */
  let lastWakeAt = 0;

  /**
   * 把 DSH 窗口从托盘 / 最小化里叫回来。
   * 失败只记日志：叫不醒也不能影响计时和状态切换。
   */
  function wake(reason) {
    if (process.platform !== 'win32') return;
    const t = Date.now();
    if (t - lastWakeAt < 2500) return;
    lastWakeAt = t;

    if (!existsSync(WAKE_SCRIPT)) {
      ctx.logger?.warn?.(`[${name}] 找不到唤醒脚本：${WAKE_SCRIPT}`);
      return;
    }

    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WAKE_SCRIPT],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error) {
          ctx.logger?.warn?.(
            `[${name}] 唤醒窗口失败（${reason}）：${error.message} ${String(stderr ?? '').trim()}`
          );
          return;
        }
        ctx.logger?.info?.(`[${name}] 唤醒窗口（${reason}）：${String(stdout ?? '').trim()}`);
      }
    );
  }

  // ── 计时循环 ──────────────────────────────────────────────────────────────
  const timer = setInterval(() => {
    const event = clock.tick();
    if (event?.type === 'rest-start') {
      // 到点了：先把窗口叫回来，客户端恢复可见后会立刻拉状态并画出卡片。
      wake('deadline');
    }
  }, TICK_MS);

  ctx.effect(
    () => () => {
      clearInterval(timer);
    },
    'dsh-clock: 计时循环'
  );

  // ── HTTP 路由 ─────────────────────────────────────────────────────────────
  ctx.inject(['webServer'], (scoped) => {
    /** 一条路由 = 一个唯一路径 + 一个方法。 */
    function route(suffix, method, handle) {
      return {
        kind: 'exact',
        path: `${API_PREFIX}${suffix}`,
        handler: async (req, res) => {
          const actual = req.method ?? 'GET';
          if (actual === 'OPTIONS') {
            res.writeHead(204, { allow: `${method},OPTIONS` });
            res.end();
            return;
          }
          if (actual !== method) {
            sendJson(res, 405, { ok: false, error: `${suffix} 只接受 ${method}` });
            return;
          }
          try {
            sendJson(res, 200, handle());
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
          }
        }
      };
    }

    const routes = [
      route('/state', 'GET', () => ({ ok: true, state: describe(clock) })),
      route('/plans', 'GET', () => ({ ok: true, plans: PLANS })),
      route('/rest', 'POST', () => {
        const plan = clock.startRestNow();
        if (plan) wake('manual-rest');
        return { ok: Boolean(plan), state: describe(clock) };
      }),
      route('/skip', 'POST', () => ({ ok: clock.skipRest(), state: describe(clock) })),
      route('/next', 'POST', () => ({ ok: clock.startNextRound(), state: describe(clock) })),
      route('/reset', 'POST', () => {
        clock.reset();
        return { ok: true, state: describe(clock) };
      }),
      route('/wake', 'POST', () => {
        wake('manual');
        return { ok: true };
      })
    ];

    scoped.effect(
      () => {
        const disposers = routes.map((item) => scoped.webServer.register(item));
        return () => {
          for (const dispose of disposers) {
            try {
              dispose();
            } catch {
              /* 撤路由失败不该阻断卸载 */
            }
          }
        };
      },
      'dsh-clock: API 路由'
    );

    scoped.logger?.info?.(
      `[${name}] 宿主就绪：工作 ${WORK_MS / 1000}s，API ${API_PREFIX}${DEV_MODE ? '（测试模式）' : ''}`
    );
  });

  ctx.logger?.info?.(`[${name}] 宿主计时已启动（${DEV_MODE ? '测试模式 2 分钟' : '正式 45 分钟'}）`);
}
