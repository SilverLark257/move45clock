# 下一轮开工指令（复制下面整段给新 Agent）

你是接手「Move45clock · 健康钟」DSH 插件的下一位 Agent。用户完全不懂编程，请用大白话沟通。

## 先按顺序读

1. `README.md`（用户版）
2. `DEVELOPMENT.md`（开发版）
3. `CURRENT_STATE.md`
4. `DECISIONS.md`（重点 ADR-014 / 024 / 025 / 026）
5. `CHANGELOG_DEV.md`（第 18 轮）

## 当前状态（2026-10-20）

- 版本 **1.4.0**；内部包名 **`dsh-clock`**；公开仓库 **`SilverLark257/move45clock`**；
  GitHub `main` 是 **`dfe23e0`**（本地可能多一个第 18 轮文档提交，别 force push）。
- GitHub 发布已补齐：topic `dsh-plugin` / `dsh-plugin-desktop`；Release **`v1.4.0`**
  （附件 `move45clock-1.4.0.tgz`，已核对与仓库代码一致）；本地 tag 已对齐 `dfe23e0`。
- 市场目录 PR **`awesome-dsh-plugin#8227`** 已开：
  `data/plugins/SilverLark257__move45clock.yml`，6 行，category `notify`，+6/−0。
  CI run 目前是 **`action_required`**——首次贡献者的 workflow 要维护者点
  “Approve and run”，**不是失败**。
- 插件已安装、运行正常；12 套计划、工作 40 分钟、弹窗 120%、夜间提醒开。
- **不发 npm**（邮箱隐私，ADR-025）；公开信息里不写真实姓名 / 邮箱 / 住址 / 本机路径。

## 下一轮第一件事（发布收尾）

1. 查 PR #8227（只读）：
   - 仍 `action_required`：说明还在等维护者批准，隔天再看；
   - CI 红：按报错只改 `data/plugins/SilverLark257__move45clock.yml`，在 fork 的
     `main` 上提交，PR 会自动更新；不要手改生成的 README；
   - 已合并：目录由 `main` 自动重新生成，市场隔天可搜到。
2. 合并后：DSH 设置 → 插件市场搜 **Move45clock** 安装（按老规矩：先卸载再安装），
   验收 12 套计划 / 弹窗放大 / 夜间提醒 / 语音。
3. 可选加固：先实测 Release 的 tarball 能装，再给条目加
   `tarball: https://github.com/SilverLark257/move45clock/releases/download/v1.4.0/move45clock-1.4.0.tgz`，
   单独提一个小 PR。

## 之后候选

统计 / 连续天数、系统通知 / 置顶小窗、语音音量 / 语速、中英文。

## 绝对不要

- **不要改内部包名 `dsh-clock`**（ADR-026；改名会让 DSH 启动报 duplicate factory）。
- **不要 npm publish**（ADR-025）。
- **不要在公开 README / 文件写真实姓名、邮箱、住址、本机路径**；网页提交前先确认
  GitHub 已开 “Keep my email addresses private”（第 18 轮踩过，删 fork 重做过一次）。
- 不要手动改 profile 的 `dsh.profile.bundles`；需要装 / 卸用 `node tools/install.js`，先备份。

## 已知坑

- 本机 git 连不上 `github.com:443`；topic / Release / fork / PR 等写操作只能用户点，
  只读状态用 GitHub API / raw / jsDelivr。
- 首次贡献者的 PR workflow 需要维护者批准（`action_required`），别当失败。
- DSH 宿主改动必须**完全退出再打开**；客户端改动可 Ctrl+F5。
- 夜间提醒只在 DSH 开着时；数据在 `~/.dsh/storages/dsh-clock/`。
- 安全 tag `safe-before-voice`（v1.3.1）可回退。
- 用户沟通：先“我做了什么”，再“打个比方”；改计划 / 动业务前先确认；不要让他改代码。

## 检查命令

`npm test`；`node tools/install.js --status`；
`curl http://127.0.0.1:<当前端口>/dsh-clock/rpc/state`；
`git log --oneline -3`；`git tag -n`。
