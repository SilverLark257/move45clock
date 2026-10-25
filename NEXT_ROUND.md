# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026 / 027 / 028 / 029）
5. `CHANGELOG_DEV.md`（第 20 轮 + 补丁）

## 当前状态（2026-10-25）

- 代码版本 **1.6.0**（**待用户完全重启 DSH 验收**，还没提交 / 打 tag / 推送）；
  内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` 仍是 `d076597`（v1.5.0），tag / Release 最新是 `v1.5.0`。
- v1.6.0 新增：
  1. **计划删除 / 恢复**：每套计划右侧常驻「删除」；内置计划软删除（`plans.json` 的 `hidden`），
     列表和随机池消失，计划库下方「已删除的内置计划」可单套 / 全部恢复；
     自己建的计划真删；至少保留 1 套可见、启用中的计划；
  2. **4 套「家务休闲」**：擦桌子 12.0 / 拖地 12.6 / 整理衣服 12.0 / 洗衣 12.6 分钟，
     `category = 家务休闲`，绿色徽章，和运动计划一起随机。
- 内置计划从 12 套扩到 **16 套**；`npm test` 6 项全绿；
  `test-host` 11 条路由；安装状态 active（`file:` junction）。
- **旧验收（2026-10-24）**：统计面板 / 置顶小窗 / 重启接续均通过。
- **不发 npm**；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（验收 v1.6.0 + 发布）

1. 让用户**完全退出 DSH 再打开**（只刷新页面不够，宿主还是旧代码）；
2. 按 `CURRENT_STATE.md` 的「第 21 轮验收（v1.6.0）」逐条验收：
   16 套 / 4 个绿色家务徽章 / 删除 / 恢复 / 全部恢复 / 自建真删 / 最后一套保护 / 试做家务 / 重启后还在；
3. 通过后：`git add` → commit → tag `v1.6.0` → push main + tag → GitHub Release（附件可选）；
4. 市场条目指向仓库，不需要改版本；可选：目录描述补“家务休闲 / 计划删除”。

## 之后候选

- 语音音量 / 语速；
- 中英文（ADR-008 一直欠着）；
- 提示音开关 / 音量；
- 独占全屏游戏的兜底（系统级限制，需评估系统通知）；
- 按分类筛选计划（TBD-7，计划继续变多再做）。

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
  v1.6.0 同时改了宿主和客户端，验收必须完全重启。
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
