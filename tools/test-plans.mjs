/**
 * 计划库体检：12 套、时长 12～15 分钟、字段完整。
 * 运行：node tools/test-plans.mjs
 */
import assert from 'node:assert/strict';
import { PLANS, normalizeUserPlan } from '../lib/plans.js';

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

// ── 用户计划校验（可视化编辑器提交的内容）────────────────────────────────
const draft = {
  emoji: '🧪',
  title: '测试计划',
  summary: '自动化测试用',
  intensity: '轻松',
  focus: '测试',
  prepareSeconds: 10,
  steps: [
    { kind: 'reps', name: '踏步', target: 20, unit: '个', seconds: 200, cue: '测试动作' },
    { kind: 'rest', name: '喝水', seconds: 160, cue: '测试休息' }
  ]
};

const normalized = normalizeUserPlan(draft);
assert.equal(normalized.totalSeconds, 370, '总时长应自动算成 10 + 200 + 160');
assert.ok(normalized.id.startsWith('my-'), '没有 id 时应自动生成 my- 开头的 id');

assert.throws(() => normalizeUserPlan({ ...draft, title: '' }), /名字/, '空名字要报错');
assert.throws(
  () => normalizeUserPlan({ ...draft, steps: [{ ...draft.steps[0], seconds: 100 }] }),
  /5～30/,
  '总时长不足 5 分钟要报错'
);
assert.throws(
  () =>
    normalizeUserPlan({
      ...draft,
      steps: Array.from({ length: 4 }, (_, index) => ({
        ...draft.steps[0],
        name: `长动作 ${index + 1}`,
        seconds: 600
      }))
    }),
  /5～30/,
  '总时长超过 30 分钟要报错'
);
assert.throws(
  () => normalizeUserPlan({ ...draft, steps: [{ ...draft.steps[0], seconds: 1800 }] }),
  /秒数/,
  '单步超过 600 秒要报错，不能偷偷改成 600'
);
assert.throws(
  () => normalizeUserPlan({ ...draft, steps: [{ ...draft.steps[0], seconds: 0 }] }),
  /秒数/,
  '0 秒要报错'
);
assert.throws(() => normalizeUserPlan({ ...draft, id: 'BAD ID' }), /id/, '非法 id 要报错');
assert.throws(
  () => normalizeUserPlan({ ...draft, id: '' }, { allowGenerateId: false }),
  /id/,
  '读文件时缺 id 不能自动生成'
);

// 内置计划也必须能通过同一套校验（编辑器直接改内置时会走这条）
const builtinNormalized = normalizeUserPlan(PLANS[0]);
assert.equal(builtinNormalized.id, PLANS[0].id);
assert.equal(builtinNormalized.totalSeconds, PLANS[0].totalSeconds);

console.log('✅ plans: 12 套计划全部合法（12～15 分钟），用户计划校验通过');
