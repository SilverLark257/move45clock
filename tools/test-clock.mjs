/**
 * 计时状态机的纯 Node 测试（不启动 DSH、不弹窗、不碰文件）。
 * 运行：node tools/test-clock.mjs
 */
import assert from 'node:assert/strict';
import { createClock } from '../lib/clock-core.js';

const PLANS = [
  { id: 'a', emoji: '🅰️', title: 'A', detail: 'a', restMinutes: 1 },
  { id: 'b', emoji: '🅱️', title: 'B', detail: 'b', restMinutes: 2 }
];

let t = 1_000_000;
const clock = createClock({
  now: () => t,
  workMs: 1000,
  restMsFor: () => 1000,
  plans: PLANS
});

// 初始：工作
assert.equal(clock.snapshot().phase, 'work');
assert.equal(clock.snapshot().doneCount, 0);

// 差 1 毫秒不触发
t += 999;
assert.equal(clock.tick(), null);

// 到点：进入休息
t += 1;
const startEvent = clock.tick();
assert.equal(startEvent?.type, 'rest-start');
assert.ok(startEvent.plan);
assert.equal(clock.snapshot().phase, 'rest');
assert.equal(clock.snapshot().restSeconds, 1);

// 休息中差 1 毫秒不结束
t += 999;
assert.equal(clock.tick(), null);

// 休息结束
t += 1;
assert.equal(clock.tick()?.type, 'rest-end');
let snap = clock.snapshot();
assert.equal(snap.phase, 'done');
assert.equal(snap.doneCount, 1);
assert.equal(snap.skipped, false);

// 开始下一轮：doneCount 保留
assert.equal(clock.startNextRound(), true);
snap = clock.snapshot();
assert.equal(snap.phase, 'work');
assert.equal(snap.doneCount, 1);

// 长按跳过：不计入完成，计入跳过
t += 1000;
clock.tick();
assert.equal(clock.snapshot().phase, 'rest');
assert.equal(clock.skipRest(), true);
snap = clock.snapshot();
assert.equal(snap.phase, 'done');
assert.equal(snap.skipped, true);
assert.equal(snap.doneCount, 1);
assert.equal(snap.skippedCount, 1);

// 重复跳过无效
assert.equal(clock.skipRest(), false);

// 重新计时：回到工作，完成次数保留
clock.reset();
snap = clock.snapshot();
assert.equal(snap.phase, 'work');
assert.equal(snap.doneCount, 1);

// 手动「现在休息一下」
const plan = clock.startRestNow();
assert.ok(plan);
assert.equal(clock.snapshot().phase, 'rest');

// 显示用的字段
assert.equal(typeof clock.snapshot().now, 'number');
assert.equal(typeof clock.snapshot().deadline, 'number');

console.log('✅ clock-core: 全部断言通过');
