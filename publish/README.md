# 发布到 GitHub + DSH 插件市场

> 目标：让「健康钟」出现在 DSH 的 **设置 → 插件市场**，别人能搜到并安装。
>
> 结论：**走 GitHub 源码安装**。npm 上的 `dsh-clock` 已经被别人占用（一个叫“省钱时钟”的插件，0.1.2），
> 所以本项目不直接发同名 npm 包；市场条目也不需要 npm。

---

## 现在的状态

- 本地 `main` 已包含 v1.4.0（计划编辑器、弹窗放大、夜间提醒、语音播报）。
- 这台机器的沙箱**访问不了 GitHub**（git/SSL 被拦），所以“建仓库 / 推送 / 提 PR”
  这三步需要你在 **GitHub 网页**或 **GitHub Desktop** 里完成。
- 市场目录要求：
  - 仓库**创建满 1 天**（今天建仓库，明天再提交目录 PR，否则 CI 会拒）；
  - `package.json` 里有 `dsh.bundle`（本项目已有）；
  - 仓库加 `dsh-plugin` topic；
  - 有真实可用的代码（不是占位仓库）。

---

## 第 1 步：建 GitHub 仓库

1. 打开 <https://github.com/new>；
2. 名字建议 **`dsh-clock`**（想彻底避开 npm 撞名，可以用 `dsh-health-clock`）；
3. 选 **Public**；
4. 不要勾选 “Add a README / .gitignore / license”（本地已经有了）；
5. 创建后，在仓库右侧 About 里加 topic：**`dsh-plugin`**。

---

## 第 2 步：把本地仓库推上去

### 用 GitHub Desktop（推荐，最省事）

1. File → Add Local Repository → 选 `D:\deepseekAI\dsh-clock`；
2. 点 **Publish repository**；
3. 取消 “Keep this code private”（市场只收公开仓库）；
4. Publish。

### 用命令行（如果你有 Git）

```powershell
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main --tags
```

---

## 第 3 步：建 Release（可选，但推荐）

1. 仓库右侧 **Releases → Draft a new release**；
2. tag 选 **`v1.4.0`**（本地已打）；
3. 标题写 `v1.4.0`；
4. 附件上传 `publish/dsh-clock-1.4.0.tgz`（本地已生成）；
5. Publish release。

> 有了 Release 附件，市场可以优先给“预构建 tarball”，装起来更快；
> 没有也不影响收录，仍然能从 GitHub 源码安装。

---

## 第 4 步：提交市场目录（仓库创建满 1 天后）

市场界面（dsh-market）读的是社区目录
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
不是 dsh-market 仓库本身。

1. 打开上面的目录仓库，点 **Fork**；
2. 在你的 fork 里新建文件：
   `data/plugins/<你的用户名>__<仓库名>.yml`
   （例如 `SilverLark257__dsh-clock.yml`）；
3. 内容复制 `publish/catalog-entry.yml`，把 `OWNER` / `REPO` 换成你的；
4. Commit → **Contribute → Open pull request**；
5. PR 标题写 `Add <owner>/<repo>`；
6. CI 会检查 `dsh.bundle`、仓库年龄、YAML、README 生成；通过后维护者合并，
   dsh-market 隔天就能搜到。

> 一个 PR 只加 1～3 条；描述必须和代码一致，不要写营销词。

---

## 条目里写什么

见 `publish/catalog-entry.yml`。当前写的分类是 **`ui`**（界面/提醒类）；
如果维护者觉得 `notify` 更贴切，他们会直接改，不影响收录。

---

## 需要你确认的三件事

1. **GitHub 用户名**：是 `SilverLark257` 吗？
2. **仓库名**：`dsh-clock`，还是为了避免 npm 撞名改用 `dsh-health-clock`？
3. **包名**：现在 `package.json` 里还是 `dsh-clock`。如果改成 `dsh-health-clock`，
   需要重装一次插件（设置、计划、夜间记录都在 `~/.dsh`，不会丢），但能和 npm 上那个
   “省钱时钟”彻底分开。只在 GitHub 市场发布的话，不改也能用。

---

## 发布后怎么验证

1. 打开 DSH → 设置 → **插件市场**（dshmarket）；
2. 搜「健康钟」或仓库名；
3. 看条目是否能打开、安装命令是不是 `github:<owner>/<repo>`；
4. 在一个干净 profile 里试装一次（可以让我帮你做）。

---

## 小提醒

- 仓库必须 **Public**；
- 仓库满 1 天再提目录 PR，这是硬规则；
- 不要把 `.git`、`node_modules`、`.npm-cache` 上传；
- 截图可选：在仓库根放 `screenshots.json` 指向 1～8 张图，市场会展示。
