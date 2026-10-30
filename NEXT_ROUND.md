# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`（第 22 轮 + 验收清单）
4. `DECISIONS.md`（重点 ADR-014 / 024～033）
5. `CHANGELOG_DEV.md`（第 22 轮）

## 当前状态（2026-10-30）

- 代码版本 **1.7.0**（**待用户完全重启 DSH 验收**）；内部包名 **`dsh-clock`**；
  公开仓库 **SilverLark257/move45clock**（`main` 仍是 v1.6.0 验收前的提交，v1.7.0 还没推）。
- v1.7.0 新增：
  1. **弹窗防 Codex UI 玻璃化**：`lib/client.js` 的 `clockCss()` 给健康钟自己的表面
     （卡片 / 完成卡 / 夜间卡 / 面板 / 幕布）的 background / border / border-radius /
     box-shadow / backdrop-filter / animation 加 `!important`，抵御 Codex UI 2.0.5
     玻璃主题对所有 `role="dialog"` 弹窗的无差别覆盖；`codex-ui-theme` 子插件已重新启用。
  2. **「你偏爱的计划类」三选一**：`settings.json` 的 `planMode` =
     `exercise` 纯运动 / `mixed` 运动+家务 / `short-long` 短短短长；默认 `short-long`。
     `short-long` 下休息时长强制跟随计划（固定分钟不生效）。
  3. **6 套 3～5 分钟短运动**（`category = 短运动`）：`short-neck` / `short-squat` /
     `short-march` / `short-stretch` / `short-wall` / `short-walk`；内置计划 16→22 套；
     `normalizeUserPlan` 按分类分档（短运动 3～5 分钟，其它 5～30 分钟）。
  4. **短短短长周期**：`clock-core.js` 的 `shortStreak` 0→1→2→3→0，第 4 次抽长计划；
     跳过也推进、试做不推进；`clock.json` 接续；`/state` 暴露 `planMode/shortStreak/
     nextBreakKind/breakKind`。
- `npm test` 7 项全绿（含 `test-client-css`：防止防玻璃化的 `!important` 被以后改样式时弄丢）；
  `test-host` 仍是 11 条路由；安装状态 active（`file:` junction）。
- **不发 npm**；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（验收 v1.7.0 + 发布）

1. 让用户**完全退出 DSH 再打开**（只刷新页面不够，宿主还是旧代码）；
2. 按 `CURRENT_STATE.md` 的「第 22 轮验收（v1.7.0）」逐条验收：
   计划类单选默认短短短长、计划库 22 套 / 短运动徽章、第一次休息是 3～5 分钟短运动、
   准备页第 1/4 次、跳过推进、玻璃主题下弹窗不透明、重启后周期接续、切换计划类生效；
3. 通过后：`git add` → commit → tag `v1.7.0` → push main + tag → GitHub Release（附件可选）；
4. 市场条目指向仓库，不需要改版本。

## 之后候选

- 语音音量 / 语速；
- 中英文（ADR-008 一直欠着）；
- 提示音开关 / 音量；
- 按「计划类」实际体验微调（短休息 3～5 分钟够不够、长休息要不要也变）；
- 按分类筛选计划（TBD-7，计划继续变多再做）。

## 绝对不要

- **不要改内部包名 `dsh-clock`**（ADR-026；改名会让 DSH 启动报 duplicate factory）。
- **不要 npm publish**（ADR-025）。
- **不要在公开 README / 文件写真实姓名、邮箱、住址、本机路径**；网页提交前先确认
  GitHub 已开 “Keep my email addresses private”。
- 不要手动改 profile 的 `dsh.profile.bundles`；需要装 / 卸用 `node tools/install.js`，先备份。
- **不要为了“点一下设置就恢复”的坑去改 Codex UI**：那是第三方插件，
  健康钟只做自己的防御（ADR-033）。

## 已知坑

- 本机 git 连 `github.com:443` 不稳定；写操作只能用户点，只读状态用 API / raw / jsDelivr。
- PowerShell 5.1 的 `.ps1` 按系统代码页读，中文一律用 base64 传参、脚本保持纯 ASCII。
- DSH 宿主改动必须**完全退出再打开**；客户端改动可 Ctrl+F5。
  v1.7.0 同时改了宿主和客户端，验收必须完全重启。
- **Codex UI 玻璃主题**：设置页「排版模式 / 材质预设 / 微光」三个控件在代码里写死
  `enabled: true`，点一下就会重新开玻璃；真正的开关是
  `localStorage['codex-ui.glass.enabled']`（界面上没有）。健康钟弹窗现在有 `!important`
  防护，玻璃开着也不会被带透明。
- 短运动计划只在 `short-long` 模式里抽；别的模式会忽略它们（不是 bug）。
- 短短短长：跳过也推进周期、试做不推进；`short-long` 下固定休息分钟被强制 0。
- 内置计划删除是 `plans.json` 的 `hidden` 软删除，不是从 `lib/plans.js` 真删；
  「恢复全部内置」会清空 `hidden`，也会清掉自建和改动。
- 计划库至少有 1 套**可见且启用**的计划；最后一套删不掉 / 停不掉。
- 统计只记自然走完的休息，长按跳过不算；只留 400 天。
- 计时只在**同一天内**接续；跨天 / clock.json 坏了会重新开始。
- 夜间提醒只在 DSH 开着时；数据在 `~/.dsh/storages/dsh-clock/`。
- 安全 tag `safe-before-voice`（v1.3.1）可回退。
- 用户沟通：先“我做了什么”，再“打个比方”；改计划 / 动业务前先确认；不要让他改代码。

## 检查命令

`npm test`；`node tools/install.js --status`；
`curl http://127.0.0.1:<当前端口>/dsh-clock/rpc/state`；
`git log --oneline -3`；`git tag -n`。
