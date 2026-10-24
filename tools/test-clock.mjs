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

// 指定计划（设置页「试做这套」）
clock.skipRest();
clock.startNextRound();
const chosen = clock.startRestNow('b');
assert.equal(chosen.id, 'b');
assert.equal(clock.snapshot().plan.id, 'b');

// 运行时换计划库（设置页保存后宿主调用 setPlans）
const extra = { id: 'c', title: 'C', totalSeconds: 600, prepareSeconds: 10, steps: [] };
clock.skipRest();
clock.startNextRound();
clock.setPlans([...PLANS, extra]);
assert.equal(clock.startRestNow('c').id, 'c');

// 空数组会被忽略，不会把计划抽空
clock.skipRest();
clock.startNextRound();
clock.setPlans([]);
assert.equal(clock.startRestNow('c').id, 'c');

// 不存在的计划 id → 不开始休息（不会偷偷换一套）
clock.skipRest();
clock.startNextRound();
assert.equal(clock.startRestNow('missing'), null);
assert.equal(clock.snapshot().phase, 'work');

// ── 重启恢复：工作状态的剩余时间要接上 ─────────────────────────────────────
{
  let now = 5_000_000;
  const fresh = createClock({ now: () => now, workMs: 60_000, restMsFor: () => 60_000, plans: PLANS });
  const saved = {
    version: 3,
    phase: 'work',
    startedAt: now - 30_000,
    deadline: now + 30_000,
    workSeconds: 60,
    plan: null,
    restSeconds: 0,
    lastPlanId: 'a',
    doneCount: 2,
    skipped: false
  };
  assert.equal(fresh.restore(saved), true);
  let restored = fresh.snapshot();
  assert.equal(restored.phase, 'work');
  assert.equal(restored.deadline, now + 30_000);
  assert.equal(restored.doneCount, 2);
  assert.equal(restored.workSeconds, 60);

  now += 30_000;
  const event = fresh.tick();
  assert.equal(event?.type, 'rest-start');
  assert.notEqual(event.plan.id, 'a', '恢复后应避开上一次的计划');
}

// ── 重启恢复：休息中的剩余时间也要接上 ─────────────────────────────────────
{
  let now = 7_000_000;
  const plan = {
    id: 'x',
    title: 'X',
    totalSeconds: 600,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 590 }]
  };
  const clock2 = createClock({ now: () => now, workMs: 60_000, restMsFor: () => 600_000, plans: [plan] });
  assert.equal(
    clock2.restore({
      version: 3,
      phase: 'rest',
      startedAt: now - 100_000,
      deadline: now + 500_000,
      workSeconds: 60,
      plan,
      restSeconds: 600,
      lastPlanId: 'x',
      doneCount: 1
    }),
    true
  );
  assert.equal(clock2.snapshot().phase, 'rest');
  now += 499_999;
  assert.equal(clock2.tick(), null);
  now += 1;
  assert.equal(clock2.tick()?.type, 'rest-end');
}

// ── 坏数据不恢复，也不破坏当前状态 ─────────────────────────────────────────
{
  const clock3 = createClock({ now: () => 1, workMs: 60_000, plans: PLANS });
  assert.equal(clock3.restore(null), false);
  assert.equal(clock3.restore({ phase: 'bogus' }), false);
  assert.equal(clock3.restore({ phase: 'rest', startedAt: 0, deadline: 10 }), false, '休息必须有计划');
  assert.equal(clock3.snapshot().phase, 'work');
}

// 显示用的字段
assert.equal(typeof clock.snapshot().now, 'number');
assert.equal(typeof clock.snapshot().deadline, 'number');

console.log('✅ clock-core: 全部断言通过');
