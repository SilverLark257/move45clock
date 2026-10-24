# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026 / 027 / 028 / 029）
5. `CHANGELOG_DEV.md`（第 20 轮 + 补丁）

## 当前状态（2026-10-24）

- 版本 **1.5.0**；内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` 是 **`98ad4fe`**（本地领先：v1.5.0 代码 + 第 19/20 轮文档，别 force push）。
- v1.5.0 新增：**今日统计 / 连续天数**（`lib/stats.js` + `stats.json` + 面板）、
  **到点置顶小窗**（`tools/notify-window.ps1`，设置页可开关 / 预览，按钮已重做）、
  **重启接续**（`clock.json` 快照，同一天内退出再打开接着上次的倒计时）。
- `npm test` 6 项全绿；`test-host` 10 条路由；安装状态 active（`file:` junction）。
- GitHub 发布：topic 已加；Release `v1.4.0`；目录 PR #8227 已合并，市场可搜到 Move45clock。
- **v1.5.0 还没重启验收**：宿主和客户端都改了，必须**完全退出 DSH 再打开**。
- **不发 npm**；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（验收 v1.5.0）

让用户完全退出 DSH（托盘右键退出）再打开，然后：

1. 设置 → 健康钟：看到「到点时显示置顶小窗」勾选 +「预览小窗」；
   点预览：右下角出现小窗，不抢焦点，25 秒自动消失；
2. 点左下角 🐣：面板出现「今天完成 / 连续天数 / 最近 7 天」；
3. 试做一套计划并让它**自然走完**（或等一次正式休息）：
   面板今天 +1、完成卡片出现「今天第 N 次 · 连续 D 天」；
4. 工作时退出 DSH 再开：剩余时间应接着走（`clock.json`），不是重新 45 分钟；
5. 完全重启 DSH：统计还在（`stats.json`），倒计时也接续；
6. 有问题：先看 `%TEMP%` 下 PowerShell 报错 / 宿主日志；
   小窗脚本可单独跑：`powershell -File tools/notify-window.ps1 -Seconds 3`（不带文字也能显示空白窗）。

验收通过后：`git tag v1.5.0` + GitHub Release（附件可选）+ push（网络允许时）；
目录条目描述可补“统计 / 置顶小窗”，另提一个小 PR（可选）。

## 之后候选

- 语音音量 / 语速；
- 中英文（ADR-008 一直欠着）；
- 提示音开关 / 音量；
- 独占全屏游戏的兜底（系统级限制，需评估系统通知）。

## 绝对不要

- **不要改内部包名 `dsh-clock`**（ADR-026；改名会让 DSH 启动报 duplicate factory）。
- **不要 npm publish**（ADR-025）。
- **不要在公开 README / 文件写真实姓名、邮箱、住址、本机路径**；网页提交前先确认
  GitHub 已开 “Keep my email addresses private”。
- 不要手动改 profile 的 `dsh.profile.bundles`；需要装 / 卸用 `node tools/install.js`，先备份。

## 已知坑

- 本机 git 连 `github.com:443` 不稳定；写操作只能用户点，只读状态用 API / raw / jsDelivr。
- PowerShell 5.1 的 `.ps1` 按系统代码页读，中文一律用 base64 传参、脚本保持纯 ASCII。
- DSH 宿主改动必须**完全退出再打开**；客户端改动可 Ctrl+F5。
- 统计只记自然走完的休息，长按跳过不算；只留 400 天。
- 计时只在**同一天内**接续；跨天 / clock.json 坏了会重新开始。
- 夜间提醒只在 DSH 开着时；数据在 `~/.dsh/storages/dsh-clock/`。
- 安全 tag `safe-before-voice`（v1.3.1）可回退。
- 用户沟通：先“我做了什么”，再“打个比方”；改计划 / 动业务前先确认；不要让他改代码。

## 检查命令

`npm test`；`node tools/install.js --status`；
`curl http://127.0.0.1:<当前端口>/dsh-clock/rpc/state`；
`git log --oneline -3`；`git tag -n`。
