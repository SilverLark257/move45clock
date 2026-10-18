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
 */

/** 休息计划库：每个计划自带 Emoji、任务、说明和建议休息时长（10～15 分钟）。 */
export const PLANS = [
  { id: 'squat', emoji: '🦵', title: '深蹲', detail: '15 个 × 4 组，站起来慢慢蹲', restMinutes: 15 },
  { id: 'tiptoe', emoji: '🦶', title: '踮脚尖', detail: '30 下 × 3 组，扶着桌沿也行', restMinutes: 10 },
  { id: 'flamingo', emoji: '🦩', title: '金鸡独立', detail: '左右脚各站 1 分钟 × 3 轮', restMinutes: 10 },
  { id: 'jumping-jack', emoji: '🤸', title: '开合跳', detail: '50 个 × 2 组，轻一点别吵到邻居', restMinutes: 12 },
  { id: 'chest', emoji: '💪', title: '扩胸运动', detail: '20 下 × 3 组，把肩膀打开', restMinutes: 10 },
  { id: 'neck', emoji: '🧘', title: '肩颈绕环', detail: '向前 10 圈、向后 10 圈，慢慢来', restMinutes: 10 },
  { id: 'wall-sit', emoji: '🧱', title: '靠墙静蹲', detail: '后背贴墙蹲 1 分钟 × 3 次', restMinutes: 13 },
  { id: 'high-knees', emoji: '🏃', title: '高抬腿', detail: '原地高抬腿 30 秒 × 4 组', restMinutes: 12 },
  { id: 'lunge', emoji: '🏋️', title: '弓步蹲', detail: '左右各 12 个 × 3 组', restMinutes: 14 },
  { id: 'glute-bridge', emoji: '🌉', title: '臀桥', detail: '躺下抬胯 15 个 × 3 组', restMinutes: 12 },
  { id: 'wrist', emoji: '🙌', title: '手腕手指操', detail: '手腕绕环 + 手指伸展各 1 分钟', restMinutes: 10 },
  { id: 'march', emoji: '🚶', title: '原地踏步', detail: '原地踏步 3 分钟，顺便倒杯水', restMinutes: 10 },
  { id: 'eyes', emoji: '👀', title: '远眺放松', detail: '看 6 米外 20 秒 × 5 次，眨眨眼', restMinutes: 10 }
];

/** 默认工作时长：45 分钟。 */
export const DEFAULT_WORK_MS = 45 * 60 * 1000;

/**
 * 建一个计时状态机。
 *
 * @param {object} [options]
 * @param {() => number} [options.now] 时间源，测试可注入假时钟。
 * @param {number} [options.workMs] 工作时长（毫秒）。
 * @param {(plan: object) => number} [options.restMsFor] 由计划算休息时长（毫秒）。
 * @param {object[]} [options.plans] 休息计划库。
 */
export function createClock(options = {}) {
  const now = options.now ?? (() => Date.now());
  const workMs = options.workMs ?? DEFAULT_WORK_MS;
  const plans = options.plans ?? PLANS;
  const restMsFor = options.restMsFor ?? ((plan) => plan.restMinutes * 60 * 1000);

  let lastPlanId = null;
  let doneCount = 0;
  let skippedCount = 0;
  let state = makeWork(now());

  /** 新的一轮工作。doneCount / lastPlanId 要跨轮保留。 */
  function makeWork(t) {
    return {
      version: 2,
      phase: 'work',
      startedAt: t,
      deadline: t + workMs,
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
      version: 2,
      phase: 'rest',
      startedAt: t,
      deadline: t + ms,
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
      version: 2,
      phase: 'done',
      startedAt: state.startedAt,
      deadline: state.deadline,
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
