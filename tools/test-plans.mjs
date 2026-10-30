/**
 * 计划库体检：22 套（12 套运动 + 4 套家务休闲 + 6 套短运动）、时长按分类分档、字段完整。
 * 运行：node tools/test-plans.mjs
 */
import assert from 'node:assert/strict';
import {
  PLANS,
  PLAN_CATEGORY,
  PLAN_MODES,
  DEFAULT_PLAN_MODE,
  planKind,
  normalizeUserPlan,
  SHORT_PLAN_MIN_SECONDS,
  SHORT_PLAN_MAX_SECONDS
} from '../lib/plans.js';

assert.ok(Array.isArray(PLANS), 'PLANS 必须是数组');
assert.equal(PLANS.length, 22, '计划库必须有 22 套（12 运动 + 4 家务休闲 + 6 短运动）');

// 计划模式常量（设置页三选一）
assert.deepEqual(PLAN_MODES, ['exercise', 'mixed', 'short-long']);
assert.equal(DEFAULT_PLAN_MODE, 'short-long');
assert.deepEqual(PLAN_CATEGORY, { EXERCISE: '运动', CHORE: '家务休闲', SHORT: '短运动' });
assert.equal(SHORT_PLAN_MIN_SECONDS, 180);
assert.equal(SHORT_PLAN_MAX_SECONDS, 300);

const choreIds = ['chore-wipe', 'chore-mop', 'chore-clothes', 'chore-laundry'];
const chores = PLANS.filter((plan) => plan.category === '家务休闲');
assert.equal(chores.length, 4, '家务休闲必须正好 4 套');
for (const id of choreIds) {
  assert.ok(PLANS.some((plan) => plan.id === id), `缺少家务休闲计划：${id}`);
}
assert.equal(
  PLANS.filter((plan) => !plan.category || plan.category === '运动').length,
  12,
  '除 4 套家务休闲、6 套短运动外，其余 12 套应是运动计划'
);

const shortIds = ['short-neck', 'short-squat', 'short-march', 'short-stretch', 'short-wall', 'short-walk'];
const shorts = PLANS.filter((plan) => plan.category === PLAN_CATEGORY.SHORT);
assert.equal(shorts.length, 6, '短运动必须正好 6 套');
for (const id of shortIds) {
  assert.ok(PLANS.some((plan) => plan.id === id), `缺少短运动计划：${id}`);
}

const ids = new Set();
for (const plan of PLANS) {
  assert.ok(plan.id && !ids.has(plan.id), `id 重复或缺失：${plan.id}`);
  ids.add(plan.id);

  assert.ok(plan.title, `${plan.id}: 缺 title`);
  assert.ok(plan.summary, `${plan.id}: 缺 summary`);
  assert.ok(plan.emoji, `${plan.id}: 缺 emoji`);
  assert.ok(plan.prepareSeconds >= 5, `${plan.id}: 准备时间太短`);
  assert.ok(Array.isArray(plan.steps) && plan.steps.length >= 4, `${plan.id}: 步骤太少`);

  const sum = plan.prepareSeconds + plan.steps.reduce((total, step) => total + step.seconds, 0);
  assert.equal(plan.totalSeconds, sum, `${plan.id}: totalSeconds 与步骤之和不一致`);

  // 时长按分类分档：短运动 3～5 分钟，其它 12～15 分钟。
  if (planKind(plan) === 'short') {
    assert.ok(
      plan.totalSeconds >= SHORT_PLAN_MIN_SECONDS && plan.totalSeconds <= SHORT_PLAN_MAX_SECONDS,
      `${plan.id}: 短运动总时长 ${plan.totalSeconds}s 不在 3～5 分钟`
    );
  } else {
    assert.ok(
      plan.totalSeconds >= 720 && plan.totalSeconds <= 900,
      `${plan.id}: 总时长 ${plan.totalSeconds}s 不在 12～15 分钟`
    );
  }

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
assert.equal(builtinNormalized.category, '运动', '普通计划默认分类是「运动」');

const choreNormalized = normalizeUserPlan(PLANS.find((plan) => plan.category === '家务休闲'));
assert.equal(choreNormalized.category, '家务休闲', '编辑家务计划时要保留分类');
assert.equal(normalizeUserPlan({ ...draft, category: '家务休闲' }).category, '家务休闲');

// ── 短运动计划：编辑内置短计划 / 新建短计划走 3～5 分钟这一档 ─────────────
const shortDraft = {
  emoji: '🧘',
  title: '短运动测试',
  summary: '自动化测试用的短计划',
  intensity: '轻松',
  focus: '测试',
  category: '短运动',
  prepareSeconds: 10,
  steps: [
    { kind: 'reps', name: '踏步', target: 20, unit: '个', seconds: 60, cue: '测试用的动作' },
    { kind: 'rest', name: '喝水', seconds: 30, cue: '测试用的休息' },
    { kind: 'rest', name: '拉伸', seconds: 80, cue: '测试用的收尾' }
  ]
};

const shortNormalized = normalizeUserPlan(shortDraft);
assert.equal(shortNormalized.totalSeconds, 180, '短运动边界：正好 3 分钟要合法');
assert.equal(shortNormalized.category, '短运动', '短运动分类要保留');

assert.throws(
  () => normalizeUserPlan({ ...shortDraft, steps: [{ ...shortDraft.steps[0], seconds: 100 }] }),
  /3～5/,
  '短运动不足 3 分钟要报错，文案要带 3～5'
);
assert.throws(
  () => normalizeUserPlan({ ...shortDraft, steps: [{ ...shortDraft.steps[0], seconds: 400 }] }),
  /3～5/,
  '短运动超过 5 分钟要报错，文案要带 3～5'
);
// 同样是 180 秒，归类成普通计划就得按 5～30 分钟报错：分档看的是分类。
assert.throws(
  () => normalizeUserPlan({ ...shortDraft, category: '运动' }),
  /5～30/,
  '普通计划仍按 5～30 分钟校验'
);

const builtinShort = normalizeUserPlan(PLANS.find((plan) => plan.category === '短运动'));
assert.equal(builtinShort.category, '短运动', '编辑内置短运动计划要能通过并保留分类');
assert.ok(
  builtinShort.totalSeconds >= SHORT_PLAN_MIN_SECONDS &&
    builtinShort.totalSeconds <= SHORT_PLAN_MAX_SECONDS
);
assert.equal(planKind({ id: 'no-category' }), 'exercise', '没写分类的老计划当运动');
assert.equal(planKind({ id: 'x', category: '短运动' }), 'short');
assert.equal(planKind({ id: 'y', category: '家务休闲' }), 'chore');

console.log(
  '✅ plans: 22 套计划全部合法（12 套运动 + 4 套家务休闲 + 6 套短运动，按分类校验时长），' +
    '用户计划校验（含短运动 3～5 分钟分档）通过'
);
