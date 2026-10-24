/**
 * 统计 + 连续天数（纯逻辑，不碰文件）。
 * ============================================================================
 *
 * 数据形状（宿主存到 ~/.dsh/storages/dsh-clock/stats.json）：
 *   { "version": 1,
 *     "days": { "2026-10-24": { "done": 3, "minutes": 38 } } }
 *
 * 规则：
 *   · 只有「休息倒计时自然走完」才记一次；长按紧急跳过不算（那不算真的休息）；
 *   · "今天" 按电脑本地日期算；minutes 是该次休息的计划分钟数（四舍五入，至少 1）；
 *   · 连续天数 = 每天至少有 1 次；如果今天还没有，就从昨天往前数，
 *     这样半夜刚过不会立刻显示 0 天；
 *   · 只保留最近 400 天，避免文件无限长。
 *
 * 宿主负责读写文件；这里全部是纯函数，方便 Node 直接测。
 */

import { localDayKey } from './night.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 空数据。 */
export function emptyStats() {
  return { version: 1, days: {} };
}

/** 把任意输入规整成合法统计；坏日期 / 坏数字直接丢掉，不拖累其它天。 */
export function normalizeStats(input) {
  const days = {};
  const source =
    input && typeof input === 'object' && input.days && typeof input.days === 'object'
      ? input.days
      : {};

  for (const [key, value] of Object.entries(source)) {
    if (!DAY_RE.test(key)) continue;
    const done = Math.round(Number(value?.done));
    if (!Number.isFinite(done) || done <= 0) continue;
    const minutesRaw = Math.round(Number(value?.minutes));
    const minutes = Number.isFinite(minutesRaw) ? Math.max(0, Math.min(14400, minutesRaw)) : 0;
    days[key] = { done: Math.min(9999, done), minutes };
  }

  return { version: 1, days };
}

/**
 * 日期键加减天数（本地中午计算，避开夏令时/时区边界）。
 * @param {string} key YYYY-MM-DD
 * @param {number} delta 天数，可正可负
 */
export function shiftDay(key, delta) {
  const [year, month, day] = key.split('-').map(Number);
  return localDayKey(new Date(year, month - 1, day + delta, 12, 0, 0, 0));
}

/**
 * 记一次完成的休息。
 * @param {object} stats 会被直接修改
 * @param {Date|string} date 日期或日期键，默认今天
 * @param {number} minutes 这次休息的计划分钟数
 */
export function addBreak(stats, date = new Date(), minutes = 0) {
  const key = typeof date === 'string' ? date : localDayKey(date);
  const previous = stats.days[key] ?? { done: 0, minutes: 0 };
  const addMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  stats.days[key] = {
    done: Math.min(9999, previous.done + 1),
    minutes: Math.min(14400, previous.minutes + addMinutes)
  };
  return stats;
}

/** 只保留最近 keepDays 天（含今天）。 */
export function pruneStats(stats, todayKey = localDayKey(), keepDays = 400) {
  const oldest = shiftDay(todayKey, -(Math.max(1, keepDays) - 1));
  for (const key of Object.keys(stats.days)) {
    if (key < oldest) delete stats.days[key];
  }
  return stats;
}

/**
 * 给客户端 / 接口用的汇总。
 * @param {object} stats
 * @param {Date} [now]
 */
export function summarize(stats, now = new Date()) {
  const todayKey = localDayKey(now);
  const today = stats.days[todayKey] ?? { done: 0, minutes: 0 };
  const countAt = (key) => stats.days[key]?.done ?? 0;

  let cursor = countAt(todayKey) > 0 ? todayKey : shiftDay(todayKey, -1);
  let streak = 0;
  while (streak < 3660 && countAt(cursor) > 0) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  const last7 = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const key = shiftDay(todayKey, -offset);
    const entry = stats.days[key] ?? { done: 0, minutes: 0 };
    const [year, month, day] = key.split('-').map(Number);
    const weekday = '日一二三四五六'[new Date(year, month - 1, day, 12).getDay()];
    last7.push({
      key,
      label: offset === 0 ? '今' : weekday,
      done: entry.done,
      minutes: entry.minutes,
      isToday: offset === 0
    });
  }

  const keys = Object.keys(stats.days);
  return {
    today: { done: today.done, minutes: today.minutes },
    streak,
    last7,
    totalDays: keys.length,
    totalDone: keys.reduce((sum, key) => sum + (stats.days[key]?.done ?? 0), 0),
    totalMinutes: keys.reduce((sum, key) => sum + (stats.days[key]?.minutes ?? 0), 0)
  };
}
