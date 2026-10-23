# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026）
5. `CHANGELOG_DEV.md`（第 19 轮）

## 当前状态（2026-10-24）

- 版本 **1.4.0**；内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` 是 **`98ad4fe`**（本地可能多一个第 19 轮文档提交，别 force push）。
- GitHub 发布齐全：topic `dsh-plugin` / `dsh-plugin-desktop`；Release **`v1.4.0`**
  （附件 `move45clock-1.4.0.tgz`，已核对与仓库代码一致）；tag `v1.4.0` → `dfe23e0`。
- 市场目录 **已合并**：`awesome-dsh-plugin#8227` 于 2026-10-21 合并，CI 全绿；
  条目 `data/plugins/SilverLark257__move45clock.yml`（6 行，category `notify`）在官方 `main`。
  市场（dsh-market）已能搜到 **Move45clock**。
- 插件已安装、运行正常；12 套计划、工作 40 分钟、夜间提醒开；
  本机仍是 `file:` 安装（junction），不是市场安装。
- **不发 npm**（邮箱隐私，ADR-025）；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（二选一，先问用户）

1. **市场安装验收**（可选）：DSH 设置 → 插件市场搜 **Move45clock**。
   按老规矩先卸载再安装；确认 12 套计划 / 弹窗放大 / 夜间提醒 / 语音。
   注意：会替换当前 `file:` 安装；用户设置 / 计划 / 夜间记录在 storage 里，不受影响。
2. **进入候选功能**：先让用户挑一个，再动代码：
   - 今日统计 / 连续天数；
   - Windows 系统通知 / 置顶小窗；
   - 语音音量 / 语速；
   - 中英文（ADR-008 一直欠着）。

## 可选加固

- 先实测 Release 的 tarball 能装，再给条目加
  `tarball: https://github.com/SilverLark257/move45clock/releases/download/v1.4.0/move45clock-1.4.0.tgz`，
  单独提一个小 PR（固定 tag，不会烂链）。

## 绝对不要

- **不要改内部包名 `dsh-clock`**（ADR-026；改名会让 DSH 启动报 duplicate factory）。
- **不要 npm publish**（ADR-025）。
- **不要在公开 README / 文件写真实姓名、邮箱、住址、本机路径**；网页提交前先确认
  GitHub 已开 “Keep my email addresses private”（第 18 轮踩过，删 fork 重做过一次）。
- 不要手动改 profile 的 `dsh.profile.bundles`；需要装 / 卸用 `node tools/install.js`，先备份。

## 已知坑

- 本机 git 连 `github.com:443` 不稳定（`ls-remote --heads` 有时能连，`fetch --tags` 常超时）；
  GitHub 写操作只能用户点，只读状态用 API / raw / jsDelivr。
- 首次贡献者的 PR workflow 需要维护者批准（`action_required`），别当失败。
- DSH 宿主改动必须**完全退出再打开**；客户端改动可 Ctrl+F5。
- 夜间提醒只在 DSH 开着时；数据在 `~/.dsh/storages/dsh-clock/`。
- 安全 tag `safe-before-voice`（v1.3.1）可回退。
- 用户沟通：先“我做了什么”，再“打个比方”；改计划 / 动业务前先确认；不要让他改代码。

## 检查命令

`npm test`；`node tools/install.js --status`；
`curl http://127.0.0.1:<当前端口>/dsh-clock/rpc/state`；
`git log --oneline -3`；`git tag -n`。
