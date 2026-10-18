# 发布到 GitHub + DSH 插件市场（方案 B，不发 npm）

> 目标：让「Move45clock · 健康钟」出现在 DSH 的 **设置 → 插件市场**，别人一键安装。
>
> **不发 npm**：npm 会把账号邮箱写进包的公开元数据，作者不希望公开邮箱。
> 插件市场支持从 GitHub 公开仓库安装，效果一样。

---

## 现在的状态

- 内部包名：`dsh-clock`（安装名）；公开仓库 / 展示名：`move45clock` / **Move45clock**；
- 用户版 `README.md` 已写好，安装说明只写“插件市场搜索 Move45clock”，不再教 npm 命令；
- 本地插件已回退到 `dsh-clock` 并恢复 profile（主题 / 市场 / 计费也一起回来）；
- 发布包 `publish/move45clock-1.4.0.tgz` 只是可选的 GitHub Release 附件；
- 这台机器的沙箱**访问不了 GitHub**，建仓库 / 推送 / 提 PR 需要你操作。

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

## 第 3 步：建 Release（可选）

tag 选 `v1.4.0`，附件上传 `publish/move45clock-1.4.0.tgz`。

> 有 Release 附件时，市场可以优先给预构建包；没有也能从 GitHub 源码安装。

---

## 第 4 步：提交市场目录（仓库创建满 1 天后）

市场（dsh-market）读的是社区目录 **awesome-dsh-plugin/awesome-dsh-plugin**。

1. Fork 这个目录仓库；
2. 新建 `data/plugins/<owner>__<repo>.yml`；
3. 内容复制 `publish/catalog-entry.yml`，把 `OWNER` / `REPO` 换成你的；
4. Commit → Contribute → Open pull request；
5. PR 标题：`Add <owner>/<repo>`；
6. CI 检查通过后，维护者合并；市场隔天能搜到。

> 硬规则：仓库 Public、创建满 1 天、`package.json` 有 `dsh.bundle`、加 `dsh-plugin` topic、
> 有真实可用的代码。一个 PR 最多 1～3 条。

---

## 第 5 步：发布后验证

1. DSH → 设置 → 插件市场 → 搜 **Move45clock**；
2. 看条目是否打开、安装按钮是否可用；
3. 在一个干净 profile 里装一次，确认左下角出现 🐣；
4. 试做一套计划 + 预览夜间提醒 + 点一次语音。

---

## 不写进公开仓库的东西

- 真实姓名、邮箱、住址、电话；
- 本机绝对路径、Windows 用户名；
- npm / GitHub 的 token、密码；
- 私人截图。

用户版 README 和 package / LICENSE 已按这个原则处理：作者写成
“A first-time vibecoder”，LICENSE 写成 “The Move45clock authors”。
