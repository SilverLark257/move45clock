/**
 * 统计 / 连续天数测试（纯逻辑，不启动 DSH）。
 *
 * 运行：node tools/test-stats.mjs
 */
import assert from 'node:assert/strict';
import {
  addBreak,
  emptyStats,
  normalizeStats,
  pruneStats,
  shiftDay,
  summarize
} from '../lib/stats.js';
import { localDayKey } from '../lib/night.js';

const NOW = new Date(2026, 9, 24, 12, 0, 0); // 2026-10-24 12:00 本地
const TODAY = localDayKey(NOW);
const day = (offset) => shiftDay(TODAY, offset);

// ── 空数据 ──────────────────────────────────────────────────────────────────
{
  const summary = summarize(emptyStats(), NOW);
  assert.equal(summary.today.done, 0);
  assert.equal(summary.today.minutes, 0);
  assert.equal(summary.streak, 0);
  assert.equal(summary.last7.length, 7);
  assert.equal(summary.last7[6].isToday, true);
  assert.equal(summary.last7[6].label, '今');
  assert.equal(summary.totalDays, 0);
}

// ── 记两次今天 ─────────────────────────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, NOW, 12);
  addBreak(stats, NOW, 13);
  const summary = summarize(stats, NOW);
  assert.equal(summary.today.done, 2);
  assert.equal(summary.today.minutes, 25);
  assert.equal(summary.streak, 1);
  assert.equal(summary.last7[6].done, 2);
  assert.equal(summary.totalDone, 2);
}

// ── 连续两天 ────────────────────────────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, day(-1), 10);
  addBreak(stats, NOW, 10);
  assert.equal(summarize(stats, NOW).streak, 2);
}

// ── 今天还没休息：连续天数算到昨天 ─────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, day(-1), 10);
  addBreak(stats, day(-2), 10);
  const summary = summarize(stats, NOW);
  assert.equal(summary.today.done, 0);
  assert.equal(summary.streak, 2, '今天没休息时，连续天数应保持到昨天，而不是立刻归零');
}

// ── 中间断一天：连续归零 ────────────────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, day(-2), 10);
  addBreak(stats, day(-3), 10);
  addBreak(stats, NOW, 10);
  assert.equal(summarize(stats, NOW).streak, 1);
}

// ── 最近 7 天顺序 / 标签 ────────────────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, day(-6), 5);
  addBreak(stats, NOW, 8);
  const summary = summarize(stats, NOW);
  assert.equal(summary.last7[0].key, day(-6));
  assert.equal(summary.last7[6].key, TODAY);
  assert.equal(summary.last7[0].done, 1);
  assert.equal(summary.last7[6].done, 1);
  for (const item of summary.last7) {
    assert.match(item.key, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(item.label.length >= 1 && item.label.length <= 1);
  }
}

// ── 日期加减跨月 / 跨年 ─────────────────────────────────────────────────────
{
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29'); // 闰年
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
}

// ── 只保留最近 400 天 ───────────────────────────────────────────────────────
{
  const stats = emptyStats();
  addBreak(stats, TODAY, 10);
  addBreak(stats, shiftDay(TODAY, -399), 10); // 边界内
  addBreak(stats, shiftDay(TODAY, -400), 10); // 太旧
  pruneStats(stats, TODAY, 400);
  assert.ok(stats.days[TODAY]);
  assert.ok(stats.days[shiftDay(TODAY, -399)]);
  assert.ok(!stats.days[shiftDay(TODAY, -400)]);
  assert.equal(Object.keys(stats.days).length, 2);
}

// ── 规整坏数据 ──────────────────────────────────────────────────────────────
{
  const stats = normalizeStats({
    version: 1,
    days: {
      '2026-10-24': { done: '3', minutes: '38' },
      '2026-10-23': { done: 0, minutes: 10 }, // 0 次：丢掉
      'not-a-date': { done: 2, minutes: 10 }, // 坏键：丢掉
      '2026-10-22': { done: -1, minutes: 10 }, // 负数：丢掉
      '2026-10-21': { done: 1, minutes: 999999 } // 分钟上限
    }
  });
  assert.deepEqual(Object.keys(stats.days).sort(), ['2026-10-21', '2026-10-24']);
  assert.equal(stats.days['2026-10-24'].done, 3);
  assert.equal(stats.days['2026-10-24'].minutes, 38);
  assert.equal(stats.days['2026-10-21'].minutes, 14400);
}

// ── 坏输入不炸 ──────────────────────────────────────────────────────────────
{
  assert.deepEqual(normalizeStats(null), { version: 1, days: {} });
  assert.deepEqual(normalizeStats('nope'), { version: 1, days: {} });
  assert.equal(summarize(normalizeStats({ days: {} }), NOW).streak, 0);
}

console.log('✅ stats: 统计 / 连续天数全部断言通过');
