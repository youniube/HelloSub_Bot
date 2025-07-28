# 📱 Telegram 订阅查询 Bot

[![Deploy with Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/0-o0/HelloSub_Bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个基于 Cloudflare Workers 的 Telegram Bot，用于快速查询订阅链接的流量使用情况和到期时间。

## ✨ 功能特性

- 🔍 **智能解析**：支持多种订阅链接格式，自动识别流量信息
- 💬 **双重交互**：支持直接消息和内联查询两种使用方式
- 📊 **详细信息**：显示已用流量、剩余流量、使用进度条和到期时间
- 🚀 **快速部署**：基于 Cloudflare Workers，全球边缘计算
- 🔒 **安全可靠**：无需存储敏感信息，实时查询

## 🚀 快速部署

### 方法一：一键部署（推荐）

1. **准备 Telegram Bot**

   - 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
   - 发送 `/newbot` 创建新机器人
   - 记下获得的 Bot Token
2. **部署到 Cloudflare Workers**

   - 访问 [Cloudflare Workers](https://workers.cloudflare.com/) 注册并登录
   - 点击 "Create a Service"，选择 "HTTP handler" 模板
   - 将 `worker.js` 文件内容全部复制到编辑器中
   - 点击 "Save and Deploy"
3. **配置环境变量**

   - 在 Worker 设置页面，点击 "Variables"
   - 添加 Secret 类型变量：
     - 名称：`BOT_TOKEN`
     - 值：你的 Telegram Bot Token
4. **设置 Webhook**

   - 部署完成后，访问 `https://<你的-worker-域名>/hook`
   - 看到 "Webhook 设置成功" 即表示配置完成
5. **测试部署**

   - 访问 `https://<你的-worker-域名>/test` 测试 Token 是否有效
   - 在 Telegram 中向你的 Bot 发送 `/start` 测试功能

### 方法二：使用 Wrangler CLI

1. **安装 Wrangler**

   ```bash
   npm install -g wrangler
   ```
2. **登录 Cloudflare**

   ```bash
   wrangler login
   ```
3. **配置项目**

   ```bash
   # 克隆项目并进入目录
   git clone <0-o0>
   cd HelloSub_Bot

   # 初始化配置
   wrangler init
   ```
4. **部署项目**

   ```bash
   # Windows PowerShell
   .\deploy.ps1

   # 或直接使用 wrangler
   wrangler deploy
   ```


## 📋 使用说明

### 基本功能

1. **开始使用**
   - 在 Telegram 中搜索你的 Bot 用户名
   - 发送 `/start` 命令开始使用

2. **查询订阅信息**
   - 直接发送订阅链接给 Bot
   - Bot 会返回详细的流量信息，包括：
     - 📊 使用进度条
     - 💾 已用/总流量
     - ⏰ 到期时间
     - 🔄 流量重置周期

3. **内联查询**
   - 在任何聊天中输入 `@你的bot用户名 订阅链接`
   - 可以直接在聊天中分享查询结果

### 🔒 权限控制

**设计原则**：默认只有你能用，用 `/open` 和 `/close` 控制

**环境变量配置**：
- `BOT_USERID`（可选）：设置Bot创建者的Telegram用户ID
  - **不设置**：所有人都可以使用Bot（完全公开模式）
  - **设置后**：默认只有创建者可以使用，创建者可通过命令控制开放状态

**创建者专用命令**：
- `/open` - 开放Bot给所有人使用（临时公开模式）
- `/close` - 限制只有创建者能使用（私有模式）
- `/status` - 查看当前Bot状态和你的用户ID


**获取用户ID方法**：向 [@userinfobot](https://t.me/userinfobot) 发送任意消息获取

### 支持的订阅格式

- ✅ 带 `Subscription-Userinfo` 头的标准订阅链接
- ✅ Base64 编码的配置文件（包含 status 信息）
- ✅ 主流机场订阅链接

## 📁 项目结构

```
📦 HelloSub_Bot
├── 📄 worker.js          # Cloudflare Worker 主逻辑
├── 📄 README.md          # 项目说明文档
├── 📄 wrangler.toml      # Cloudflare Workers 配置
├── 📄 deploy.ps1         # Windows 一键部署脚本
├── 📄 .env.example       # 环境变量示例
└── 📄 .gitignore         # Git 忽略文件
```

## ❓ 常见问题

<details>
<summary><strong>Q: Bot 无响应或提示 Token 无效？</strong></summary>

**A:** 请检查以下步骤：

1. 确认在 Cloudflare Workers 中正确设置了 `BOT_TOKEN` Secret
2. 访问 `https://你的域名/test` 测试 Token 是否有效
3. 确认 Webhook 已正确设置（访问 `/hook` 端点）

</details>

<details>
<summary><strong>Q: 订阅链接无法识别流量信息？</strong></summary>

**A:** 可能的原因：

1. 订阅服务商未提供 `Subscription-Userinfo` 头信息
2. 订阅链接已过期或无效
3. 网络连接问题，请稍后重试

</details>

<details>
<summary><strong>Q: 如何更新 Bot 代码？</strong></summary>

**A:** 两种方式：

1. 在 Cloudflare Workers 控制台直接编辑代码
2. 使用 `wrangler deploy` 命令重新部署

</details>

<details>
<summary><strong>Q: 支持哪些订阅服务商？</strong></summary>

**A:** 理论上支持所有提供标准流量信息的订阅服务，包括但不限于：

- 提供 Subscription-Userinfo 头的服务商
- 配置文件中包含 status 信息的服务

</details>

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

1. Fork 这个仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 📄 License

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## ⭐ 致谢

- [Cloudflare Workers](https://workers.cloudflare.com/) - 提供边缘计算平台
- [Telegram Bot API](https://core.telegram.org/bots/api) - 提供机器人接口

---

<div align="center">

**如果这个项目对你有帮助，请给它一个 ⭐**

Made with ❤️ by [0-o0](https://github.com/0-o0)

</div>
