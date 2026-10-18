/**
 * DSH 健康钟插件 —— 宿主半边（Host half）
 * ============================================================================
 *
 * 职责：
 *   1. 计时（工作 → 休息 → 完成 → 下一轮），用绝对时刻，睡眠/后台节流都不怕；
 *   2. 到点用 PowerShell 把 DSH 窗口叫回前台（Win32 + UI Automation 点托盘图标）；
 *   3. 提供 HTTP API：状态、设置、计划库、休息控制；
 *   4. 把设置存到 ~/.dsh/storages/dsh-clock/settings.json。
 *
 * 浏览器半边（lib/client.js）只负责画界面、轮询状态、调这些接口。
 * 计划库在 lib/plans.js（12 套 12～15 分钟的详细计划）。
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock } from './clock-core.js';
import { PLANS } from './plans.js';

/** 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-clock';

/** API 前缀。避开 /api（DSH 在那上面挂了鉴权 fence）。 */
const API_PREFIX = '/dsh-clock/rpc';

/**
 * 开发模式开关：
 *   true  = 工作 2 分钟、休息 20 秒（方便反复测试）；
 *   false = 使用设置里的工作时长（默认 45 分钟）+ 计划自带的 12～15 分钟。
 * 第 7 轮验收通过后已切到 false。
 */
const DEV_MODE = false;
const DEV_WORK_MS = 2 * 60 * 1000;
const DEV_REST_MS = 20 * 1000;

/** 每 1 秒推进一次状态机。 */
const TICK_MS = 1000;

/** 插件目录（lib/index.js 的上一级）。 */
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 叫醒窗口的 PowerShell 脚本。 */
const WAKE_SCRIPT = path.join(PLUGIN_DIR, 'tools', 'wake-window.ps1');

/** Windows 自带 PowerShell 5.1 的绝对路径（纯 ASCII 脚本，5.1/7 都能跑）。 */
const POWERSHELL = (() => {
  const root = process.env.SystemRoot || process.env.windir;
  if (root) {
    const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'powershell.exe';
})();

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SETTINGS_FILE =
  process.env.DSH_CLOCK_SETTINGS_FILE || path.join(DSH_HOME, 'storages', 'dsh-clock', 'settings.json');

const DEFAULT_SETTINGS = Object.freeze({
  /** 工作时长（分钟）。 */
  workMinutes: 45,
  /** 休息时长：0 = 跟随计划（12～15 分钟）；否则固定分钟数，按比例缩放动作节奏。 */
  restMinutes: 0
});

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** 把任意输入规整成合法设置。 */
function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const restRaw = source.restMinutes;
  const followPlan = restRaw === 0 || restRaw === null || restRaw === undefined;
  return {
    workMinutes: clampInt(source.workMinutes, 5, 120, DEFAULT_SETTINGS.workMinutes),
    restMinutes: followPlan ? 0 : clampInt(restRaw, 5, 30, 12)
  };
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

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

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** 读请求体（最多 64 KB）。 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(badRequest('请求体太大'));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(badRequest('设置格式不对（需要 JSON）'));
      }
    });
    req.on('error', reject);
  });
}

/** 客户端用的状态 + 展示参数。 */
function describe(clock, settings) {
  const snapshot = clock.snapshot();
  return {
    ...snapshot,
    devMode: DEV_MODE,
    workSeconds:
      snapshot.workSeconds ?? (DEV_MODE ? DEV_WORK_MS / 1000 : settings.workMinutes * 60),
    settings
  };
}

/**
 * 宿主入口。
 * @param ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  let settings = loadSettings();
  let restOverrideSeconds = settings.restMinutes > 0 ? settings.restMinutes * 60 : null;

  const clock = createClock({
    workMs: DEV_MODE ? DEV_WORK_MS : settings.workMinutes * 60 * 1000,
    restMsFor: (plan) =>
      DEV_MODE ? DEV_REST_MS : (restOverrideSeconds ?? plan.totalSeconds) * 1000
  });

  /** 上一次叫醒窗口的时间，防止连发。 */
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
      { windowsHide: true, timeout: 12_000 },
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
    /** 一条路由 = 一个唯一路径 + 一个/多个方法（同一路径只能注册一次）。 */
    function route(suffix, methods, handle) {
      const allowed = Array.isArray(methods) ? methods : [methods];
      return {
        kind: 'exact',
        path: `${API_PREFIX}${suffix}`,
        handler: async (req, res) => {
          const actual = req.method ?? 'GET';
          if (actual === 'OPTIONS') {
            res.writeHead(204, { allow: `${allowed.join(',')},OPTIONS` });
            res.end();
            return;
          }
          if (!allowed.includes(actual)) {
            sendJson(res, 405, { ok: false, error: `${suffix} 只接受 ${allowed.join(' / ')}` });
            return;
          }
          try {
            sendJson(res, 200, await handle(req, actual));
          } catch (error) {
            sendJson(res, Number(error?.statusCode) || 500, {
              ok: false,
              error: String(error?.message ?? error)
            });
          }
        }
      };
    }

    const routes = [
      route('/state', 'GET', () => ({ ok: true, state: describe(clock, settings) })),
      route('/plans', 'GET', () => ({ ok: true, plans: PLANS })),
      route('/settings', ['GET', 'PUT'], async (req, method) => {
        if (method === 'GET') return { ok: true, settings };
        const next = normalizeSettings(await readJsonBody(req));
        settings = next;
        restOverrideSeconds = next.restMinutes > 0 ? next.restMinutes * 60 : null;
        if (!DEV_MODE) clock.setWorkMs(next.workMinutes * 60 * 1000);
        saveSettings(settings);
        return { ok: true, settings, state: describe(clock, settings) };
      }),
      route('/rest', 'POST', () => {
        const plan = clock.startRestNow();
        if (plan) wake('manual-rest');
        return { ok: Boolean(plan), state: describe(clock, settings) };
      }),
      route('/skip', 'POST', () => ({ ok: clock.skipRest(), state: describe(clock, settings) })),
      route('/next', 'POST', () => ({ ok: clock.startNextRound(), state: describe(clock, settings) })),
      route('/reset', 'POST', () => {
        clock.reset();
        return { ok: true, state: describe(clock, settings) };
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
      `[${name}] 宿主就绪：工作 ${settings.workMinutes} 分钟，设置 ${SETTINGS_FILE}${DEV_MODE ? '（测试模式）' : ''}`
    );
  });

  ctx.logger?.info?.(
    `[${name}] 宿主计时已启动（${DEV_MODE ? '测试模式' : `${settings.workMinutes} 分钟`}）`
  );
}
