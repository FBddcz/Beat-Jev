# 手机直达与免费部署

GitHub 仓库是代码地址，不是游戏入口。手机直接玩，需要把 Node 服务部署成 HTTPS 网页；部署完成后，玩家只打开网页，不需要登录 GitHub。

## 一键部署到 Render 免费档

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/FBddcz/Beat-Jev)

这是“部署入口”，不是最终的游戏页。第一次需要用 Render 账号授权读取 GitHub 仓库；完成后以后只分享 Render 生成的游戏地址即可。

1. 在手机或电脑打开上面的 **Deploy to Render** 按钮。
2. 登录 Render，确认仓库为 `FBddcz/Beat-Jev`，直接点击 **Apply / Deploy**。
3. 等待构建完成，Render 会生成类似 `https://beat-jev-xxxx.onrender.com` 的 **Play URL**。
4. 复制这个 Play URL 发给手机；手机浏览器打开即可玩，不需要登录 GitHub。
5. 想像 App 一样使用时，在 Safari 选择“添加到主屏幕”，或在 Chrome 菜单中选择“添加到主屏幕”。

手机玩家以后只需要第 3 步生成的 Play URL；不要把 GitHub 仓库地址当作游戏地址。

Render 免费服务长时间无人访问时可能休眠，第一次打开会有几十秒唤醒时间。练习模式不需要配置 Jev Key；要开放 Jev 对战，再在 Render 的 Environment 中配置 `TYPESAFE_API_KEY` 和 `JEV_MODEL`。

## 本地网络试玩

在电脑上运行：

```bash
npm install
HOST=0.0.0.0 npm start
```

手机和电脑连接同一个 Wi-Fi 后，用手机打开电脑局域网 IP 的 `8791` 端口，例如 `http://192.168.1.8:8791/`。这种地址只适合临时试玩，不能作为公开链接。

## 平台发布路线

| 目标 | 适合方式 | 说明 |
| --- | --- | --- |
| 手机浏览器 / 微信内置浏览器 | Render HTTPS H5 | 当前项目可以直接使用 |
| PWA | H5 地址添加到主屏幕 | 项目已内置 manifest |
| 微信小游戏 | Cocos Creator / Canvas 重做渲染层 | 复用 `game.mjs` 规则，Key 只放服务端 |
| 抖音小游戏 | Cocos Creator / Canvas 适配小游戏 API | 通过抖音开发者工具提交审核 |
| 小红书 | 笔记配 H5 地址 | 先用网页链接验证传播，再考虑平台专用适配 |
| Android / iOS | Capacitor 包装 H5 | 需要应用商店分发时再做 |

各平台的审核、隐私和域名要求见 [`platform-publishing.md`](./platform-publishing.md)；宣发文字单独放在 [`xhs-copy.md`](./xhs-copy.md)。
