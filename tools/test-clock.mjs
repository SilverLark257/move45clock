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

// ── v1.7.0：短短短长周期 / 三种模式选池 / 新字段 ───────────────────────────
// 带分类的假计划库：2 套长运动、1 套家务、2 套短运动。
const kindPlans = [
  {
    id: 'ex-1',
    title: '长运动 1',
    totalSeconds: 600,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 590 }],
    category: '运动'
  },
  {
    id: 'ex-2',
    title: '长运动 2',
    totalSeconds: 720,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 710 }],
    category: '运动'
  },
  {
    id: 'chore-1',
    title: '家务',
    totalSeconds: 600,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 590 }],
    category: '家务休闲'
  },
  {
    id: 'short-1',
    title: '短运动 1',
    totalSeconds: 180,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 170 }],
    category: '短运动'
  },
  {
    id: 'short-2',
    title: '短运动 2',
    totalSeconds: 300,
    prepareSeconds: 10,
    steps: [{ kind: 'rest', name: 'r', seconds: 290 }],
    category: '短运动'
  }
];

/** 建一个方便快进的测试钟：工作 1 秒、休息 1 秒。 */
function fastClock(startAt, plans, planMode) {
  let now = startAt;
  const clock = createClock({
    now: () => now,
    workMs: 1000,
    restMsFor: () => 1000,
    plans,
    planMode
  });
  return { clock, advance: (ms = 1000) => (now += ms) };
}

// 3 短 1 长：连续 5 次自动休息的 breakKind 依次 short/short/short/long/short，
// shortStreak 依次 0→1→2→3→0→1。
{
  const { clock: cycleClock, advance } = fastClock(1_000_000, kindPlans, 'short-long');
  const kinds = [];
  const streakAfterDone = [];
  const nextAfterDone = [];
  for (let round = 0; round < 5; round += 1) {
    advance();
    const startEvent = cycleClock.tick();
    assert.equal(startEvent?.type, 'rest-start', `第 ${round + 1} 次休息应自动开始`);
    const during = cycleClock.snapshot();
    kinds.push(during.breakKind);
    assert.equal(during.phase, 'rest');
    assert.equal(during.cycleCounted, true, '自动到点的休息要计入周期');
    // 休息期间周期不变：第 1 次短休息 0，第 2 次 1，第 3 次 2，长休息 3，之后归 0。
    assert.equal(during.shortStreak, [0, 1, 2, 3, 0][round]);
    if (round === 3) {
      assert.equal(during.plan.category, '运动', '第 4 次应是长运动计划');
    } else {
      assert.equal(during.plan.category, '短运动', `第 ${round + 1} 次应是短运动计划`);
    }

    advance();
    assert.equal(cycleClock.tick()?.type, 'rest-end');
    const done = cycleClock.snapshot();
    streakAfterDone.push(done.shortStreak);
    nextAfterDone.push(done.nextBreakKind);
    assert.equal(done.breakKind, during.breakKind, '完成页也要带着这次休息的类型');
    cycleClock.startNextRound();
  }
  assert.deepEqual(kinds, ['short', 'short', 'short', 'long', 'short']);
  assert.deepEqual(streakAfterDone, [1, 2, 3, 0, 1]);
  assert.deepEqual(nextAfterDone, ['short', 'short', 'long', 'short', 'short']);
}

// 长按跳过也推进周期：跳过一次短休息后 streak+1，下一次仍是短休息。
{
  const { clock: skipClock, advance } = fastClock(2_000_000, kindPlans, 'short-long');
  advance();
  skipClock.tick();
  assert.equal(skipClock.snapshot().breakKind, 'short');
  assert.equal(skipClock.skipRest(), true);
  let skipped = skipClock.snapshot();
  assert.equal(skipped.phase, 'done');
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.shortStreak, 1, '跳过也推进周期');
  assert.equal(skipped.nextBreakKind, 'short', '只跳过一次，下一次仍是短休息');
  assert.equal(skipped.doneCount, 0, '跳过不算完成');
  skipClock.startNextRound();
  advance();
  skipClock.tick();
  assert.equal(skipClock.snapshot().breakKind, 'short');
  assert.equal(skipClock.snapshot().shortStreak, 1, '休息期间周期不变');
}

// 「试做」指定 planId：不算周期（cycleCounted=false），完成后也不推进。
{
  const { clock: trialClock } = fastClock(3_000_000, kindPlans, 'short-long');
  const trialPlan = trialClock.startRestNow('short-1');
  assert.equal(trialPlan.id, 'short-1');
  assert.equal(trialClock.snapshot().breakKind, 'short');
  assert.equal(trialClock.snapshot().cycleCounted, false);
  trialClock.skipRest();
  assert.equal(trialClock.snapshot().shortStreak, 0, '试做不推进短短短长周期');
  assert.equal(trialClock.snapshot().nextBreakKind, 'short');

  // 试做长计划：breakKind 按计划分类推成 long，但同样不计入周期。
  trialClock.startNextRound();
  trialClock.startRestNow('ex-1');
  assert.equal(trialClock.snapshot().breakKind, 'long');
  assert.equal(trialClock.snapshot().cycleCounted, false);
}

// 三模式选池：exercise 只抽运动；mixed 抽运动+家务、不抽短运动。
{
  const { clock: exerciseClock, advance } = fastClock(4_000_000, kindPlans, 'exercise');
  for (let i = 0; i < 5; i += 1) {
    advance();
    exerciseClock.tick();
    const snap = exerciseClock.snapshot();
    assert.equal(snap.breakKind, 'normal');
    assert.equal(snap.plan.category, '运动', 'exercise 模式只抽运动计划');
    assert.equal(snap.cycleCounted, false);
    exerciseClock.skipRest();
    exerciseClock.startNextRound();
  }

  // mixed 池里只放家务 + 短运动：短运动不该被抽到，只剩家务可选。
  const { clock: mixedClock, advance: advanceMixed } = fastClock(
    5_000_000,
    [kindPlans[2], kindPlans[3]],
    'mixed'
  );
  advanceMixed();
  mixedClock.tick();
  const mixedSnap = mixedClock.snapshot();
  assert.equal(mixedSnap.plan.id, 'chore-1', 'mixed 模式抽运动+家务，不抽短运动');
  assert.equal(mixedSnap.breakKind, 'normal');
  assert.equal(mixedSnap.nextBreakKind, 'normal');
}

// setPlanMode：非法值不生效；从别的模式切进短短短长时周期归零。
{
  const { clock: modeClock, advance } = fastClock(6_000_000, kindPlans, 'mixed');
  assert.equal(modeClock.snapshot().planMode, 'mixed');
  assert.equal(modeClock.setPlanMode('bogus'), false, '非法模式要拒绝');
  assert.equal(modeClock.snapshot().planMode, 'mixed');
  assert.equal(modeClock.setPlanMode('short-long'), true);
  assert.equal(modeClock.snapshot().planMode, 'short-long');

  advance();
  modeClock.tick();
  advance();
  modeClock.tick();
  assert.equal(modeClock.snapshot().shortStreak, 1, '完成一次短休息后 streak+1');
  modeClock.startNextRound();

  assert.equal(modeClock.setPlanMode('exercise'), true);
  assert.equal(modeClock.setPlanMode('short-long'), true);
  assert.equal(modeClock.snapshot().shortStreak, 0, '从别的模式切回短短短长时周期归零');
}

// restore：新字段能恢复；老快照没有新字段也能安全接上。
{
  const { clock: restoreClock, advance } = fastClock(7_000_000, kindPlans, 'short-long');
  const savedBase = (at) => ({
    version: 3,
    phase: 'rest',
    startedAt: at - 10_000,
    deadline: at + 50_000,
    workSeconds: 60,
    plan: kindPlans[3],
    restSeconds: 60,
    lastPlanId: 'short-1',
    doneCount: 2,
    skipped: false
  });

  assert.equal(
    restoreClock.restore({
      ...savedBase(7_000_000),
      shortStreak: 2,
      breakKind: 'short',
      cycleCounted: true
    }),
    true
  );
  let restored = restoreClock.snapshot();
  assert.equal(restored.shortStreak, 2);
  assert.equal(restored.breakKind, 'short');
  assert.equal(restored.cycleCounted, true);
  assert.equal(restored.nextBreakKind, 'short');
  // 恢复后完成这次休息：周期接着推 2 → 3
  advance(50_000);
  assert.equal(restoreClock.tick()?.type, 'rest-end');
  assert.equal(restoreClock.snapshot().shortStreak, 3);

  // 老快照（v1.6.0）没有 shortStreak/breakKind/cycleCounted：按缺省值补齐。
  const { clock: oldClock } = fastClock(8_000_000, kindPlans, 'short-long');
  assert.equal(oldClock.restore(savedBase(8_000_000)), true);
  const oldRestored = oldClock.snapshot();
  assert.equal(oldRestored.shortStreak, 0);
  assert.equal(oldRestored.breakKind, 'short', '缺 breakKind 时按计划分类推（短运动 → short）');
  assert.equal(oldRestored.cycleCounted, false);

  // 非短短短长模式下的老快照：breakKind 缺省按 normal（v1.6.0 的行为）。
  const { clock: oldMixed } = fastClock(9_000_000, kindPlans, 'mixed');
  assert.equal(oldMixed.restore(savedBase(9_000_000)), true);
  assert.equal(oldMixed.snapshot().breakKind, 'normal');

  // shortStreak 越界要夹到 0～3
  const { clock: clampClock } = fastClock(10_000_000, kindPlans, 'short-long');
  assert.equal(clampClock.restore({ ...savedBase(10_000_000), shortStreak: 99 }), true);
  assert.equal(clampClock.snapshot().shortStreak, 3);
  assert.equal(clampClock.restore({ ...savedBase(10_000_000), shortStreak: -5 }), true);
  assert.equal(clampClock.snapshot().shortStreak, 0);
}

// 短运动池空时退回任意计划，不返回 null（否则到点会卡住）。
{
  const { clock: fallbackClock, advance } = fastClock(
    11_000_000,
    [kindPlans[0], kindPlans[2]],
    'short-long'
  );
  advance();
  const event = fallbackClock.tick();
  assert.equal(event?.type, 'rest-start', '短运动池空也要能开始休息');
  const snap = fallbackClock.snapshot();
  assert.ok(snap.plan, '不能返回 null');
  assert.equal(snap.breakKind, 'short', '周期位置仍算短休息');
}

// 显示用的字段
assert.equal(typeof clock.snapshot().now, 'number');
assert.equal(typeof clock.snapshot().deadline, 'number');
// 老行为（默认 mixed）不变：snapshot 也带新字段
assert.equal(clock.snapshot().planMode, 'mixed', '不传 planMode 时默认 mixed');
assert.equal(clock.snapshot().shortStreak, 0);
assert.equal(clock.snapshot().nextBreakKind, 'normal');
assert.equal(clock.snapshot().breakKind, null);
assert.equal(clock.snapshot().cycleCounted, false);

console.log(
  '✅ clock-core: 全部断言通过（含短短短长 3 短 1 长 / 跳过推进 / 试做不推进 / ' +
    '三模式选池 / setPlanMode / restore 新字段兼容）'
);
