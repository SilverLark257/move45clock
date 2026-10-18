# 开发日志

> 只记"实际做了什么、发现了什么"，不写空话。每轮结束追加一条。

---

## 2026-10-18 · 第 1 轮：基建与规划（没有写业务代码）

### 做了什么

1. 扫描工作区（项目目录）：确认是空文件夹。
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
  `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<项目目录>)`。
  用 DSH 自带的"文件夹权限诊断修复"脚本处理后，给当前用户补上了缺失的写权限
  （只动权限，不动文件内容/所有者），`pwsh` 已恢复正常。
  备份与回滚记录：`<项目目录>-acl-repair`。
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

## 2026-10-18 · 第 5 轮：修「× 关闭后只弹出 DSH 窗口、不重绘卡片」

### 你反馈的

- 点右上角**最小化**：到点彩色弹窗正常；
- 点右上角 **× 关闭**：到点只弹出 DSH 窗口，还要去托盘双击图标，彩色弹窗才出现。

### 根因（两种"看不 见"不是一回事）

- **× 走的是 Electron 的 `window.hide()`**：窗口被藏起来，但 Electron 仍认为它是隐藏状态。
  Win32 的 `ShowWindow` 只是把窗口"壳子"显示出来，网页本身没有收到"你可见了"的信号，
  所以不重绘——你只能看到旧画面/空窗口。
- **托盘双击走的是 Electron 的 `window.show()`**：它会告诉网页"你可见了"，网页才重绘，
  彩色卡片这时才画出来。
- **最小化走的是 `window.minimize()`**：Win32 `ShowWindow(SW_RESTORE)` 就能让网页恢复重绘，
  所以最小化那条路一直正常。

### 修法

- `tools/wake-window.ps1`：Win32 恢复窗口之后，如果窗口原来是**隐藏或最小化**，
  再**启动一次 DSH 程序**。第二个实例会命中单实例锁、0.3 秒内退出，但会触发 Electron 的
  `second-instance` → `focusPrimaryWindow()` → `window.show() / focus()`——
  和双击托盘图标**同一条路**，网页因此真正重绘。

### 实测

- 用 `WM_CLOSE` 模拟点 ×（窗口变为 `Visible: false`）→ 脚本唤醒 → 窗口重新可见；
- 用 `ShowWindow(SW_MINIMIZE)` 模拟最小化 → 脚本唤醒 → 窗口恢复；
- 两种状态脚本都返回 `focused: true`，第二实例 0.24 秒退出。

### 待验证

- 重启 DSH 后，在 **× 关闭**状态下等 2 分钟，彩色卡片是否直接出现（而不是先看到空窗口）。

---

## 2026-10-18 · 第 6 轮：改成「模拟点击托盘图标」

### 现象

- × 关闭后，到点窗口出现，但界面像被一层玻璃盖住（点不动），彩色卡片要等托盘双击才出现。

### 排查（有截图证据）

- 截图确认：窗口可见时卡片完全正常（高抬腿 / 扩胸运动都拍到了）；
- 隐藏后由 Win32 显示，窗口只是把**最后一帧**画出来；卡片如果是在隐藏期间才渲染的，就看不到，
  但它那层透明遮罩已经挡住了鼠标——这就是"玻璃"；
- 第 5 轮试的"第二实例"路线，实测**没有把窗口显示出来**（`Visible` 仍为 false）。

### 修法

- 改用 **UI Automation 模拟点击 DSH 的托盘图标**——和你手动双击托盘**同一条代码路径**：
  Electron 的 `focusPrimaryWindow()` → `window.show()/focus()`，页面会被标记为可见并重绘。
- 图标藏在"隐藏的图标"里时，脚本先点开面板找到它；找不到就退回 Win32 + 第二实例。

### 实测

- 隐藏窗口（`Visible:false`）→ 主机 `/rest` → 脚本点托盘图标 → 0.2 秒内窗口可见
  → **彩色卡片直接出现**（截图确认："扩胸运动"）；
- 日志在 `%TEMP%\dsh-clock-wake.log`，每一步都有记录。

### 影响

- 只改了 `tools/wake-window.ps1`；宿主每次到点都会重新执行它，**不需要重启 DSH**。

---

## 2026-10-18 · 第 7 轮：验收通过 + 切回 45 分钟正式版（v1.0.0）

### 你确认的

- 点右上角**最小化**：到点彩色卡片自动弹出 ✅
- 点右上角 **×** 关闭到托盘：到点彩色卡片也能自动弹出 ✅
- 第一版核心需求全部满足。

### 做了什么

1. `lib/index.js`：`DEV_MODE = false` → **正式 45 分钟**；休息按计划自带的 10～15 分钟。
2. 版本号：`package.json` 0.2.0 → **1.0.0**；`lib/client.js` 的 `CLIENT_VERSION` → **1.0.0**。
3. 测试：`tools/test-host.mjs` 断言改为 `devMode = false` / `workSeconds = 2700`，全部通过。
4. 文档：README / CURRENT_STATE / PROJECT / DECISIONS 全部更新为"第一版完成"。
5. Git：提交并打 tag `v1.0.0`。

### 注意

- 宿主代码改动要**完全重启 DSH** 才生效；重启之前，当前进程仍是 2 分钟测试模式。
- 重启后"测试提醒"按钮会消失（`devMode = false`）；想马上看卡片，点左下角 →「现在休息一下」。
- 想再进测试模式：把 `lib/index.js` 的 `DEV_MODE` 改回 `true`，完全重启 DSH。

### 第一版复盘（给以后）

- 最难的坑不是画 UI，而是「窗口在托盘里，弹窗画在隐藏窗口里」：
  计时必须搬到宿主；唤醒必须走 Electron 自己的 `window.show()`（最终用 UI Automation 点托盘图标）。
- **Win32 `ShowWindow` ≠ Electron `show()`**：前者只画最后一帧，能看见窗口但看不见新内容；
  用户感觉就是"一层玻璃"。
- 「再启动一个 DSH」（`second-instance`）在真机上没有触发窗口显示，不能当可靠方案。
- 单文件客户端 + 宿主纯状态机 + 可注入时间源：结构简单、测试省事，后续继续用。
- UIA 点托盘依赖任务栏和图标存在；找不到时回退 Win32，日志在 `%TEMP%\dsh-clock-wake.log`。

---

## 2026-10-18 · 第 8 轮：迭代 2 · 设置页 + 12 套引导计划（v1.1.0）

### 你的需求

- 设置页要能调 **45 分钟工作时长** 和 **休息时长**；
- 一个「随机动起来~」计划库，**12 套**、合理详细、运动 12～15 分钟；
- 弹窗要显示详细运动引导：本组选了什么、10 秒后开始、**100,99,98…** 这样倒数；
- 给以后自己添加 / 修改计划留入口和时间。

### 做了什么

1. `lib/plans.js`：12 套计划（每套 12.0～14.2 分钟），用 `plan()` / `reps()` / `rest()`
   定义步骤，`totalSeconds` 自动计算；顶部写了"怎么加计划"的注释。
2. `tools/test-plans.mjs`：计划库体检（12 套、id 唯一、12～15 分钟、字段完整）。
3. `lib/clock-core.js`：改用计划自带的 `totalSeconds`；新增 `setWorkMs()` 动态改工作时长；
   `workSeconds` 写进状态（当前这一轮用旧值，下一轮用新值）。
4. `lib/index.js`：
   - 设置文件 `~/.dsh/storages/dsh-clock/settings.json`（可用 `DSH_CLOCK_SETTINGS_FILE` 覆盖，测试用）；
   - 新增 `/settings`（GET/PUT）和 `/plans`；共 8 条 exact 路由；
   - 工作时长存设置；休息时长 = 跟随计划 或 固定分钟（固定时按比例缩放节奏）。
5. `lib/client.js`：
   - **引导式卡片**：10 秒准备 → 步骤徽章 + 运动指示灯 + 大数字倒数（次数型）或读秒（休息型）
     + 步骤进度 + 下一项 + 总剩余；旧计划自动退回简单卡片；
   - **设置页**注册到 `settings.section`：工作时长、休息时长、计划库（展开 / 复制 JSON）；
   - 计划库每套带 **「试做」** 按钮：`POST /rest { planId }` 立即按指定计划开始一次休息；
   - 版本 1.1.0。
6. 测试：`test-plans` 新增；`test-host` 覆盖 `/settings` 读写、8 条路由；全部通过。

### 注意

- 宿主和客户端都改了，**必须完全退出 DSH 再打开**才生效；
- 当前这一轮工作时长不会被改写，设置从**下一轮**生效；休息时长从**下一次休息**生效。

### 待真机验收

- 设置页能否保存、重启后是否保留；
- 引导卡片的准备 10 秒、步骤切换、次数倒数、总剩余是否符合预期；
- 12 套计划里各挑一套看动作提示是否通顺。

---

## 2026-10-18 · 第 9 轮：按反馈调整计划（全坐/站，去跳跃/垫上，肩颈放慢）

### 你的反馈

- 试了一次，效果很好；
- 但要去掉**跳跃运动**和**垫上运动**，所有动作都应能**坐着或站着**完成（目标是防止久坐）；
- **脖子环绕太快**，希望减慢读秒。

### 调整

- 全库复查，删掉所有跳跃/垫上动作：
  - 开合跳 → 侧向滑步 / 原地快走；
  - 臀桥 → 站姿后抬腿；
  - 鸟狗、死虫、平板支撑、侧卧抬腿、猫牛式 → 站姿/坐姿替代；
  - 原地慢跑 → 原地快走（不跳）；
  - 跪姿髋屈肌拉伸 → 站姿大腿前侧拉伸。
- 具体：
  - 计划 2 「深蹲 + 开合跳」→「深蹲 + 侧步」（深蹲 + 侧向滑步）；
  - 计划 3 猫牛式 → 坐姿转体；**肩颈绕环 20 圈：30 秒 → 50 秒**（约 2.5 秒一圈）；
  - 计划 4 臀桥 → 站姿后抬腿；开合跳 → 侧向滑步 40 秒；
  - 计划 5 开合跳 → 侧向滑步；
  - 计划 6 整组重写为「站姿臀腿 + 椅子核心」（后抬腿/侧抬腿/坐站/提踵/站姿收腹/侧步）；
  - 计划 7 肩部绕环 30 → 45 秒；跪姿髋屈肌 → 站姿大腿前侧拉伸；
  - 计划 8 慢跑 → 快走，开合跳 → 侧向滑步（id 改 `walk-side`）；
  - 计划 10 跪姿髋屈肌 → 站姿大腿前侧拉伸；
  - 计划 12 重写为「呼吸 + 站姿核心」（坐站/站姿提膝/侧屈/收腹/侧步）。
- 全部 12 套重新体检：**12.0～14.2 分钟**，`test-plans` 通过。

### 说明

- 动作次数仍是**按时间倒数的引导**，不会检测真实动作；
- 膝盖/腰不舒服时，深蹲、弓步、靠墙静蹲可以减小幅度或跳过（长按跳过）。

## 2026-10-18 · 第 10 轮：接手体检 + 重启验收 v1.1.0 + 打 tag

### 做了什么

1. 按顺序读完 README / PROJECT / CURRENT_STATE / DECISIONS / CHANGELOG_DEV。
2. 只读体检：`npm test` 三项全过（12 套计划 / 状态机 / 宿主 8 条路由）；
   `node tools/install.js --status` 显示已安装启用；`git status` 干净。
3. 发现运行中的宿主还是第 9 轮之前的计划：宿主进程 18:57 启动，
   而第 9 轮计划 19:27 才提交，所以 `/plans` 返回的是
   `squat-jump` / `glute-birddog` / `jog-side` 等旧 id。
4. 用户完全重启 DSH 后现场核对：12 套全部为新版
   （`squat-side` / `glute-stand` / `walk-side` / `breath-core`，肩颈绕环 50 秒），
   设置仍为 45 / 跟随计划；客户端 `settings.section` 的 `dsh-clock` 也 active。
5. 文档标记 v1.1.0 验收通过，提交并打 tag `v1.1.0`。

### 发现 / 踩坑

- **只改计划文件也要完全重启**：宿主在 import 时就把 `PLANS` 读进内存了，
  页面刷新不会换计划；判断办法是看 `/plans` 返回的 id。
- 唤醒日志 19:15 / 19:20 / 19:23 三次都是 `focused=True`，托盘唤醒路径正常。
- `/settings` 在旧宿主上也能用，所以"设置页能打开"不能证明计划是新的——
  这两件事要分开看。

### 下次从哪继续

- v1.1.0 已 tag；从下一轮候选里挑：计划可视化编辑器、今日统计、系统通知/置顶、
  提示音、i18n、官方安装。

## 2026-10-18 · 第 11 轮：计划可视化编辑器 + 弹窗放大（v1.2.0）

### 你的需求

- 计划要能在设置页里自己加/改/删，不用改代码；
- 弹窗整体放大一点（近视、离开电脑做动作看不清），字、图标、倒计时等比放大。

### 做了什么

1. `lib/plans.js`：新增 `normalizeUserPlan()`（5～30 分钟、单步 1～600 秒、字段校验、
   自动生成 id），错误信息直接给用户看。
2. `lib/clock-core.js`：新增 `setPlans()`；抽不到计划时不再崩；`startRestNow(id)`
   对不存在的 id 返回 null（不再偷偷换一套）。
3. `lib/index.js`：
   - `plans.json`（overrides / custom / disabled），启动时合并成「内置 + 覆盖 + 自定义」；
   - `/plans` 支持 GET + POST（save / delete / disable / enable / restore / reset-all）；
   - 至少保留 1 套启用；
   - 设置新增 `cardScale`（1～2，默认 1.5）。
4. `lib/client.js`：
   - 设置页加「弹窗大小」滑杆（100%～200%）；
   - 计划库加新建 / 复制 / 编辑 / 停用 / 删除 / 恢复默认 / 恢复全部内置；
   - 编辑器可改名字、表情、概要、每一步的次数/秒数/提示/组数，能加/删/上下挪；
   - 弹窗用缩放外壳整体等比放大，卡片宽高按窗口反算，放不下时内部滚动。
5. 测试：计划校验、运行时换计划库、`/plans` 增删改/停用/恢复、`cardScale` 合并保存。
6. 版本 1.2.0；文档同步。

### 发现 / 踩坑

- 最初单步秒数用 `clampInt` 静默截到 600，导致「输入 1800 秒」变成 10 分钟还显示保存成功；
  已改成**明确报错**，测试也覆盖了「单步超范围」和「总时长超范围」两种。
- 弹窗缩放没有用 `zoom`（viewport 单位/布局在缩放下的行为不好控），
  而是 `transform: scale` + 渲染时按窗口反算卡片宽高，放大后仍能塞进屏幕。
- `/plans` 仍是同一条 exact 路由，只是 GET/POST 分派，路由总数保持 8 条，老测试不用改。

### 待真机验收

- 150% / 200% 时卡片是否完整、字是否清楚、内容多时是否只在卡片内部滚动；
- 新建/编辑/停用/删除/恢复默认后，下一轮随机抽取是否真的用新计划；
- 完全重启 DSH 后 `plans.json` 是否还在。

### 下次从哪继续

- 验收通过后打 v1.2.0 tag；下一轮候选：今日统计、系统通知/置顶、提示音、i18n、官方安装。

## 2026-10-18 · 第 12 轮：夜间提醒（21:30 / 22:00 / 22:30，v1.3.0）

### 你的需求

- 读取系统时间，21:30 / 22:00 / 22:30 各弹一条夜间提醒；
- 深色星空 + 小月亮，温馨宁静；
- 文案大意：21:30 距离休息还剩一小时；22:00 还有最多半小时、别熬太晚；
  22:30 子午流注、子时最该安静入睡、晚安；
- 只在 DSH 开着时提醒。

### 做了什么

1. `lib/night.js`（新）：三个时间点的标题 / 正文 / 按钮文案，`pickDueNightSlot()`
   纯函数负责"该弹哪条、补哪条、哪些已处理"；`localDayKey()` 做跨天。
2. `lib/index.js`：
   - 每秒检查一次本地时间；到点把 `activeNight` 放进 `/state`，并 `wake('night')`；
   - `night.json` 记录 `{ date, shown }`，同一天不重复；22:10 才打开只补 22:00；
   - 新增 `/night` 路由（dismiss / preview）；设置里 `nightEnabled` 可关；
   - 夜间唤窗给 PowerShell 传 `-Quiet`，不响系统提示音。
3. `tools/wake-window.ps1`：新增 `[switch]$Quiet`，夜间不播放 `SystemSounds.Exclamation`。
4. `lib/client.js`：
   - 新增 `NightCard`：深色渐变、星空、月亮、暖金色按钮，Esc 可关；
   - 浮层优先显示夜间卡片，关掉后再回到休息卡；
   - 设置页加「夜间提醒」勾选和「预览夜间提醒」按钮。
5. 测试：新增 `tools/test-night.mjs`；`test-host.mjs` 增加启动补弹、预览、关闭、开关。

### 设计取舍

- **为什么放宿主**：窗口隐藏时浏览器定时器会被节流，夜间提醒必须和休息计时一样在宿主。
- **补弹规则**：不是一次性弹三条，只补最近一条，避免 22:10 打开时被"轰炸"。
- **文案基调**：前两条是"收尾 / 洗漱"，最后一条才说"真的该睡"；不锁屏、不催促，
  给一个"再忙一会儿"的温和出口。
- **视觉**：纯 CSS 星空 + 月亮，不引图片；深靛蓝到紫的渐变，暖金色按钮，夜里不刺眼。

### 待真机验收

- 预览卡片是否好看、字够不够大、月亮/星星是否正常；
- 今晚 21:30 是否自动弹（如果 21:30 后才重启，会补最近一条）；
- 关掉开关后到点是否不再弹；预览是否仍可用；
- 同一天重启 DSH，是否不会重复弹同一条。

### 下次从哪继续

- 验收通过后打 v1.3.1 tag；下一轮候选：今日统计、系统通知/置顶、提示音、i18n、官方安装。

## 2026-10-18 · 第 12 轮补丁：月亮改为 SVG 圆形（v1.3.1）

### 问题

- 用户截图：右上角月亮是"圆角方形"。
- 原因：月亮原来是 `<div>` + `border-radius:50%`；DSH 界面把圆角渲染成超椭圆（squircle），
  50% 也被改成了圆角方形。

### 修复

- 月亮改为内联 SVG：`<circle>` + 径向渐变 + 两个小环形山 + CSS drop-shadow 光晕；
  SVG 的圆不受 `border-radius` / `corner-shape` 影响，任何主题下都是圆的。
- 顺手把两个按钮放进 `.dsh-clock-night-actions` 横排，避免在 200% 时
  「再忙一会儿」被挤到屏幕外。
- 版本 1.3.1（只改客户端；刷新页面即可看到，不必重启宿主）。

## 2026-10-18 · 第 13 轮：语音播报，只报动作名（v1.4.0）

### 你的需求

- 运动卡片弹出后，点「动起来」进入运动状态，有声音播报；
- 一开始想报动作名 + 1/2/3 读数 + 提示；
- 试听后反馈：**读数跟不上动作，放弃读数，只报动作名**，如「开始肩部环绕动作」「开始原地踏步走动作」。

### 做了什么

1. `lib/client.js`：
   - 新增 `speakText()` / `stopSpeech()` / `pickChineseVoice()` / `voiceStepIntro()`；
   - 准备页加「🔊 动起来（带语音）」，运动中底部加「🔇 关掉语音 / 🔊 开启语音」；
   - 第一版有读数（50、10、5-4-3-2-1）和提示，后按反馈**全部删掉**：
     现在只在每步开始时报动作名，休息步骤报「接下来：组间休息」，完成报一句；
   - 用 `speechSynthesis` + 系统中文语音，客户端-only；卸载时 `cancel()`；
   - 没语音能力 / 没中文语音时给提示，不阻塞动作。
2. 版本 1.4.0（`package.json` + `CLIENT_VERSION`）。
3. 用独立分支 `feature/voice` 做实验，安全 tag `safe-before-voice`；
   用户试听后说“可以”，合并回 `main`。

### 发现 / 踩坑

- 中文念一个数字约 0.5 秒，1 秒 1 个根本念不完；逐数会越积越多、和动作打架。
  改成“只在换动作时说话”后节奏立刻舒服了。
- `speechSynthesis` 需要用户手势才能稳定出声；点「动起来」正好满足；
  自动弹卡时不说话，用户点了才说。
- Windows 中文语音质量参差；没装中文语音时默认声音会读得怪，所以加了提示。
- 语音是纯前端功能，宿主和设置都没改；回退只需切回 `main`。

### 待真机验收

- 动作名和顺序是否对得上；「关掉语音」是否立刻安静；
- 换一套计划、固定休息时长下，休息步骤的报法是否自然。

### 下次从哪继续

- 发布到 GitHub + DSH 插件市场（目录：awesome-dsh-plugin）；
- 下一轮候选：语音音量/语速、统计、系统通知/置顶、i18n。

## 2026-10-18 · 第 14 轮：公共发布准备 / npm 改名 / 用户版 README（v1.4.0）

### 你的需求

- npm 要发，试试 `dsh-Move45clock` 这个名字；
- 写一份给用户看的 README：安装步骤、使用说明，语言亲切有趣可爱；
- 表明作者是完全的新手、第一次用 DeepSeek Harness 做 vibecoding；
- **绝不要填真实地址和个人信息**。

### 做了什么

1. **名字**：npm 不允许大写，`dsh-Move45clock` 不可用；改用全小写
   **`dsh-move45clock`**（查询为 404，当前空闲）；展示名仍是 Move45clock。
   `dsh-clock` 已被 npm 上的“省钱时钟”占用，不能再用。
2. **用户版 README**：新 `README.md`（亲切、可爱、新手口吻，包含安装/使用/常见问题/
   作者的话），不写真实姓名、邮箱、地址、本机路径；开发文档移到 `DEVELOPMENT.md`，
   npm 包只带用户版。
3. **匿名化**：`LICENSE` 改为 “The Move45clock authors”；
   `package.json` 作者改为 “A first-time vibecoder”；不填 repository/homepage 等真实地址。
4. **安装迁移**：先 `tools/install.js --uninstall` 移除旧名 `dsh-clock` 的 profile 项，
   改名后 `tools/install.js` 以 `dsh-move45clock` 重装；设置/计划/夜间数据不动。
5. **npm 准备**：`npm pack` 生成 `dsh-move45clock-1.4.0.tgz`（16 个文件，约 59 KB），
   `npm publish --dry-run` 通过；**但本机未登录 npm，尚未真正 publish**。
6. **测试**：`npm test` 4 项全绿。

### 发现 / 踩坑

- npm 包名规则：不能含大写；`dsh-Move45clock` 只适合做展示名。
- `npm pack` 会自动收 README*；把开发文档改名 `DEVELOPMENT.md` 后，npm 包里就只剩
  用户版 README 了。
- 改包名必须“先卸载旧名、再装新名”，否则 profile 里会同时留着旧依赖/联接。
- 沙箱访问不了 GitHub（git/SSL），GitHub 建仓/推送仍需用户操作；
  市场目录要求仓库创建满 1 天。

### 待完成

- **npm 登录**：`npm login --registry=https://registry.npmjs.org`，登录后执行
  `npm publish --registry=https://registry.npmjs.org`；
- **GitHub**：建 Public 仓库、加 `dsh-plugin` topic、推送；
- **市场**：仓库满 1 天后，向 `awesome-dsh-plugin` 提交 `data/plugins/<owner>__<repo>.yml`。

### 下次从哪继续

- 登录 npm 后发布 `dsh-move45clock@1.4.0`；
- 建 GitHub 仓库并推 `main` + `v1.4.0`；
- 准备好目录条目，明天提 PR。

## 2026-10-18 · 第 15 轮：发布方案 B —— 不发 npm，改走 GitHub 市场（v1.4.0）

### 你的决定

- 看到 npm 注册页提示“邮箱会加进包的公开元数据”，你不想公开邮箱；
- 选择 **方案 B**：不发 npm，只发 GitHub + DSH 插件市场。

### 做了什么

1. **取消 npm 发布**：
   - `package.json` 移除 `publishConfig`，避免误发；
   - 不再需要 npm 登录；`dsh-move45clock@1.4.0` 的 npm dry-run 只作为历史记录，没有真正 publish。
2. **README 安装说明改写**：
   - 只保留“DSH → 设置 → 插件市场 → 搜 Move45clock → 安装”；
   - 删掉 `dsh plugin ... add dsh-move45clock` 的 npm 命令；
   - 加一句“插件市场会直接从 GitHub 安装，不需要 npm”。
3. **发布路线**：
   - GitHub 公开仓库 + `awesome-dsh-plugin` 目录条目；
   - 仓库需 Public、创建满 1 天、`dsh.bundle`、`dsh-plugin` topic；
   - 市场条目 `data/plugins/<owner>__<repo>.yml`，CI 通过后隔天可搜。
4. **邮箱隐私**：
   - 建议 GitHub 设置里开启 “Keep my email addresses private” 并使用 noreply；
   - 本机 git 邮箱本来就是 GitHub noreply 形式；
   - 用户版 README/LICENSE/package 里没有真实姓名、邮箱、地址、本机路径。
5. **发布包**：`publish/dsh-move45clock-1.4.0.tgz` 仅作 GitHub Release 附件（可选）。

### 发现 / 踩坑

- npm 的账号邮箱会进包的 `maintainers` 公开元数据，`package.json` 里不写 email 也挡不住；
  所以“不发布 npm”是唯一能保证邮箱不进包元数据的方案。
- 市场支持 GitHub 源码安装，npm 不是必需的；只是没有下载量统计。
- 目录要求仓库满 1 天，今天建仓库、明天再提 PR。

### 下次从哪继续

- 用户建 GitHub Public 仓库、加 `dsh-plugin` topic、推送 `main` + `v1.4.0`；
- 仓库满 1 天后，向 `awesome-dsh-plugin` 提目录 PR；
- 市场审核通过后，搜 Move45clock 安装。

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
