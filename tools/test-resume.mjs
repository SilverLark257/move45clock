/**
 * 重启接续测试：预写一份“今天、还剩 2 分钟”的 clock.json，再启动宿主，
 * 确认 /state 接着上次的 deadline，而不是重新开 45 分钟。
 *
 * 运行：node tools/test-resume.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localDayKey } from '../lib/night.js';

const suffix = `${process.pid}-${Date.now()}`;
const tmp = (name) => path.join(os.tmpdir(), `dsh-clock-resume-${name}-${suffix}.json`);

const settingsFile = tmp('settings');
const plansFile = tmp('plans');
const nightFile = tmp('night');
const statsFile = tmp('stats');
const clockFile = tmp('clock');
for (const file of [settingsFile, plansFile, nightFile, statsFile, clockFile]) {
  fs.rmSync(file, { force: true });
}

process.env.DSH_CLOCK_SETTINGS_FILE = settingsFile;
process.env.DSH_CLOCK_PLANS_FILE = plansFile;
process.env.DSH_CLOCK_NIGHT_FILE = nightFile;
process.env.DSH_CLOCK_STATS_FILE = statsFile;
process.env.DSH_CLOCK_CLOCK_FILE = clockFile;
process.env.DSH_CLOCK_NO_WAKE = '1';
process.env.DSH_CLOCK_NIGHT_NOW = '2026-10-18T10:00:00+08:00'; // 不在夜间提醒时段

// 预写：今天、工作阶段、还剩 2 分钟、今天已完成 2 次
const now = Date.now();
const deadline = now + 120_000;
const savedState = {
  version: 3,
  phase: 'work',
  startedAt: now - 60_000,
  deadline,
  workSeconds: 180,
  plan: null,
  restSeconds: 0,
  lastPlanId: null,
  doneCount: 2,
  skipped: false
};
fs.writeFileSync(
  clockFile,
  JSON.stringify({ version: 1, day: localDayKey(), savedAt: now, state: savedState }, null, 2),
  'utf8'
);

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

const byPath = new Map(routes.map((item) => [item.path, item]));
function makeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body ?? '';
    }
  };
}
async function call(suffixPath, method = 'GET') {
  const route = byPath.get(`/dsh-clock/rpc${suffixPath}`);
  const res = makeRes();
  await route.handler({ method }, res);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

// 启动后应接续：还是工作阶段，deadline 是我们预写的那个
let result = await call('/state');
assert.equal(result.status, 200);
assert.equal(result.json.state.phase, 'work');
assert.equal(result.json.state.workSeconds, 180, '应保留上次的 3 分钟工作轮次');
assert.equal(result.json.state.deadline, deadline, 'deadline 应原样接上，而不是重新算 45 分钟');
assert.equal(result.json.state.doneCount, 2, '今天完成次数应接上');

// 落盘文件应被规范化后写回
const onDisk = JSON.parse(fs.readFileSync(clockFile, 'utf8'));
assert.equal(onDisk.version, 1);
assert.equal(onDisk.day, localDayKey());
assert.equal(onDisk.state.deadline, deadline);

// 「重新计时」后快照更新为新的工作轮
result = await call('/reset', 'POST');
assert.equal(result.status, 200);
const afterReset = JSON.parse(fs.readFileSync(clockFile, 'utf8'));
assert.equal(afterReset.state.phase, 'work');
assert.ok(afterReset.state.deadline > now, '重新计时后 deadline 应在未来');

for (const dispose of disposers.reverse()) {
  try {
    dispose();
  } catch {
    /* 忽略 */
  }
}
for (const file of [settingsFile, plansFile, nightFile, statsFile, clockFile]) {
  fs.rmSync(file, { force: true });
}

console.log('✅ resume: 同一天重启能接着上次的倒计时（工作 / 剩余时间 / 完成次数）');
