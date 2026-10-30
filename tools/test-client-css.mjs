/**
 * 客户端 CSS 静态体检：防止「防 Codex UI 玻璃化」的 !important 被以后的样式编辑弄丢。
 * 运行：node tools/test-client-css.mjs
 *
 * 背景：Codex UI 2.0.5 的玻璃主题会把所有 role="dialog" 弹窗改成半透明
 * （选择器不带 !important）。健康钟靠自己的 !important 抢回外观，
 * 所以这些声明是「有意的、不能顺手删掉」的。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const match = source.match(/function clockCss\(\) \{\s*return \[([\s\S]*?)\]\.join\(''\);/);
assert.ok(match, '找不到 clockCss()');
const css = Function('return [' + match[1] + "].join('');")();

/** 取出某条选择器的声明块（本项目的 clockCss 是拼接字符串，选择器基本一行一条）。 */
function block(selector) {
  const index = css.indexOf(selector + '{');
  assert.ok(index >= 0, `缺少选择器 ${selector}`);
  const end = css.indexOf('}', index);
  return css.slice(index, end);
}

function expectAll(text, label, list) {
  for (const piece of list) {
    assert.ok(text.includes(piece), `${label} 缺少 ${piece}`);
  }
}

// 1. 弹窗主卡片：背景 / 边框 / 圆角 / 阴影 / 去 backdrop-filter 都要抢回来。
const card = block('.dsh-clock-card');
expectAll(card, '.dsh-clock-card', [
  'background:#fff6e5 !important',
  'border:3px solid #ffd9a0 !important',
  'border-radius:24px !important',
  'box-shadow:0 18px 60px rgba(120,60,0,.35) !important',
  'backdrop-filter:none !important',
  '-webkit-backdrop-filter:none !important'
]);

// 2. 弹入动画不能被玻璃的 dsh-glass-dialog-in 顶掉。
assert.ok(
  block('.dsh-clock-pop').includes('animation:dsh-clock-pop .45s cubic-bezier(.34,1.56,.64,1) both !important'),
  '.dsh-clock-pop 的动画要加 !important'
);

// 3. 夜间卡片。
expectAll(block('.dsh-clock-night-card'), '.dsh-clock-night-card', [
  'border-radius:28px !important',
  'background:linear-gradient(165deg,#0a1130 0%,#131c44 48%,#241b45 100%) !important',
  'animation:dsh-clock-night-in .6s ease-out both !important'
]);

// 4. 左下角面板 / 幕布。
expectAll(block('.dsh-clock-panel'), '.dsh-clock-panel', [
  'background:#fff6e5 !important',
  'border:2px solid #ffd9a0 !important',
  'border-radius:18px !important'
]);
expectAll(block('.dsh-clock-backdrop'), '.dsh-clock-backdrop', [
  'background:rgba(24,18,10,.55) !important',
  'backdrop-filter:blur(2px) !important'
]);

// 5. v1.7.0 新增的界面元素也要在。
for (const selector of [
  '.dsh-clock-cycle',
  '.dsh-clock-plan-badge.is-short',
  '.dsh-clock-settings-radio',
  '.dsh-clock-settings-radios'
]) {
  assert.ok(css.includes(selector + '{'), `缺少新样式 ${selector}`);
}

// 6. 客户端版本 / 计划类常量。
assert.ok(source.includes("const CLIENT_VERSION = '1.7.0';"), 'CLIENT_VERSION 应为 1.7.0');
for (const mode of ['exercise', 'mixed', 'short-long']) {
  assert.ok(source.includes(`value: '${mode}'`), `缺少计划类选项 ${mode}`);
}
assert.ok(source.includes("const DEFAULT_PLAN_MODE = 'short-long';"), '默认计划类应为 short-long');
// 试做（cycleCounted=false）时不显示「第 N/4 次」
assert.ok(source.includes('props.cycleCounted !== false'), '试做时不应显示周期小字');

console.log('✅ client-css: 防玻璃化 !important / 新界面元素 / 版本与计划类常量都在');
