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

// 用临时设置文件，避免影响（也避免被）真实用户设置影响。
const settingsFile = path.join(os.tmpdir(), `dsh-clock-test-settings-${process.pid}.json`);
fs.rmSync(settingsFile, { force: true });
process.env.DSH_CLOCK_SETTINGS_FILE = settingsFile;

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

assert.equal(routes.length, 8);
const byPath = new Map(routes.map((item) => [item.path, item]));
for (const suffix of ['/state', '/plans', '/settings', '/rest', '/skip', '/next', '/reset', '/wake']) {
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

async function callPut(suffix, body) {
  const route = byPath.get(`/dsh-clock/rpc${suffix}`);
  const res = makeRes();
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'PUT';
  await route.handler(req, res);
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
}

// GET /state
let result = await call('/state');
if (result.status !== 200) console.error('state failed:', result);
assert.equal(result.status, 200);
assert.equal(result.json.ok, true);
assert.equal(result.json.state.phase, 'work');
assert.equal(result.json.state.devMode, false);
assert.equal(result.json.state.workSeconds, 2700);
assert.equal(typeof result.json.state.deadline, 'number');

// GET /plans
result = await call('/plans');
assert.equal(result.json.plans.length, 12);

// GET /settings（默认值）
result = await call('/settings');
assert.equal(result.json.settings.workMinutes, 45);
assert.equal(result.json.settings.restMinutes, 0);

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
// 当前这一轮不被打断（仍按旧的 45 分钟），设置里的 25 分钟下一轮生效
assert.equal(result.json.state.workSeconds, 2700);
assert.equal(result.json.state.settings.workMinutes, 25);
assert.ok(fs.existsSync(settingsFile), '设置文件应已写入');

// 重置后，新一轮按 25 分钟开始
result = await call('/reset', 'POST');
assert.equal(result.json.state.workSeconds, 1500);

// PUT /settings：越界值会被夹到合法范围
result = await callPut('/settings', { workMinutes: 999, restMinutes: 1 });
assert.equal(result.json.settings.workMinutes, 120);
assert.equal(result.json.settings.restMinutes, 5);

// 方法不对 → 405
result = await call('/state', 'POST');
assert.equal(result.status, 405);
assert.equal(result.json.ok, false);

// 收尾：清掉计时器；删除临时设置
for (const dispose of disposers.reverse()) {
  try {
    dispose();
  } catch {
    /* 忽略 */
  }
}
fs.rmSync(settingsFile, { force: true });

console.log('✅ host 接线：全部断言通过');
