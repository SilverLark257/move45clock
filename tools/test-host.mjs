/**
 * 宿主半边的接线测试：用一个假的 cordis ctx 调用 apply()，直接调用 HTTP 路由。
 * 不启动 DSH、不真的叫醒窗口（测试只碰 /state /plans /skip /next /reset）。
 *
 * 运行：node tools/test-host.mjs
 */
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

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

assert.equal(routes.length, 7);
const byPath = new Map(routes.map((item) => [item.path, item]));
for (const suffix of ['/state', '/plans', '/rest', '/skip', '/next', '/reset', '/wake']) {
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
assert.equal(result.json.plans.length, 13);

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

// 方法不对 → 405
result = await call('/state', 'POST');
assert.equal(result.status, 405);
assert.equal(result.json.ok, false);

// 收尾：把计时器清掉，否则进程不退出
for (const dispose of disposers.reverse()) {
  try {
    dispose();
  } catch {
    /* 忽略 */
  }
}

console.log('✅ host 接线：全部断言通过');
