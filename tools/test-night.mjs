/**
 * 夜间提醒调度测试（纯函数，不启动 DSH）。
 * 运行：node tools/test-night.mjs
 */
import assert from 'node:assert/strict';
import { NIGHT_SLOTS, pickDueNightSlot, localDayKey } from '../lib/night.js';

assert.equal(NIGHT_SLOTS.length, 3);
assert.deepEqual(
  NIGHT_SLOTS.map((slot) => slot.id),
  ['21:30', '22:00', '22:30']
);
assert.ok(NIGHT_SLOTS.every((slot) => slot.title && slot.body && slot.primaryLabel));

// 用本地时间构造，避免测试机时区不同时偏移。
const at = (hour, minute, day = 18) => new Date(2026, 9, day, hour, minute, 0);

assert.equal(localDayKey(at(21, 30)), '2026-10-18');

// 还没到 21:30：不弹
assert.equal(pickDueNightSlot(at(21, 29), []), null);

// 21:30：弹第一条
let due = pickDueNightSlot(at(21, 30), []);
assert.equal(due.slot.id, '21:30');
assert.deepEqual(due.shown, ['21:30']);

// 22:00：弹第二条
due = pickDueNightSlot(at(22, 0), ['21:30']);
assert.equal(due.slot.id, '22:00');
assert.deepEqual(due.shown, ['21:30', '22:00']);

// 22:10 才启动：只补最近的 22:00，不连弹 21:30
due = pickDueNightSlot(at(22, 10), ['21:30']);
assert.equal(due.slot.id, '22:00');
assert.deepEqual(due.shown, ['21:30', '22:00']);

// 22:45 才启动：只补最后的 22:30
due = pickDueNightSlot(at(22, 45), []);
assert.equal(due.slot.id, '22:30');
assert.deepEqual(due.shown, ['21:30', '22:00', '22:30']);

// 同一天弹过的不会重复
assert.equal(pickDueNightSlot(at(21, 30), ['21:30']), null);
assert.equal(pickDueNightSlot(at(23, 59), ['21:30', '22:00', '22:30']), null);

// 白天 / 第二天凌晨：不弹
assert.equal(pickDueNightSlot(at(9, 0), []), null);
assert.equal(pickDueNightSlot(at(0, 30, 19), ['21:30']), null);

console.log('✅ night: 夜间提醒调度全部断言通过');
