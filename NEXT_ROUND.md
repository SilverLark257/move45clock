# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026 / 027 / 028 / 029）
5. `CHANGELOG_DEV.md`（第 20 轮 + 补丁）

## 当前状态（2026-10-24）

- 版本 **1.5.0**（已验收并发布）；内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` = **`d076597`**，tag `v1.5.0`，Release `v1.5.0` 已发布。
- v1.5.0 新增：**今日统计 / 连续天数**（`stats.json` + 面板）、
  **到点置顶小窗**（可开关 / 预览；点「打开健康钟」会叫回 DSH 并打开面板）、
  **重启接续**（`clock.json`，同一天内退出再打开接着上次的倒计时）。
- `npm test` 6 项全绿；`test-host` 11 条路由（含 `/panel`）；安装状态 active（`file:` junction）。
- GitHub 发布：topic 已加；Release `v1.4.0` + `v1.5.0`；目录 PR #8227 已合并，
  市场可搜到 Move45clock（指向仓库 main，新装会拿到 1.5.0）。
- **验收记录（2026-10-24）**：统计面板 / 置顶小窗（打开健康钟）/ 重启接续均通过。
- **不发 npm**；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（选候选功能）

v1.5.0 已发布：main `d076597` / tag `v1.5.0` / Release `v1.5.0`；
远端 `package.json` 已是 `1.5.0`；市场条目指向仓库，不需要改版本。

1. 先让用户在候选中挑一个（语音音量 / 语速、中英文、提示音开关、独占全屏兜底）；
2. 改前先用大白话讲清楚“会看到什么”，改完 `npm test` + 重启验收；
3. 版本按改动大小升 `1.5.x` 或 `1.6.0`；
4. 可选：目录条目描述补“统计 / 置顶小窗 / 重启接续”，另提一个小 PR。

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
