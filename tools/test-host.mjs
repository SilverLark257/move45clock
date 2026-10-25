/**
 * 宿主半边的接线测试：用一个假的 cordis ctx 调用 apply()，直接调用 HTTP 路由。
 * 不启动 DSH、不真的叫醒窗口。
 *
 * 运行：node tools/test-host.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// 用临时设置/计划/夜间文件，避免影响（也避免被）真实用户数据影响。
const suffix = `${process.pid}-${Date.now()}`;
const settingsFile = path.join(os.tmpdir(), `dsh-clock-test-settings-${suffix}.json`);
const plansFile = path.join(os.tmpdir(), `dsh-clock-test-plans-${suffix}.json`);
const nightFile = path.join(os.tmpdir(), `dsh-clock-test-night-${suffix}.json`);
const statsFile = path.join(os.tmpdir(), `dsh-clock-test-stats-${suffix}.json`);
const clockFile = path.join(os.tmpdir(), `dsh-clock-test-clock-${suffix}.json`);
fs.rmSync(settingsFile, { force: true });
fs.rmSync(plansFile, { force: true });
fs.rmSync(nightFile, { force: true });
fs.rmSync(statsFile, { force: true });
fs.rmSync(clockFile, { force: true });
process.env.DSH_CLOCK_SETTINGS_FILE = settingsFile;
process.env.DSH_CLOCK_PLANS_FILE = plansFile;
process.env.DSH_CLOCK_NIGHT_FILE = nightFile;
process.env.DSH_CLOCK_STATS_FILE = statsFile;
process.env.DSH_CLOCK_CLOCK_FILE = clockFile;
// 固定成 21:45，验证"启动时补最近一条 21:30"；测试里不真的叫醒窗口。
process.env.DSH_CLOCK_NIGHT_NOW = '2026-10-18T21:45:00+08:00';
process.env.DSH_CLOCK_NO_WAKE = '1';

const { apply } = await import('../lib/index.js');

const routes = [];
const disposers = [];

const fakeScoped = {
  logger: { info() {}, warn() {} },
  webServer: {
    register(item) {
      routes.push(item);
      return () => {};
    }
  },
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  }
};

const fakeCtx = {
  logger: { info() {}, warn() {} },
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  },
  inject(names, callback) {
    callback(fakeScoped);
  }
};

apply(fakeCtx);

assert.equal(routes.length, 11);
const byPath = new Map(routes.map((item) => [item.path, item]));
for (const suffix of ['/state', '/plans', '/settings', '/rest', '/skip', '/next', '/reset', '/wake', '/night', '/notify', '/panel']) {
  assert.ok(byPath.has(`/dsh-clock/rpc${suffix}`), `missing route ${suffix}`);
}

function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body ?? '';
    }
  };
}

async function call(suffix, method = 'GET') {
  const route = byPath.get(`/dsh-clock/rpc${suffix}`);
  const res = makeRes();
  await route.handler({ method }, res);
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
}

async function callWithBody(suffix, method, body) {
  const route = byPath.get(`/dsh-clock/rpc${suffix}`);
  const res = makeRes();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = method;
  await route.handler(req, res);
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
}

const callPut = (suffix, body) => callWithBody(suffix, 'PUT', body);
const callPost = (suffix, body = {}) => callWithBody(suffix, 'POST', body);

// GET /state
let result = await call('/state');
if (result.status !== 200) console.error('state failed:', result);
assert.equal(result.status, 200);
assert.equal(result.json.ok, true);
assert.equal(result.json.state.phase, 'work');
assert.equal(result.json.state.devMode, false);
assert.equal(result.json.state.workSeconds, 2700);
assert.equal(result.json.state.settings.cardScale, 1.5);
assert.equal(typeof result.json.state.deadline, 'number');
assert.equal(result.json.state.stats.today.done, 0);
assert.equal(result.json.state.stats.today.minutes, 0);
assert.equal(result.json.state.stats.streak, 0);
assert.equal(result.json.state.stats.last7.length, 7);

// 计时快照已落盘（宿主重启时用来接续）
assert.ok(fs.existsSync(clockFile), '计时快照应已写入');
const savedClock = JSON.parse(fs.readFileSync(clockFile, 'utf8'));
assert.equal(savedClock.version, 1);
assert.equal(savedClock.state.phase, 'work');

// 启动时固定为 21:45：应补一条最近的 21:30 夜间提醒（测试里不叫醒窗口）
assert.equal(result.json.state.night.active, true);
assert.equal(result.json.state.night.slot.id, '21:30');
result = await callPost('/night', { action: 'dismiss' });
assert.equal(result.status, 200);
assert.equal(result.json.state.night.active, false);

// GET /plans：默认 16 套内置、全部启用、没有已删除的
result = await call('/plans');
assert.equal(result.json.ok, true);
assert.equal(result.json.plans.length, 16);
assert.equal(result.json.builtinCount, 16);
assert.equal(result.json.customCount, 0);
assert.equal(result.json.visibleCount, 16);
assert.equal(result.json.hiddenCount, 0);
assert.ok(
  result.json.plans.every(
    (plan) => plan.builtin === true && plan.disabled === false && plan.hidden === false
  )
);
assert.equal(result.json.plans.filter((plan) => plan.category === '家务休闲').length, 4);

// GET /settings（默认值）
result = await call('/settings');
assert.equal(result.json.settings.workMinutes, 45);
assert.equal(result.json.settings.restMinutes, 0);
assert.equal(result.json.settings.cardScale, 1.5);
assert.equal(result.json.settings.nightEnabled, true);
assert.equal(result.json.settings.notifyWindow, true);

// 夜间提醒：预览 / 开关 / 未知操作
result = await callPost('/night', { action: 'preview', slotId: '22:30' });
assert.equal(result.status, 200);
assert.equal(result.json.state.night.active, true);
assert.equal(result.json.state.night.slot.id, '22:30');

result = await callPut('/settings', { nightEnabled: false });
assert.equal(result.json.settings.nightEnabled, false);
assert.equal(result.json.state.night.active, false, '关掉夜间提醒后，正在显示的卡片也要收起');

result = await callPost('/night', { action: 'bogus' });
assert.equal(result.status, 400);

result = await callPut('/settings', { nightEnabled: true });
assert.equal(result.json.settings.nightEnabled, true);

// 置顶小窗开关 + 预览（测试里 DSH_CLOCK_NO_WAKE=1，不会真的弹窗）
result = await callPut('/settings', { notifyWindow: false });
assert.equal(result.json.settings.notifyWindow, false);
result = await callPut('/settings', { notifyWindow: true });
assert.equal(result.json.settings.notifyWindow, true);

result = await callPost('/notify', { action: 'preview' });
assert.equal(result.status, 200);
assert.equal(result.json.ok, true);
assert.ok(result.json.plan?.title, '预览应返回一个计划');
assert.equal((await callPost('/notify', { action: 'bogus' })).status, 400);

// 小窗里的「打开健康钟」：/panel 置一个 token，/state 带回去给客户端打开面板
assert.equal((await call('/state')).json.state.panelRequest, 0);
result = await callPost('/panel');
assert.equal(result.status, 200);
assert.equal(result.json.ok, true);
assert.ok(result.json.panelRequest > 0);
assert.equal((await call('/state')).json.state.panelRequest, result.json.panelRequest);

// 非休息阶段的 skip / next 是 no-op
result = await call('/skip', 'POST');
assert.equal(result.json.ok, false);
assert.equal(result.json.state.phase, 'work');

result = await call('/next', 'POST');
assert.equal(result.json.ok, false);

// reset 始终成功
result = await call('/reset', 'POST');
assert.equal(result.json.ok, true);
assert.equal(result.json.state.phase, 'work');

// PUT /settings：正常保存
result = await callPut('/settings', { workMinutes: 25, restMinutes: 15 });
assert.equal(result.status, 200);
assert.equal(result.json.settings.workMinutes, 25);
assert.equal(result.json.settings.restMinutes, 15);
assert.equal(result.json.settings.cardScale, 1.5);
// 当前这一轮不被打断（仍按旧的 45 分钟），设置里的 25 分钟下一轮生效
assert.equal(result.json.state.workSeconds, 2700);
assert.equal(result.json.state.settings.workMinutes, 25);
assert.ok(fs.existsSync(settingsFile), '设置文件应已写入');

// 重置后，新一轮按 25 分钟开始
result = await call('/reset', 'POST');
assert.equal(result.json.state.workSeconds, 1500);

// PUT /settings：越界值会被夹到合法范围
result = await callPut('/settings', { workMinutes: 999, restMinutes: 1, cardScale: 9 });
assert.equal(result.json.settings.workMinutes, 120);
assert.equal(result.json.settings.restMinutes, 5);
assert.equal(result.json.settings.cardScale, 2);

// PUT /settings：只传一个字段时，其它字段保持原值（合并而不是覆盖）
result = await callPut('/settings', { cardScale: 1.2 });
assert.equal(result.json.settings.workMinutes, 120);
assert.equal(result.json.settings.restMinutes, 5);
assert.equal(result.json.settings.cardScale, 1.2);

// ── 计划编辑器：新建一个自己的计划 ─────────────────────────────────────────
const customDraft = {
  emoji: '🧪',
  title: '测试计划',
  summary: '自动化测试用的计划',
  intensity: '轻松',
  focus: '测试',
  prepareSeconds: 10,
  steps: [
    { kind: 'reps', name: '踏步', target: 20, unit: '个', seconds: 200, cue: '测试用的动作' },
    { kind: 'rest', name: '喝水', seconds: 100, cue: '测试用的休息' },
    { kind: 'rest', name: '拉伸', seconds: 60, cue: '测试用的收尾' }
  ]
};

result = await callPost('/plans', { op: 'save', plan: customDraft });
assert.equal(result.status, 200);
assert.equal(result.json.ok, true);
assert.equal(result.json.plans.length, 17);
assert.equal(result.json.saved.totalSeconds, 370);
assert.equal(result.json.saved.title, '测试计划');
assert.ok(result.json.saved.id.startsWith('my-'), '新计划应自动生成 my- 开头的 id');
const customId = result.json.saved.id;
const customInList = result.json.plans.find((plan) => plan.id === customId);
assert.ok(customInList);
assert.equal(customInList.builtin, false);
assert.equal(customInList.disabled, false);
assert.ok(fs.existsSync(plansFile), '计划文件应已写入');

// ── 直接改内置计划，存成「覆盖」，并且可以恢复默认 ──────────────────────
const builtin = result.json.plans.find((plan) => plan.id === 'march-calf');
const overrideDraft = { ...JSON.parse(JSON.stringify(builtin)), title: '踏步（改）' };
result = await callPost('/plans', { op: 'save', plan: overrideDraft });
assert.equal(result.status, 200);
const overridden = result.json.plans.find((plan) => plan.id === 'march-calf');
assert.equal(overridden.title, '踏步（改）');
assert.equal(overridden.builtin, true);
assert.equal(overridden.overridden, true);

// ── 停用 / 启用 ──────────────────────────────────────────────────────────
result = await callPost('/plans', { op: 'disable', id: 'glute-stand' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.find((plan) => plan.id === 'glute-stand').disabled, true);

result = await callPost('/plans', { op: 'enable', id: 'glute-stand' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.find((plan) => plan.id === 'glute-stand').disabled, false);

// 停用后再「试做」要给出明确错误；不存在的计划也要给出明确错误
await callPost('/plans', { op: 'disable', id: 'glute-stand' });
result = await callPost('/rest', { planId: 'glute-stand' });
assert.equal(result.json.ok, false);
assert.match(result.json.error, /已停用/);

result = await callPost('/rest', { planId: 'not-a-real-plan' });
assert.equal(result.json.ok, false);
assert.match(result.json.error, /找不到/);

// 恢复内置原样
result = await callPost('/plans', { op: 'restore', id: 'march-calf' });
assert.equal(result.status, 200);
const restored = result.json.plans.find((plan) => plan.id === 'march-calf');
assert.equal(restored.overridden, false);
assert.equal(restored.title, '踏步 + 提踵');
assert.equal(restored.disabled, false);

// 删除自己建的
result = await callPost('/plans', { op: 'delete', id: customId });
assert.equal(result.status, 200);
assert.equal(result.json.plans.length, 16);
assert.equal(result.json.plans.some((plan) => plan.id === customId), false);

// ── 删除内置计划（软删除）：从列表和随机池里消失，但可以恢复 ──────────────
result = await callPost('/plans', { op: 'delete', id: 'chore-wipe' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.find((plan) => plan.id === 'chore-wipe').hidden, true);
const savedLibrary = JSON.parse(fs.readFileSync(plansFile, 'utf8'));
assert.ok(savedLibrary.hidden.includes('chore-wipe'), '删除内置计划要写进 plans.json 的 hidden');
result = await call('/plans');
assert.equal(result.json.visibleCount, 15);
assert.equal(result.json.hiddenCount, 1);

// 已删除的计划不能「试做」，也不能再「停用」
result = await callPost('/rest', { planId: 'chore-wipe' });
assert.equal(result.json.ok, false);
assert.match(result.json.error, /已删除/);
result = await callPost('/plans', { op: 'disable', id: 'chore-wipe' });
assert.equal(result.status, 400);
assert.match(result.json.error, /已删除/);

// 恢复单套
result = await callPost('/plans', { op: 'restore-hidden', id: 'chore-wipe' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.find((plan) => plan.id === 'chore-wipe').hidden, false);
result = await call('/plans');
assert.equal(result.json.visibleCount, 16);

// 删除多套后「全部恢复」
await callPost('/plans', { op: 'delete', id: 'chore-mop' });
await callPost('/plans', { op: 'delete', id: 'chore-laundry' });
result = await callPost('/plans', { op: 'restore-all-hidden' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.find((plan) => plan.id === 'chore-mop').hidden, false);
assert.equal(result.json.plans.find((plan) => plan.id === 'chore-laundry').hidden, false);
result = await call('/plans');
assert.equal(result.json.hiddenCount, 0);

// 至少保留 1 套计划：先停到只剩 1 套，再试图删除 / 停用最后一套 → 400
const enabledNow = result.json.plans.filter((plan) => !plan.disabled && !plan.hidden);
for (const plan of enabledNow.slice(1)) {
  const disabled = await callPost('/plans', { op: 'disable', id: plan.id });
  assert.equal(disabled.status, 200);
}
result = await callPost('/plans', { op: 'delete', id: enabledNow[0].id });
assert.equal(result.status, 400);
assert.match(result.json.error, /至少要保留 1 套/);
result = await callPost('/plans', { op: 'disable', id: enabledNow[0].id });
assert.equal(result.status, 400);
assert.match(result.json.error, /至少要保留 1 套/);

// 全部恢复内置
result = await callPost('/plans', { op: 'reset-all' });
assert.equal(result.status, 200);
assert.equal(result.json.plans.length, 16);
result = await call('/plans');
assert.equal(result.json.hiddenCount, 0);
assert.ok(
  result.json.plans.every(
    (plan) => plan.overridden === false && plan.disabled === false && plan.hidden === false
  )
);

// 未知操作 → 400
result = await callPost('/plans', { op: 'nonsense' });
assert.equal(result.status, 400);

// 方法不对 → 405
result = await call('/state', 'POST');
assert.equal(result.status, 405);
assert.equal(result.json.ok, false);

// 收尾：清掉计时器；删除临时文件
for (const dispose of disposers.reverse()) {
  try {
    dispose();
  } catch {
    /* 忽略 */
  }
}
fs.rmSync(settingsFile, { force: true });
fs.rmSync(plansFile, { force: true });
fs.rmSync(nightFile, { force: true });
fs.rmSync(statsFile, { force: true });
fs.rmSync(clockFile, { force: true });

console.log(
  '✅ host 接线：全部断言通过（含计划增删改 / 内置计划删除与恢复 / 缩放设置 / 夜间提醒 / 统计 / 置顶小窗 / 计时快照）'
);
