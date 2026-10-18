/**
 * 健康钟的纯状态机（没有任何 DSH / 浏览器依赖，方便直接用 Node 测试）。
 * ============================================================================
 *
 * 为什么把状态机单独拿出来：
 *   · 计时规则（工作 → 休息 → 完成 → 下一轮）属于「业务」，不该和 HTTP、弹窗混在一起；
 *   · 纯函数式的时间源（now 可注入）让测试能瞬间快进 45 分钟，不必真的等；
 *   · 宿主半边只负责「到点叫醒窗口」，客户端只负责「把状态画出来」。
 *
 * 时间原则（ADR-002）：只存 startedAt / deadline 两个绝对时刻，永远用 now 去减，
 * 不做「每秒减一」，睡眠 / 后台节流都不会累积误差。
 *
 * 计划库在 lib/plans.js（12 套详细计划，自带 12～15 分钟的时间线）。
 */

import { PLANS } from './plans.js';

/** 默认工作时长：45 分钟。 */
export const DEFAULT_WORK_MS = 45 * 60 * 1000;

/**
 * 建一个计时状态机。
 *
 * @param {object} [options]
 * @param {() => number} [options.now] 时间源，测试可注入假时钟。
 * @param {number} [options.workMs] 工作时长（毫秒）；之后可用 setWorkMs 动态改。
 * @param {(plan: object) => number} [options.restMsFor] 由计划算休息时长（毫秒）。
 * @param {object[]} [options.plans] 休息计划库。
 */
export function createClock(options = {}) {
  const now = options.now ?? (() => Date.now());
  let workMs = options.workMs ?? DEFAULT_WORK_MS;
  const plans = options.plans ?? PLANS;
  const restMsFor = options.restMsFor ?? ((plan) => plan.totalSeconds * 1000);

  let lastPlanId = null;
  let doneCount = 0;
  let skippedCount = 0;
  let state = makeWork(now());

  /** 新的一轮工作。doneCount / lastPlanId 要跨轮保留。 */
  function makeWork(t) {
    return {
      version: 3,
      phase: 'work',
      startedAt: t,
      deadline: t + workMs,
      workSeconds: Math.round(workMs / 1000),
      plan: null,
      restSeconds: 0,
      lastPlanId,
      doneCount,
      skipped: false
    };
  }

  /** 随机抽一个计划，尽量不和上一个重复。 */
  function pickPlan(excludeId) {
    const pool = plans.filter((plan) => plan.id !== excludeId);
    const source = pool.length > 0 ? pool : plans;
    return source[Math.floor(Math.random() * source.length)];
  }

  /** 进入休息。返回抽到的计划。 */
  function enterRest(t) {
    const plan = pickPlan(state.lastPlanId);
    const ms = Math.max(1000, Number(restMsFor(plan)) || 0);
    state = {
      version: 3,
      phase: 'rest',
      startedAt: t,
      deadline: t + ms,
      workSeconds: state.workSeconds,
      plan,
      restSeconds: Math.round(ms / 1000),
      lastPlanId: state.lastPlanId,
      doneCount,
      skipped: false
    };
    return plan;
  }

  /** 进入「休息结束」。skipped = 长按后门跳过的。 */
  function enterDone(t, skipped) {
    if (skipped) skippedCount += 1;
    else doneCount += 1;
    lastPlanId = state.plan?.id ?? lastPlanId;
    state = {
      version: 3,
      phase: 'done',
      startedAt: state.startedAt,
      deadline: state.deadline,
      workSeconds: state.workSeconds,
      plan: state.plan,
      restSeconds: state.restSeconds,
      lastPlanId,
      doneCount,
      skipped
    };
  }

  return {
    /**
     * 推进时钟。返回本次发生的事件，没发生就返回 null。
     * 调用方用返回值决定「要不要叫醒窗口 / 播声音」。
     */
    tick() {
      const t = now();
      if (state.phase === 'work' && t >= state.deadline) {
        const plan = enterRest(t);
        return { type: 'rest-start', plan };
      }
      if (state.phase === 'rest' && t >= state.deadline) {
        enterDone(t, false);
        return { type: 'rest-end' };
      }
      return null;
    },

    /** 给客户端 / 诊断接口的快照。 */
    snapshot() {
      return { ...state, now: now(), doneCount, skippedCount };
    },

    /** 修改工作时长：从下一轮工作开始生效（当前这一轮不打断）。 */
    setWorkMs(value) {
      const next = Number(value);
      if (Number.isFinite(next) && next >= 60_000) workMs = next;
    },

    /** 手动进入休息（「现在休息一下」按钮）。 */
    startRestNow() {
      if (state.phase !== 'work') return null;
      return enterRest(now());
    },

    /** 长按 3 秒的紧急跳过。 */
    skipRest() {
      if (state.phase !== 'rest') return false;
      enterDone(now(), true);
      return true;
    },

    /** 休息结束 → 开始下一轮。 */
    startNextRound() {
      if (state.phase !== 'done') return false;
      state = makeWork(now());
      return true;
    },

    /** 从头开始一轮（保留今日完成次数）。 */
    reset() {
      state = makeWork(now());
      return state;
    },

    get state() {
      return state;
    }
  };
}
