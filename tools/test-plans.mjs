/**
 * 计划库体检：12 套、时长 12～15 分钟、字段完整。
 * 运行：node tools/test-plans.mjs
 */
import assert from 'node:assert/strict';
import { PLANS } from '../lib/plans.js';

assert.ok(Array.isArray(PLANS), 'PLANS 必须是数组');
assert.equal(PLANS.length, 12, '计划库必须有 12 套');

const ids = new Set();
for (const plan of PLANS) {
  assert.ok(plan.id && !ids.has(plan.id), `id 重复或缺失：${plan.id}`);
  ids.add(plan.id);

  assert.ok(plan.title, `${plan.id}: 缺 title`);
  assert.ok(plan.summary, `${plan.id}: 缺 summary`);
  assert.ok(plan.emoji, `${plan.id}: 缺 emoji`);
  assert.ok(plan.prepareSeconds >= 5, `${plan.id}: 准备时间太短`);
  assert.ok(Array.isArray(plan.steps) && plan.steps.length >= 5, `${plan.id}: 步骤太少`);

  const sum = plan.prepareSeconds + plan.steps.reduce((total, step) => total + step.seconds, 0);
  assert.equal(plan.totalSeconds, sum, `${plan.id}: totalSeconds 与步骤之和不一致`);
  assert.ok(
    plan.totalSeconds >= 720 && plan.totalSeconds <= 900,
    `${plan.id}: 总时长 ${plan.totalSeconds}s 不在 12～15 分钟`
  );

  for (const step of plan.steps) {
    assert.ok(step.name && step.cue, `${plan.id}: 步骤缺 name/cue`);
    assert.ok(step.seconds > 0, `${plan.id}: 步骤秒数必须大于 0`);
    assert.ok(step.kind === 'reps' || step.kind === 'rest', `${plan.id}: 未知步骤类型 ${step.kind}`);
    if (step.kind === 'reps') {
      assert.ok(step.target > 0, `${plan.id}: 次数型步骤必须有 target`);
      assert.ok(step.unit, `${plan.id}: 次数型步骤必须有 unit`);
    }
  }
}

console.log('✅ plans: 12 套计划全部合法（12～15 分钟）');
