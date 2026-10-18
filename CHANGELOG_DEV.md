# 开发日志

> 只记"实际做了什么、发现了什么"，不写空话。每轮结束追加一条。

---

## 2026-10-18 · 第 1 轮：基建与规划（没有写业务代码）

### 做了什么

1. 扫描工作区 `D:\deepseekAI\dsh-clock`：确认是空文件夹。
2. 阅读 DSH 插件开发规范，确认了几件关键事：
   - 弹窗可以放在 `shell.overlay`（DSH 自带的整框最上层浮层）；
   - 客户端插件通过 `client.js` 注册"懒加载工厂"，React 由 DSH 提供；
   - 计时器、多语言、主题都有现成接口；
   - 安装方式是用 DSH 的插件安装器装"本地文件夹包"。
3. 创建 5 个记忆文件：`README.md`、`PROJECT.md`、`CURRENT_STATE.md`、
   `CHANGELOG_DEV.md`、`DECISIONS.md`。
4. 在 `PROJECT.md` 写了大白话路线图（第 0～5 步）。
5. 在 `CURRENT_STATE.md` 记录了 3 个主要坑 + 2 个次要坑，并列出 5 个待你拍板的问题。
6. 在 `DECISIONS.md` 记录了 11 条技术决定和备选方案。

### 发现的问题

- **工作区命令行不可用（已修复）**：`pwsh` 曾报
  `SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\deepseekAI\dsh-clock)`。
  用 DSH 自带的"文件夹权限诊断修复"脚本处理后，给当前用户补上了缺失的写权限
  （只动权限，不动文件内容/所有者），`pwsh` 已恢复正常。
  备份与回滚记录：`D:\deepseekAI\dsh-clock-acl-repair`。
- 清理了临时探针文件 `_probe.txt`（验证写权限用）。
- DSH 版本为 `0.2.1-rc.2`，与网上较新的插件文档可能存在差异，后续以本机实测为准。

### 待办（第 2 轮）

- [ ] 你确认 5 个问题（或说"按推荐来"）
- [x] 修复工作区权限（已完成，`pwsh` 可正常使用）
- [ ] 搭插件外壳并安装，让它"活着"
- [ ] 决定插件包名（暂定 `dsh-clock`，界面名"健康钟"）

---

## 2026-10-18 · 第 2 轮：开工 —— 拍板 + 搭插件外壳

### 做了什么

1. 你拍板了第 1 轮留的 5 个问题：
   - 睡着的时间**算进** 45 分钟，醒来立刻弹窗；
   - 休息时长改为**约 12 个"休息计划"随机弹出**（改判 ADR-006）；
   - 关闭 DSH 再打开 = 新一轮；F5 刷新接着算；
   - 前台外提醒 = 提示音 + 任务栏闪烁，弹窗照常弹出；不做系统通知；
   - 先做 2 分钟测试版。
2. 更新 `CURRENT_STATE.md` / `DECISIONS.md`（新增 ADR-012 睡眠、ADR-013 提醒方式）。
3. 用本机现成样板核实了插件规范（比第 1 轮的文档调研更硬）：
   - `dsh-work-diary`（已在本机 DSH 桌面版跑起来的 UI 插件）：package.json 的
     `dsh.bundle.patch` / `dsh.client.platform`、`window.__ModuleLoader__.load({id, factory})`、
     `require('react')`、`ctx.slots.inject/register` 的真实写法、junction 安装脚本；
   - `dsh-theme-pack/tools/_reference/ui-layout-0.2.0-client.js`（DSH 0.2.0 源码参考）：
     `shell.overlay` 确为 `{ kind: 'list', scope: 'root' }`，在 AppFrame 最上层渲染。
4. 写好了插件全部代码并 `node --check` 通过：
   - `package.json` / `cordis.patch.yml` / `lib/index.js`（宿主半边保持最小，ADR-009）/
     `lib/client.js`（计时 + 弹窗 + 声音 + 闪烁 + 13 个休息计划，DEV_MODE = 工作 2 分钟、休息 20 秒）/
     `tools/install.js`（裁剪自 work-diary）/ `icon.svg`。
5. 安装进 desktop profile：`node tools/install.js` 成功（依赖 + bundles + junction 齐备，
   package.json 与 pnpm-lock.yaml 均已自动备份）。
6. 应你要求写好 `.gitignore` + `.gitattributes`，准备入 git 仓库。

### 发现 / 踩坑

- **改动宿主半边或新装插件都必须「完全退出再重启 DSH」**（work-diary 实测结论；
  dsh-hmr 默认不监听源码模块）。所以本插件装好后的第一次验收必须重启一次。
- ADR-009 实际落地时目录结构改成了 `lib/index.js` + `lib/client.js`（照 work-diary 样板，
  比根目录平铺更整齐），不改功能。
- `ctx.timer` / `ctx.locale` 没有在本机样板里找到真实用例，本版直接用
  `setInterval` + `ctx.effect` 清理（work-diary 同款做法，已验证）；中英双语留到第 5 步
  再接 `ctx.locale`，本版先中文（文案集中、随时可抽）。
- 探索子代理两度不可用（deepseek-flash 配置报错 / 主模型 5 小时额度打满），
  本轮全部调研由主会话直接完成。

### 下次从哪继续

1. 你 `git init` 入库；
2. **完全退出并重启 DSH**（或让我帮你重启）；
3. 验收：左下角出现 🐣 倒计时 → 2 分钟后弹休息卡片 → 20 秒倒计时走完 →
   「开始下一轮」归零重来；
4. 都通了就把 `lib/client.js` 的 `DEV_MODE` 改为 `false`（45 分钟正式版），重启再验。

## 2026-10-18 · 第 3 轮：检查 Kimi K3 的成果 + 修文档 + 建 Git 仓库

### 做了什么

1. 逐项核对第 2 轮代码（**没有重写业务代码**）：
   - `node --check` 对 `lib/client.js` / `lib/index.js` / `tools/install.js` 全部通过；
   - 用 DSH 的插槽检查接口确认 `shell.overlay` 与 `sidebar.footer.action` 里
     `dsh-clock` 都已注册且 `active`；
   - 读了 `lib/client.js` 全文：计时（deadline）、持久化、单例守卫、卸载清理、
     提示音、标题闪烁、长按跳过，逻辑自洽；
   - 对照 `ui-layout` 源码确认 `shell.overlay` 的 `pointer-events` 规则：
     浮层本身 `none`、直接子元素 `auto`，所以幕布能挡住并接收点击（不会穿透）。
2. 修文档（不改代码）：
   - `README.md`：状态、安装命令、验收步骤、已知限制全部更新；
   - `CURRENT_STATE.md`：状态表、下一步、坑 2 的"任务栏闪烁"表述、第 3 轮检查清单；
   - `PROJECT.md`：路线图第 0～5 步打上进度；
   - `DECISIONS.md`：ADR-004 字段名、ADR-009 目录结构、ADR-013 表述、ADR-008 进度，
     新增 ADR-014（安装方式与 lockfile 风险）。
3. Git：确认 `.gitignore` / `.gitattributes` 本身没问题（在临时副本里
   `git init` → `git add` → `git commit` 全部成功，只有 CRLF 提示）；
   原文件夹里其实**没有 `.git`**。已在项目里 `git init -b main` 并做首次提交。

### 发现（需要你决定，本轮没动代码）

- `DEV_MODE = true`：仍是 2 分钟工作 / 20 秒休息，验收后必须改回 `false`；
- 左下角入口按钮 `onClick` 是空函数（点了没反应）；
- 休息中的"我休息好啦"永远灰着，到点直接换成"开始下一轮"卡片（和原设计不一致）；
- 多窗口没有互斥；中英文还没做；
- 安装绕过官方插件管理器，`pnpm-lock.yaml` 里没有本包记录（风险见 ADR-014）。

### 下次从哪继续

1. 重启 DSH 人工验收（2 分钟 → 卡片 → 20 秒 → 开始下一轮）；
2. 通过后：`DEV_MODE = false`，修左下角按钮与"我休息好啦"的交互；
3. 补 i18n、设置项、多窗口互斥（第 5 步）。

---

## 2026-10-18 · 第 4 轮：定位「托盘不弹窗」并改架构

### 你反馈的

- 重启后把 DSH 最小化到托盘，到点**完全没有弹窗**；希望只要 DSH 没关闭，不管在玩什么都弹；
- 左下角要能点开看详情，并预留以后加小功能的入口。

### 根因

- 计时原来在浏览器：窗口隐藏后定时器被 Chromium 节流，到点不一定执行；
- 弹窗画在**隐藏的 DSH 窗口**里：窗口不出现，卡片画得再好也看不见。

### 做了什么

1. 新增 `lib/clock-core.js`：纯计时状态机（工作 → 休息 → 完成 → 下一轮，可注入时间源）。
2. 重写 `lib/index.js`：计时搬到宿主；7 条 HTTP exact 路由（`/state` `/plans` `/rest`
   `/skip` `/next` `/reset` `/wake`）；到点调用唤醒脚本。
3. 新增 `tools/wake-window.ps1`：`EnumWindows` 找 DSH 窗口 →
   `ShowWindow` / `SetForegroundWindow`（Alt 绕过前台限制）/ `FlashWindowEx` / 系统提示音。
   纯 ASCII，PowerShell 5.1 和 7 都能跑。
4. 重写 `lib/client.js`：改成每 2 秒轮询 `/state`；保留卡片、提示音、标题闪烁；
   左下角入口改为可点开的详情面板（状态 / 剩余 / 下次提醒 / 今日完成 / 计划 + 动作按钮
   + 「统计 / 自定义计划 / 提示音」预留入口）。
5. 新增测试：`tools/test-clock.mjs`（状态机）、`tools/test-host.mjs`（7 条路由接线）。
6. `package.json` 升到 0.2.0，`files` 加入 `tools`，新增 `test:clock` 脚本。
7. 文档同步：README / CURRENT_STATE / DECISIONS（ADR-003 改判，新增 ADR-015～018）/ PROJECT。

### 实测

- 唤醒脚本对**最小化**的 DSH 窗口执行，返回 `focused: true`——窗口被恢复并置前；
- `node --check`：`lib/client.js`、`lib/index.js`、`lib/clock-core.js`、两个测试文件全部通过；
- `node tools/test-clock.mjs`、`node tools/test-host.mjs`：全部断言通过。

### 还没验证（必须重启 DSH）

- 宿主进程里真实加载（计时、路由注册、`execFile` 调 PowerShell）；
- 浏览器轮询 / 卡片 / 详情面板的真机表现；
- 托盘**隐藏**（不是最小化）时 `ShowWindow` 是否有效；
- 独占全屏游戏里 `SetForegroundWindow` 是否被 Windows 拒绝。

### 下次从哪继续

1. 完全重启 DSH，按 `CURRENT_STATE.md` 的 7 步验收（重点：最小化后窗口会不会自己弹出）；
2. 通过后 `DEV_MODE = false`（45 分钟），提交 Git；
3. 视情况加系统通知 / 置顶小窗、i18n、设置项。

---

<!--
以后每轮照这个格式追加：

## YYYY-MM-DD · 第 N 轮：<主题>

### 做了什么
- ...

### 发现 / 踩坑
- ...

### 下次从哪继续
- ...
-->
