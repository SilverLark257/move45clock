# 发布到 npm + GitHub + DSH 插件市场

> 目标：`dsh-move45clock` 能通过 npm 安装，也能在 DSH 的 **设置 → 插件市场** 搜到。
>
> 名字说明：npm 包名**只能用小写**，所以用 `dsh-move45clock`；展示名可以写 **Move45clock**。
> 这个名字目前是空闲的。

---

## 一、npm（用户要的“npm 要发”）

### 现在的状态

- `package.json` 已经改名 `dsh-move45clock`，版本 `1.4.0`；
- `npm whoami` 显示**这台机器还没登录 npm**，所以还不能直接 publish；
- 需要你在终端登录一次（浏览器会弹出来），之后我可以帮你发。

### 登录（你来做一次）

```powershell
npm login --registry=https://registry.npmjs.org
```

按提示在浏览器里登录 / 输入验证码。登录成功后告诉我一声，我执行发布。

> 不建议把密码或 token 贴在对话里。登录一次即可，token 会存在本机 npm 配置里。

### 发布（登录后我来做）

```powershell
npm publish --registry=https://registry.npmjs.org
```

发布前我会先 `npm pack` 检查内容，确保只包含 `lib/`、`tools/`、README、图标和清单。

---

## 二、GitHub（市场收录需要）

- 这台机器的沙箱**访问不了 GitHub**（git/SSL 被拦），建仓库和推送需要你在
  **GitHub 网页**或 **GitHub Desktop** 完成；
- 市场目录要求仓库 **Public**、创建满 **1 天**、有 `dsh.bundle`、加 `dsh-plugin` topic；
- 仓库里**不要**放真实个人信息（姓名、邮箱、住址、本机路径）。

### 建仓库

1. 打开 GitHub 的“新建仓库”页面；
2. 名字建议 `dsh-move45clock`（和 npm 包名一致最省心）；
3. 选 Public；不要勾 README / .gitignore / license（本地已有）；
4. 创建后加 topic：`dsh-plugin`。

### 推本地仓库

用 GitHub Desktop：Add Local Repository → 选 `<本地项目目录>` → Publish repository → 取消 private。

或者命令行（把尖括号换成你自己的）：

```powershell
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main --tags
```

### Release（可选，但推荐）

tag 选 `v1.4.0`，附件上传 `publish/dsh-move45clock-1.4.0.tgz`。

---

## 三、DSH 插件市场目录

dsh-market 读的是社区目录 **awesome-dsh-plugin/awesome-dsh-plugin**（不是 dsh-market 仓库）。

仓库满 1 天后：

1. Fork 这个目录仓库；
2. 新建 `data/plugins/<owner>__<repo>.yml`；
3. 内容复制 `publish/catalog-entry.yml`，把 `OWNER` / `REPO` 换成你的；
4. Commit → Contribute → Open pull request；
5. PR 标题：`Add <owner>/<repo>`；
6. CI 检查通过后，维护者合并；市场隔天能搜到。

> 一个 PR 最多 1～3 条；描述必须和代码一致，不要写营销词。

---

## 四、发布后验证

1. `npm view dsh-move45clock version` 能看到 1.4.0；
2. 在干净 profile 里 `dsh plugin --profile web add dsh-move45clock` 能装；
3. DSH 设置 → 插件市场搜 Move45clock，能看到条目；
4. 装上后左下角出现 🐣，试做一次卡片，听一次语音。

---

## 五、不要写进公开仓库的东西

- 真实姓名、邮箱、住址、电话；
- 本机绝对路径（例如 `D:\...`）、Windows 用户名；
- npm / GitHub 的 token、密码；
- 任何私人截图。

用户版 README 已经按这个原则写好了，不放真实地址和个人信息。
