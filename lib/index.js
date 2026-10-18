/**
 * DSH 健康钟插件 —— 宿主半边（Host half）
 * ============================================================================
 *
 * 职责：
 *   1. 计时（工作 → 休息 → 完成 → 下一轮），用绝对时刻，睡眠/后台节流都不怕；
 *   2. 到点用 PowerShell 把 DSH 窗口叫回前台（Win32 + UI Automation 点托盘图标）；
 *   3. 提供 HTTP API：状态、设置、计划库（含用户改/加的计划）、休息控制、夜间提醒；
 *   4. 把设置存到 ~/.dsh/storages/dsh-clock/settings.json，用户计划存到 plans.json，
 *      夜间提醒的"今天弹过哪条"存到 night.json。
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
import { NIGHT_SLOTS, pickDueNightSlot, localDayKey } from './night.js';
import { PLANS, normalizeUserPlan } from './plans.js';

/** 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-move45clock';

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
const PLANS_FILE =
  process.env.DSH_CLOCK_PLANS_FILE || path.join(DSH_HOME, 'storages', 'dsh-clock', 'plans.json');
const NIGHT_FILE =
  process.env.DSH_CLOCK_NIGHT_FILE || path.join(DSH_HOME, 'storages', 'dsh-clock', 'night.json');

const BUILTIN_IDS = new Set(PLANS.map((plan) => plan.id));

const DEFAULT_SETTINGS = Object.freeze({
  /** 工作时长（分钟）。 */
  workMinutes: 45,
  /** 休息时长：0 = 跟随计划（12～15 分钟）；否则固定分钟数，按比例缩放动作节奏。 */
  restMinutes: 0,
  /** 弹窗整体缩放：1 = 标准，2 = 两倍；1.5 = 默认的大字模式。 */
  cardScale: 1.5,
  /** 夜间提醒（21:30 / 22:00 / 22:30）开关。 */
  nightEnabled: true
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
  const scaleRaw = Number(source.cardScale);
  return {
    workMinutes: clampInt(source.workMinutes, 5, 120, DEFAULT_SETTINGS.workMinutes),
    restMinutes: followPlan ? 0 : clampInt(restRaw, 5, 30, 12),
    cardScale: Number.isFinite(scaleRaw)
      ? Math.min(2, Math.max(1, Math.round(scaleRaw * 100) / 100))
      : DEFAULT_SETTINGS.cardScale,
    nightEnabled:
      source.nightEnabled === undefined
        ? DEFAULT_SETTINGS.nightEnabled
        : Boolean(source.nightEnabled)
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

// ── 计划库（内置 12 套 + 用户在设置页改/加的计划）──────────────────────────
// 存储结构：
//   { version: 1,
//     overrides: { <内置 id>: 改过的完整计划 },
//     custom:    [ 用户新建的完整计划 ],
//     disabled:  [ 不参与随机抽取的计划 id ] }
// 内置计划本身永远留在 lib/plans.js，plans.json 只存"改动"和"新增"。

function emptyLibrary() {
  return { version: 1, overrides: {}, custom: [], disabled: [] };
}

function loadLibrary() {
  try {
    const raw = JSON.parse(readFileSync(PLANS_FILE, 'utf8'));
    const overrides = {};
    for (const [id, plan] of Object.entries(raw?.overrides ?? {})) {
      if (!BUILTIN_IDS.has(id)) continue;
      try {
        overrides[id] = normalizeUserPlan({ ...plan, id }, { knownIds: [...BUILTIN_IDS] });
      } catch {
        /* 单条坏数据跳过，不拖累其它计划 */
      }
    }

    const custom = [];
    const seen = new Set();
    for (const plan of Array.isArray(raw?.custom) ? raw.custom : []) {
      if (!plan?.id || BUILTIN_IDS.has(plan.id) || seen.has(plan.id)) continue;
      try {
        const normalized = normalizeUserPlan(plan, {
          allowGenerateId: false,
          knownIds: [...BUILTIN_IDS, ...seen]
        });
        custom.push(normalized);
        seen.add(normalized.id);
      } catch {
        /* 同上 */
      }
    }

    const disabled = Array.isArray(raw?.disabled)
      ? raw.disabled.filter((id) => BUILTIN_IDS.has(id) || seen.has(id))
      : [];
    return { version: 1, overrides, custom, disabled: [...new Set(disabled)] };
  } catch {
    return emptyLibrary();
  }
}

function saveLibrary(library) {
  mkdirSync(path.dirname(PLANS_FILE), { recursive: true });
  writeFileSync(PLANS_FILE, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
}

/** 内置 + 覆盖 + 自定义，并带上「内置/改过/已停用」标记给设置页用。 */
function buildPlanList(library) {
  const disabled = new Set(library.disabled);
  const list = PLANS.map((builtin) => {
    const override = library.overrides[builtin.id];
    return {
      ...(override ?? builtin),
      builtin: true,
      overridden: Boolean(override),
      disabled: disabled.has(builtin.id)
    };
  });
  for (const plan of library.custom) {
    list.push({ ...plan, builtin: false, overridden: false, disabled: disabled.has(plan.id) });
  }
  return list;
}

/** 计时器只拿启用的计划；万一全停用了，就退回全部（避免抽不到计划）。 */
function enabledPlanList(list) {
  const enabled = list.filter((plan) => !plan.disabled);
  return enabled.length > 0 ? enabled : list.map((plan) => ({ ...plan, disabled: false }));
}

// ── 夜间提醒状态（night.json）──────────────────────────────────────────────
// { date: '2026-10-18', shown: ['21:30', '22:00'] }
// 同一天弹过的不会重复；换一天自动清空。

function loadNightState() {
  try {
    const raw = JSON.parse(readFileSync(NIGHT_FILE, 'utf8'));
    return {
      date: typeof raw?.date === 'string' ? raw.date : null,
      shown: Array.isArray(raw?.shown)
        ? raw.shown.filter((id) => NIGHT_SLOTS.some((slot) => slot.id === id))
        : []
    };
  } catch {
    return { date: null, shown: [] };
  }
}

function saveNightState(state) {
  mkdirSync(path.dirname(NIGHT_FILE), { recursive: true });
  writeFileSync(NIGHT_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** 测试可注入时间：DSH_CLOCK_NIGHT_NOW=2026-10-18T21:45:00+08:00。 */
function currentNightDate() {
  const override = process.env.DSH_CLOCK_NIGHT_NOW;
  if (override) {
    const date = new Date(override);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

/** 客户端用的状态 + 展示参数。 */
function describe(clock, settings, night = null) {
  const snapshot = clock.snapshot();
  return {
    ...snapshot,
    devMode: DEV_MODE,
    workSeconds:
      snapshot.workSeconds ?? (DEV_MODE ? DEV_WORK_MS / 1000 : settings.workMinutes * 60),
    settings,
    night: night ? { active: true, slot: night } : { active: false }
  };
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

/**
 * 宿主入口。
 * @param ctx - 宿主 cordis 上下文
 */
export function apply(ctx) {
  let settings = loadSettings();
  let restOverrideSeconds = settings.restMinutes > 0 ? settings.restMinutes * 60 : null;

  let library = loadLibrary();
  let planList = buildPlanList(library);
  let nightState = loadNightState();
  let activeNight = null;

  const clock = createClock({
    workMs: DEV_MODE ? DEV_WORK_MS : settings.workMinutes * 60 * 1000,
    plans: enabledPlanList(planList),
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
    // 测试用：不真的启动 PowerShell（不影响计时和状态）。
    if (process.env.DSH_CLOCK_NO_WAKE === '1') return;
    if (process.platform !== 'win32') return;
    const t = Date.now();
    if (t - lastWakeAt < 2500) return;
    lastWakeAt = t;

    if (!existsSync(WAKE_SCRIPT)) {
      ctx.logger?.warn?.(`[${name}] 找不到唤醒脚本：${WAKE_SCRIPT}`);
      return;
    }

    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      WAKE_SCRIPT
    ];
    // 夜间提醒不响系统 "叮"，保持安静。
    if (reason === 'night') args.push('-Quiet');

    execFile(
      POWERSHELL,
      args,
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

  /** 每秒检查一次：到 21:30 / 22:00 / 22:30 且今天这条还没弹过，就激活夜间卡片。 */
  function checkNight() {
    if (!settings.nightEnabled || activeNight) return;
    const now = currentNightDate();
    const day = localDayKey(now);
    const state = nightState.date === day ? nightState : { date: day, shown: [] };
    const due = pickDueNightSlot(now, state.shown);
    if (!due) {
      nightState = state;
      return;
    }
    nightState = { date: day, shown: due.shown };
    saveNightState(nightState);
    activeNight = due.slot;
    wake('night');
  }

  // ── 计时循环 ──────────────────────────────────────────────────────────────
  const timer = setInterval(() => {
    const event = clock.tick();
    if (event?.type === 'rest-start') {
      wake('deadline');
    }
    checkNight();
  }, TICK_MS);

  // 启动时也检查一次：如果 DSH 是 22:10 才打开的，补一条最近的 22:00。
  checkNight();

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
      route('/state', 'GET', () => ({ ok: true, state: describe(clock, settings, activeNight) })),
      route('/plans', ['GET', 'POST'], async (req, method) => {
        if (method === 'GET') {
          return {
            ok: true,
            plans: planList,
            builtinCount: PLANS.length,
            customCount: library.custom.length
          };
        }

        const body = await readJsonBody(req);
        const op = String(body?.op ?? 'save');
        const id = String(body?.id ?? '');

        const commit = () => {
          saveLibrary(library);
          planList = buildPlanList(library);
          clock.setPlans(enabledPlanList(planList));
        };

        if (op === 'save') {
          const normalized = normalizeUserPlan(body?.plan, {
            knownIds: planList.map((plan) => plan.id)
          });
          if (BUILTIN_IDS.has(normalized.id)) {
            library.overrides[normalized.id] = normalized;
          } else {
            const index = library.custom.findIndex((plan) => plan.id === normalized.id);
            if (index >= 0) library.custom[index] = normalized;
            else library.custom.push(normalized);
          }
          commit();
          return { ok: true, plans: planList, saved: normalized };
        }

        if (op === 'delete') {
          if (BUILTIN_IDS.has(id)) {
            throw badRequest('内置计划不能删除；可以「停用」或「恢复默认」');
          }
          const index = library.custom.findIndex((plan) => plan.id === id);
          if (index < 0) throw badRequest('找不到这套计划');
          library.custom.splice(index, 1);
          library.disabled = library.disabled.filter((item) => item !== id);
          commit();
          return { ok: true, plans: planList };
        }

        if (op === 'disable' || op === 'enable') {
          if (!planList.some((plan) => plan.id === id)) throw badRequest('找不到这套计划');
          if (op === 'disable') {
            const enabledCount = planList.filter((plan) => !plan.disabled).length;
            if (enabledCount <= 1) throw badRequest('至少要保留 1 套启用的计划');
            if (!library.disabled.includes(id)) library.disabled.push(id);
          } else {
            library.disabled = library.disabled.filter((item) => item !== id);
          }
          commit();
          return { ok: true, plans: planList };
        }

        if (op === 'restore') {
          if (!BUILTIN_IDS.has(id)) throw badRequest('只有内置计划可以恢复默认');
          delete library.overrides[id];
          library.disabled = library.disabled.filter((item) => item !== id);
          commit();
          return { ok: true, plans: planList };
        }

        if (op === 'reset-all') {
          library = emptyLibrary();
          commit();
          return { ok: true, plans: planList };
        }

        throw badRequest('未知的计划操作');
      }),
      route('/settings', ['GET', 'PUT'], async (req, method) => {
        if (method === 'GET') return { ok: true, settings };
        const patch = await readJsonBody(req);
        settings = normalizeSettings({ ...settings, ...patch });
        restOverrideSeconds = settings.restMinutes > 0 ? settings.restMinutes * 60 : null;
        if (!settings.nightEnabled) activeNight = null;
        if (!DEV_MODE) clock.setWorkMs(settings.workMinutes * 60 * 1000);
        saveSettings(settings);
        return { ok: true, settings, state: describe(clock, settings, activeNight) };
      }),
      route('/rest', 'POST', async (req) => {
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        const plan = clock.startRestNow(body?.planId);
        if (plan) wake('manual-rest');
        let error;
        if (!plan) {
          const target = body?.planId
            ? planList.find((item) => item.id === body.planId)
            : null;
          if (body?.planId && !target) error = '找不到这套计划（可能已删除）';
          else if (target?.disabled) error = '这套计划已停用，先在设置里启用';
          else error = '现在不是工作阶段（可能正在休息）';
        }
        return {
          ok: Boolean(plan),
          error,
          state: describe(clock, settings, activeNight)
        };
      }),
      route('/skip', 'POST', () => ({ ok: clock.skipRest(), state: describe(clock, settings, activeNight) })),
      route('/next', 'POST', () => ({ ok: clock.startNextRound(), state: describe(clock, settings, activeNight) })),
      route('/reset', 'POST', () => {
        clock.reset();
        return { ok: true, state: describe(clock, settings, activeNight) };
      }),
      route('/night', 'POST', async (req) => {
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        const action = String(body?.action ?? 'dismiss');

        if (action === 'preview') {
          const slot =
            NIGHT_SLOTS.find((item) => item.id === body?.slotId) ?? NIGHT_SLOTS[0];
          activeNight = slot;
          return { ok: true, state: describe(clock, settings, activeNight) };
        }

        if (action === 'dismiss') {
          activeNight = null;
          return { ok: true, state: describe(clock, settings, activeNight) };
        }

        throw badRequest('未知的夜间提醒操作');
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
      `[${name}] 宿主就绪：工作 ${settings.workMinutes} 分钟，计划 ${planList.length} 套` +
        `（内置 ${PLANS.length}，我的 ${library.custom.length}），夜间提醒 21:30 / 22:00 / 22:30` +
        `（${settings.nightEnabled ? '开' : '关'}），设置 ${SETTINGS_FILE}${DEV_MODE ? '（测试模式）' : ''}`
    );
  });

  ctx.logger?.info?.(
    `[${name}] 宿主计时已启动（${DEV_MODE ? '测试模式' : `${settings.workMinutes} 分钟`}）`
  );
}
