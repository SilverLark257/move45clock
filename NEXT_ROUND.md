# 下一轮开工指令（复制下面整段给新 Agent）

你是接手 `D:\deepseekAI\dsh-clock`「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026）
5. `CHANGELOG_DEV.md`（第 16 / 17 轮）

## 当前状态（2026-10-18）

- 版本 **1.4.0**；内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` 已推 **`af943d4`**。
- **不发 npm**（邮箱隐私，ADR-025）；只发 GitHub + `awesome-dsh-plugin` 市场目录。
- 插件已安装、运行正常；12 套计划；用户设置 / 计划 / 夜间记录都在
  `~/.dsh/storages/dsh-clock/`。
- 功能：45 分钟计时、12 套坐/站计划、计划编辑器、弹窗 100%～200%、
  夜间提醒 21:30 / 22:00 / 22:30、语音只报动作名。
- `npm test` 4 项全绿；`node tools/install.js --status` 已安装启用。
- 本地 `main` 可能比 GitHub 多一个“工作日志 / 开工指令”提交；先 `git log`，不要 force push。

## 绝对不要

- **不要改内部包名 `dsh-clock`**。曾改 `dsh-move45clock`，DSH 启动报
  `duplicate factory registration for "dsh-clock"` / `import failed`；
  已回退并恢复 profile（ADR-026）。
- **不要 npm publish**（ADR-025）。
- **不要在公开 README / 文件写真实姓名、邮箱、住址、本机路径**；用户对此很在意。
- 不要手动改 profile 的 `dsh.profile.bundles`；需要装 / 卸用
  `node tools/install.js`，先备份。

## 下一轮第一件事（发布）

1. 让用户在 GitHub 网页：
   - 仓库 **About → Topics** 加 `dsh-plugin`（市场 CI 必需）；
   - **Releases → 创建 tag `v1.4.0`**（目标 `main`；可选 attach
     `publish/move45clock-1.4.0.tgz`）。
2. 仓库创建于 **2026-10-18 约 21:20**；**满 1 天后**（10-19 21:20 后）
   向 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR：
   - 新文件：`data/plugins/SilverLark257__move45clock.yml`
   - 内容：

```yaml
url: https://github.com/SilverLark257/move45clock
name: SilverLark257/move45clock
category: ui
description:
  en: 'Move45clock: a health clock for DeepSeek Harness. A 45-minute work timer, 12 guided 12–15 minute seated/standing break plans, a visual plan editor, scalable reminder cards, 21:30/22:00/22:30 night reminders, and optional action-name voice coaching. Windows-only window wake.'
  zh: 'Move45clock · 健康钟：每工作 45 分钟弹出引导式休息卡片，内置 12 套 12～15 分钟坐/站计划；支持可视化编辑计划、弹窗放大、21:30/22:00/22:30 夜间提醒，以及可选的动作名语音播报；Windows 下可把托盘窗口叫回前台。'
```

   - PR 标题：`Add SilverLark257/move45clock`
   - CI 检查：`dsh.bundle`、仓库年龄、`dsh-plugin` topic、YAML 格式。
3. 通过后，DSH 设置 → 插件市场搜 **Move45clock** 安装。

## 之后候选

统计 / 连续天数、系统通知 / 置顶小窗、语音音量 / 语速、中英文。

## 已知坑

- 沙箱访问不了 GitHub（git/SSL）；建仓 / 推送 / PR 需要用户操作；
  只读检查可用 `web_fetch` / jsDelivr。
- DSH 宿主改动必须**完全退出再打开**；客户端改动可 Ctrl+F5。
- 夜间提醒只在 DSH 开着时；数据在 `~/.dsh/storages/dsh-clock/`。
- 安全 tag `safe-before-voice`（v1.3.1）可回退。
- 用户沟通：先“我做了什么”，再“打个比方”；改计划 / 动业务前先确认；
  不要让他手动改代码。

## 检查命令

`npm test`；`node tools/install.js --status`；
`curl http://127.0.0.1:<当前端口>/dsh-clock/rpc/state`；
`git log --oneline -3`；`git tag -n`。
