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
 * 计划库在 lib/plans.js（22 套详细计划：12 套运动，各自带 12～15 分钟的时间线，
 * 4 套家务休闲 + 6 套 3～5 分钟短运动）。v1.7.0 起状态机还负责「按模式选计划」和
 * 「短短短长」周期（3 次短休息后跟 1 次长休息）。
 */

import { PLANS, PLAN_MODES, planKind } from './plans.js';

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
 * @param {string} [options.planMode] 计划模式：'exercise' / 'mixed' / 'short-long'，默认 'mixed'。
 */
export function createClock(options = {}) {
  const now = options.now ?? (() => Date.now());
  let workMs = options.workMs ?? DEFAULT_WORK_MS;
  let plans =
    Array.isArray(options.plans) && options.plans.length > 0 ? options.plans : PLANS;
  const restMsFor = options.restMsFor ?? ((plan) => plan.totalSeconds * 1000);
  // 模式决定从哪些计划里抽；非法值当老行为 mixed 处理（宿主会传设置里的值）。
  let planMode = PLAN_MODES.includes(options.planMode) ? options.planMode : 'mixed';

  let lastPlanId = null;
  let doneCount = 0;
  let skippedCount = 0;
  /** 短短短长：自上次长休息后已经过（完成或跳过）的短休息数，0～3。 */
  let shortStreak = 0;
  let state = makeWork(now());

  /** 新的一轮工作。doneCount / lastPlanId / shortStreak 要跨轮保留。 */
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
      skipped: false,
      breakKind: null,
      cycleCounted: false
    };
  }

  /** 这种模式 / 这个周期位置，下一次休息该是哪一类（客户端显示用）。 */
  function nextBreakKind() {
    if (planMode !== 'short-long') return 'normal';
    return shortStreak >= 3 ? 'long' : 'short';
  }

  /**
   * 按模式抽一个计划，尽量不和上一个重复。
   * 返回 { plan, breakKind }；计划库为空才返回 null。
   * 分类池空时先退回「排除上一个」的任意计划，再退回全部计划——用户把某一类
   * 全停用/删掉时也不能抽不到计划（否则到点就卡住了）。
   */
  function pickPlan(excludeId) {
    let pool;
    let breakKind;
    if (planMode === 'short-long') {
      const wantKind = shortStreak >= 3 ? 'exercise' : 'short';
      breakKind = shortStreak >= 3 ? 'long' : 'short';
      pool = plans.filter((plan) => planKind(plan) === wantKind);
    } else if (planMode === 'exercise') {
      pool = plans.filter((plan) => planKind(plan) === 'exercise');
      breakKind = 'normal';
    } else {
      // mixed：运动 + 家务休闲，不含短运动（短运动只在短短短长里用）。
      pool = plans.filter((plan) => planKind(plan) !== 'short');
      breakKind = 'normal';
    }

    const take = (source) => {
      const filtered = excludeId ? source.filter((plan) => plan.id !== excludeId) : source;
      const usable = filtered.length > 0 ? filtered : source;
      if (usable.length === 0) return null;
      return usable[Math.floor(Math.random() * usable.length)];
    };

    const plan = take(pool) ?? take(plans);
    return plan ? { plan, breakKind } : null;
  }

  /** 进入休息。planId 指定时用那套（设置页「试做这套」），否则按模式随机抽。 */
  function enterRest(t, planId) {
    let plan;
    let breakKind;
    let cycleCounted;
    const explicit = planId ? plans.find((item) => item.id === planId) : null;
    if (explicit) {
      // 「试做」不算周期：只是先看看这套动作，不推进短短短长的节奏。
      plan = explicit;
      breakKind =
        planMode === 'short-long'
          ? planKind(plan) === 'short'
            ? 'short'
            : 'long'
          : 'normal';
      cycleCounted = false;
    } else {
      const picked = pickPlan(state.lastPlanId);
      if (!picked) return null;
      plan = picked.plan;
      breakKind = picked.breakKind;
      cycleCounted = planMode === 'short-long';
    }
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
      skipped: false,
      breakKind,
      cycleCounted
    };
    return plan;
  }

  /** 进入「休息结束」。skipped = 长按后门跳过的。 */
  function enterDone(t, skipped) {
    // 先推进周期再切 done：跳过也推进，这样「3 短 1 长」的节奏稳定、可预期。
    if (state.cycleCounted) {
      shortStreak = state.breakKind === 'long' ? 0 : Math.min(3, shortStreak + 1);
    }
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
      skipped,
      breakKind: state.breakKind ?? null,
      cycleCounted: state.cycleCounted
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
        if (!plan) return null;
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
      return {
        ...state,
        planMode,
        shortStreak,
        nextBreakKind: nextBreakKind(),
        now: now(),
        doneCount,
        skippedCount
      };
    },

    /** 修改工作时长：从下一轮工作开始生效（当前这一轮不打断）。 */
    setWorkMs(value) {
      const next = Number(value);
      if (Number.isFinite(next) && next >= 60_000) workMs = next;
    },

    /**
     * 切换计划模式（设置页保存时由宿主调用）。
     * 从非短短短长切进来时周期归零，免得带着 mixed/exercise 时代残留的 shortStreak 开局。
     * @returns {boolean} 模式是否合法、是否生效
     */
    setPlanMode(mode) {
      if (!PLAN_MODES.includes(mode)) return false;
      if (mode === 'short-long' && planMode !== 'short-long') shortStreak = 0;
      planMode = mode;
      return true;
    },

    /** 换一套计划库（设置页增删改计划后由宿主调用）。空数组会被忽略，避免抽不到计划。 */
    setPlans(next) {
      if (Array.isArray(next) && next.length > 0) plans = next;
    },

    /** 手动进入休息（「现在休息一下」按钮；可指定计划）。 */
    startRestNow(planId) {
      if (state.phase !== 'work') return null;
      if (planId && !plans.some((plan) => plan.id === planId)) return null;
      return enterRest(now(), planId);
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

    /** 从头开始一轮（保留今日完成次数；短短短长周期归零）。 */
    reset() {
      shortStreak = 0;
      state = makeWork(now());
      return state;
    },

    /**
     * 恢复之前保存的状态（宿主重启时用）。
     * 只做形状校验，不判断“是不是同一天 / 过没过期”——那是宿主的事。
     * @returns {boolean} 是否恢复成功
     */
    restore(saved) {
      if (!saved || typeof saved !== 'object') return false;
      const phase = saved.phase;
      if (phase !== 'work' && phase !== 'rest' && phase !== 'done') return false;
      const startedAt = Number(saved.startedAt);
      const deadline = Number(saved.deadline);
      if (!Number.isFinite(startedAt) || !Number.isFinite(deadline)) return false;

      const plan = phase === 'work' ? null : saved.plan;
      if (phase !== 'work') {
        if (!plan || typeof plan !== 'object' || !plan.id) return false;
        if (!Number.isFinite(Number(plan.totalSeconds))) return false;
      }

      const done = Number(saved.doneCount);
      const restSeconds =
        phase === 'work' ? 0 : Math.max(1, Math.round(Number(saved.restSeconds) || 0));

      // v1.7.0 新字段：老快照（v1.6.0 及以前）没有这些，按缺省值补上，别让恢复失败。
      const streakRaw = Math.round(Number(saved.shortStreak));
      shortStreak = Number.isFinite(streakRaw) ? Math.min(3, Math.max(0, streakRaw)) : 0;
      const savedKind =
        saved.breakKind === 'short' || saved.breakKind === 'long' || saved.breakKind === 'normal'
          ? saved.breakKind
          : null;
      // 没存 breakKind 就按计划分类推：短运动计划算短休息，其它算长休息；
      // 不在短短短长模式下的老快照按 normal（v1.6.0 的行为）。
      let breakKind = null;
      if (phase !== 'work') {
        breakKind =
          savedKind ??
          (planMode === 'short-long'
            ? planKind(plan) === 'short'
              ? 'short'
              : 'long'
            : 'normal');
      }
      const cycleCounted = Boolean(saved.cycleCounted);

      state = {
        version: 3,
        phase,
        startedAt,
        deadline,
        workSeconds: Math.max(1, Math.round(Number(saved.workSeconds) || workMs / 1000)),
        plan,
        restSeconds,
        lastPlanId: saved.lastPlanId ?? plan?.id ?? null,
        doneCount: Number.isFinite(done) ? Math.max(0, Math.round(done)) : 0,
        skipped: Boolean(saved.skipped),
        breakKind,
        cycleCounted
      };
      doneCount = state.doneCount;
      lastPlanId = state.lastPlanId;
      skippedCount = 0;
      return true;
    },

    /** 当前状态（带上 planMode / shortStreak，跟 snapshot 的字段保持一致）。 */
    get state() {
      return { ...state, planMode, shortStreak };
    }
  };
}
