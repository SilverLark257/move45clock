# 发布到 GitHub + DSH 插件市场（方案 B，不发 npm）

> 目标：让「Move45clock · 健康钟」出现在 DSH 的 **设置 → 插件市场**，别人一键安装。
>
> **不发 npm**：npm 会把账号邮箱写进包的公开元数据，作者不希望公开邮箱。
> 插件市场支持从 GitHub 公开仓库安装，效果一样。

---

## 现在的状态（2026-10-20）

- 内部包名：`dsh-clock`（安装名）；公开仓库 / 展示名：`move45clock` / **Move45clock**；
- 用户版 `README.md` 已写好，安装说明只写“插件市场搜索 Move45clock”，不再教 npm 命令；
- 发布包 `publish/move45clock-1.4.0.tgz` 已作为 Release 附件上传，并逐文件核对与仓库代码一致；
- 仓库已加 topic `dsh-plugin` / `dsh-plugin-desktop`；Release `v1.4.0` 已发布；
- 目录 PR **#8227** 已提交（`data/plugins/SilverLark257__move45clock.yml`，category `notify`），
  CI 当前是 `action_required`——首次贡献者需要维护者批准，不是失败；
- 这台机器的 git 连不上 `github.com:443`，写操作（建仓 / 推送 / 提 PR）需要你操作。

---

## 第 1 步：建 GitHub 仓库

1. 打开 GitHub 的“新建仓库”页面；
2. 名字建议 **`move45clock`**（和你正在建的这个仓库一致；插件内部包名是 `dsh-clock`，不用改）；
3. 选 **Public**；
4. 不要勾 README / .gitignore / license（本地已有）；
5. 创建后加 topic：**`dsh-plugin`**。

> 建议在 GitHub 设置 → Emails 里勾选 **Keep my email addresses private**，
> 并用 `noreply` 地址提交；这样公开的提交记录里不会出现真实邮箱。

---

## 第 2 步：推本地仓库

用 GitHub Desktop：Add Local Repository → 选 `<本地项目目录>` → Publish repository → 取消 private。

或者命令行（把尖括号换成你的）：

```powershell
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main --tags
```

---

## 第 3 步：建 Release（✅ 2026-10-20 已完成）

tag 选 `v1.4.0`，target `main`，附件上传 `publish/move45clock-1.4.0.tgz`。

> 有 Release 附件时，市场可以优先给预构建包；没有也能从 GitHub 源码安装。
>
> 注意：GitHub 上创建的 tag 指向当前 `main`（`dfe23e0`），本地 tag 已对齐到同一个提交。

---

## 第 4 步：提交市场目录（✅ 2026-10-20 已提交 PR #8227）

市场（dsh-market）读的是社区目录 **awesome-dsh-plugin/awesome-dsh-plugin**。

实际走的流程：

1. Fork 目录仓库 `awesome-dsh-plugin/awesome-dsh-plugin`；
2. 新建 `data/plugins/SilverLark257__move45clock.yml`（内容见 `publish/catalog-entry.yml`）；
3. 网页提交 → Contribute → Open pull request；
4. PR 标题：`Add SilverLark257/move45clock`；
5. PR #8227 已开：+6/−0，1 个文件；CI run 状态 `action_required`（首次贡献者，
   要维护者点 “Approve and run”，不是失败）；
6. 维护者合并后，`main` 自动重新生成 README；市场隔天能搜到。

> 硬规则：仓库 Public、创建满 1 天、`package.json` 有 `dsh.bundle`、加 `dsh-plugin` topic、
> 有真实可用的代码。一个 PR 最多 1～3 条。
>
> 分类用 `notify`：同类的健康提醒插件（sorawithcat/dsh-health-reminder）就在这一类，
> 投稿规则要求按“实际做什么”选，而不是按界面形式。

---

## 第 5 步：发布后验证

1. DSH → 设置 → 插件市场 → 搜 **Move45clock**；
2. 看条目是否打开、安装按钮是否可用；
3. 在一个干净 profile 里装一次，确认左下角出现 🐣；
4. 试做一套计划 + 预览夜间提醒 + 点一次语音。

---

## 不写进公开仓库的东西

- 真实姓名、邮箱、住址、电话（**网页提交也算**：先开 GitHub 的
  “Keep my email addresses private”，否则账号主邮箱会写进公开提交历史）；
- 本机绝对路径、Windows 用户名；
- npm / GitHub 的 token、密码；
- 私人截图。

用户版 README 和 package / LICENSE 已按这个原则处理：作者写成
“A first-time vibecoder”，LICENSE 写成 “The Move45clock authors”。
