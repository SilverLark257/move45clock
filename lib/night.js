/**
 * 夜间提醒：21:30 / 22:00 / 22:30 三个时间点的文案与调度。
 * ============================================================================
 *
 * 只做纯逻辑：给定"现在几点"和"今天已经弹过哪些"，算出该不该弹、弹哪一条。
 * 宿主每秒调用一次；文件持久化由宿主负责（night.json）。
 *
 * 规则：
 *   · 只关心当天 21:30 之后；到了 24:00 自然换新的一天，不再补前一天的；
 *   · 如果宿主是 22:10 才启动的，只补最近的一条（22:00），不会连弹三条；
 *   · 已经弹过的 id 记在 shown 里，同一天不重复；
 *   · 预览（设置页按钮）不经过这里，也不会写 shown。
 */

export const NIGHT_SLOTS = [
  {
    id: '21:30',
    hour: 21,
    minute: 30,
    eyebrow: '21:30 · 夜色渐深',
    title: '已经九点半了',
    body: '距离该休息的时间，还剩一小时。把手里的事收个尾，别玩得太晚哦~',
    hint: '今晚也辛苦啦，给身体留一点安静。',
    note: null,
    primaryLabel: '好，我准备收尾 🌙',
    secondaryLabel: '再忙一会儿'
  },
  {
    id: '22:00',
    hour: 22,
    minute: 0,
    eyebrow: '22:00 · 夜深了',
    title: '还有最多半小时',
    body: '该准备休息啦。夜越深，越要对自己温柔一点；为了健康，也别熬得太晚。',
    hint: '可以关掉屏幕，去洗漱了。',
    note: null,
    primaryLabel: '好，我去洗漱 🌙',
    secondaryLabel: '再忙一会儿'
  },
  {
    id: '22:30',
    hour: 22,
    minute: 30,
    eyebrow: '22:30 · 子时将至',
    title: '十点半啦，真的该睡啦',
    body: '按照子午流注，子时（23:00～01:00）是最需要安静入睡的时辰。把今天轻轻放下，明天再继续。',
    hint: '晚安，做个好梦。',
    note: '子午流注 · 子时 23:00–01:00',
    primaryLabel: '晚安，我去睡啦 🌙',
    secondaryLabel: '知道了'
  }
];

/** 本地日期键：2026-10-18。 */
export function localDayKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 算出此刻该弹哪一条夜间提醒。
 *
 * @param {Date} date 当前本地时间
 * @param {string[]} shown 今天已经弹过的 slot id
 * @returns {{ slot: object, shown: string[] } | null}
 */
export function pickDueNightSlot(date, shown = []) {
  const current = minutesOfDay(date);
  const passed = NIGHT_SLOTS.filter((slot) => current >= slot.hour * 60 + slot.minute);
  if (passed.length === 0) return null;

  const shownSet = new Set(shown);
  const pending = passed.filter((slot) => !shownSet.has(slot.id));
  if (pending.length === 0) return null;

  return {
    // 只补最近的一条：22:10 启动时显示 22:00，而不是先弹 21:30。
    slot: pending[pending.length - 1],
    // 所有已经过点的都记为"已处理"，避免下一拍再补前面的。
    shown: passed.map((slot) => slot.id)
  };
}
