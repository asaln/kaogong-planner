# 考公备考计划表 · 可多端同步的静态网站

一个零服务器成本、可在 GitHub Pages 上运行、支持手机/电脑/任意浏览器实时同步打卡进度的考公备考计划表。

---

## 七条需求对照

| # | 你的需求 | 实现情况 |
|---|---------|---------|
| 1 | 每日任务自定义修改要**真正保存**，刷新不丢 | ✅ 新增 `editStore` 持久化层。双击/点任务文字即可改，回车落盘，`localStorage` 保存，刷新、关网页、重启都在 |
| 2 | 改任务时**一条一行、允许换行** | ✅ 任务用 `contenteditable` 渲染，支持多行编辑；回车保存，Shift+回车换行 |
| 3 | 改造为 GitHub 上可访问、功能完整的网站 | ✅ 纯静态前端 + GitHub Actions 后端，无需自建服务器 |
| 4 | 手机/电脑/不同浏览器**多端输入即时同步可见** | ✅ 读取走 Pages 静态资源（毫秒级），写入走 Actions workflow 合并提交 |
| 5 | 手机端操作便捷 | ✅ 手机端表格自动转卡片流、底部固定操作条、任务文字直接点改 |
| 6 | 文件可拆分（HTML/CSS/JS 分离） | ✅ 已拆为 `index.html` / `style.css` / `data.js` / `app.js` + `.github/workflows/` |
| 7 | 返回**已生成好的文件**，不要代码 | ✅ 本仓库即为完整可用产物，配置后直接能用 |

---

## 快速开始（5 分钟上线）

### 第 1 步：Fork 本仓库
点右上角 **Fork**，把仓库复制到你的 GitHub 账号下。

### 第 2 步：开启 GitHub Pages
进入你的仓库 → **Settings → Pages**
- **Source** 选择 **GitHub Actions**
- 保存后 GitHub 会自动跑一次部署（首次约 1–2 分钟）

### 第 3 步：配置两个密钥
进入你的仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名 | 内容 | 说明 |
|-----------|------|------|
| `API_TOKEN` | 你自己定的任意字符串，例如 `8f3a9c2d7e1b5406a2c9d3f8e7b1a046` | 作为"访问密码"，前后端必须一致 |
| `GH_TOKEN` | 有当前仓库 **Contents: Read and Write** 权限的 Token | 推荐用 [Fine-grained token](https://github.com/settings/tokens?type=beta)，只授权当前这一个仓库 |

同时开启 workflow 写权限：**Settings → Actions → General → Workflow permissions → 选 "Read and write permissions"**。

### 第 4 步：填入同步设置
打开你的网站（地址形如 `https://你的用户名.github.io/你的仓库名/`），点右上角 **⚙ 同步设置**：
- **仓库地址**：填 `你的用户名/你的仓库名`
- **同步令牌**：填与第 3 步 `API_TOKEN` **完全一致**的字符串

点 **保存并同步**。此时在任意手机、电脑、浏览器上用同一个网址打开，打卡和修改都会自动上传，别处刷新即见。

> 两个字段都留空 = 仅本机保存模式，进度存在当前浏览器本地，换设备不会自动共享。

---

## 同步原理

```
手机浏览器 ──读取──▶ Pages: /data/progress.json ◀──提交──┐
   │                                                      │
   └──写入──▶ Actions: repository_dispatch ──▶ put.yml ──┘
                合并（按时间戳 _t 较新者优先）并写回
```

- **读取**：前端直接 `GET` Pages 上的 `data/progress.json`，公开资源、CDN 缓存、毫秒级，**不消耗 Actions 配额**。
- **写入**：`POST` 到 Actions 的 `repository_dispatch`，触发 `put.yml` workflow 做版本化合并提交。workflow 跑完约 10–30 秒后前端自动再拉一次，保证拿到最新值。
- **冲突**：每次写入带时间戳 `_t`，服务端取较新者，两个设备并发提交不会互盖。

---

## 本地使用（不上云）

直接在浏览器里打开 `index.html` 即可。所有打卡、任务修改、新增日期都存在本机浏览器 `localStorage`，关闭网页再打开仍在。缺点是不跨设备——想要多端同步请按上面四步配置。

---

## 文件结构

```
.
├── index.html              页面结构
├── style.css               样式（含手机端卡片流）
├── data.js                 409 天原始计划数据（由 build.py 从原 app.js 注入）
├── app.js                  核心逻辑：渲染/打卡/编辑/排序/筛选/同步
├── build.py                重新构建 data.js 的脚本（改动原始计划时运行）
└── .github/
    └── workflows/
        ├── deploy.yml      Pages 部署
        └── put.yml         写入入口（合并提交 progress.json）
```


## 安全说明

- `API_TOKEN` 只用于区分"是不是你本人在写入"，**不是** GitHub 密码或 Token。
- 真正有权限改仓库的是 `GH_TOKEN`，它存在 GitHub Secrets 里，永远不会出现在前端或网页源码中。
- 进度文件 `data/progress.json` 是**公开可读**的（否则 Pages 无法下发）。如果你介意"别人能看到我的学习进度"，请把仓库设为 **Private**——但注意 GitHub Pages 对私有仓库需要 Pro 或开通相关权限，且私有仓库的 Pages 站点本身也会要求访问者登录。

---

## 常见问题

**Q：配置了但写入提示"写入入口未就绪"？**
A：`put.yml` workflow 必须被推送进仓库才会存在。确认你 fork 时包含 `.github/workflows/put.yml`，并在 Settings → Actions 里看到它。

**Q：手机上改了，电脑上没看到？**
A：写入到生效有 10–30 秒延迟，稍等后刷新。若仍无，检查两端 ⚙ 同步设置里的仓库地址与令牌是否一致。

**Q：能多人共用吗？**
A：可以。把仓库地址和 `API_TOKEN` 告诉同用的人，大家打卡进同一个进度文件。注意会互相覆盖，建议各用各的。

**Q：想改原始计划（比如调整某天任务）？**
A：编辑 `data.js` 里的对应日期，或在页面上直接改（页面内的修改优先级高于原始数据）。若批量改，可用 `build.py` 重新生成 `data.js`。
