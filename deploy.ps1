# Telegram 订阅查询 Bot - 一键部署脚本
# 支持自动安装依赖、配置环境和部署到 Cloudflare Workers

param(
    [string]$BotToken = "",
    [switch]$Install,
    [switch]$Help
)

function Show-Help {
    Write-Host "📱 Telegram 订阅查询 Bot 部署脚本" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "用法:" -ForegroundColor Yellow
    Write-Host "  .\deploy.ps1                    # 标准部署"
    Write-Host "  .\deploy.ps1 -Install           # 安装依赖并部署"
    Write-Host "  .\deploy.ps1 -BotToken <token>  # 指定 Bot Token"
    Write-Host "  .\deploy.ps1 -Help              # 显示帮助"
    Write-Host ""
    Write-Host "环境要求:" -ForegroundColor Yellow
    Write-Host "  - Node.js (推荐 v18+)"
    Write-Host "  - Wrangler CLI"
    Write-Host "  - 有效的 Cloudflare 账户"
    exit 0
}

function Write-Step {
    param([string]$Message)
    Write-Host "🔹 $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

if ($Help) {
    Show-Help
}

Write-Host "🚀 开始部署 Telegram 订阅查询 Bot..." -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Step "检查 Node.js 环境..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "未检测到 Node.js，请先安装: https://nodejs.org/"
    exit 1
}
$nodeVersion = node --version
Write-Success "Node.js 版本: $nodeVersion"

# 安装 Wrangler（如果需要）
if ($Install -or (-not (Get-Command wrangler -ErrorAction SilentlyContinue))) {
    Write-Step "安装 Wrangler CLI..."
    npm install -g wrangler
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Wrangler 安装失败"
        exit 1
    }
}

# 检查 Wrangler
Write-Step "检查 Wrangler 环境..."
if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Error "Wrangler 未安装，请运行: npm install -g wrangler"
    exit 1
}
$wranglerVersion = wrangler --version
Write-Success "Wrangler 版本: $wranglerVersion"

# Wrangler 登录检查
Write-Step "检查 Cloudflare 登录状态..."
$whoami = wrangler whoami 2>&1
if ($whoami -match "You are not authenticated") {
    Write-Host "⚠️  未登录 Cloudflare，正在启动登录流程..." -ForegroundColor Yellow
    wrangler login
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Cloudflare 登录失败"
        exit 1
    }
}

# 检查配置文件
Write-Step "检查项目配置..."
if (-not (Test-Path "wrangler.toml")) {
    Write-Host "⚠️  未检测到 wrangler.toml，正在创建..." -ForegroundColor Yellow
    
    # 获取账户ID
    $account = wrangler whoami | Select-String "Account ID:" | ForEach-Object { $_.ToString().Split(":")[1].Trim() }
    
    $tomlContent = @"
name = "HelloSub_Bot"
type = "javascript"
account_id = "$account"
workers_dev = true
main = "worker.js"
compatibility_date = "2024-07-01"

[vars]
# BOT_TOKEN 将通过 Secret 设置
"@
    
    $tomlContent | Out-File -FilePath "wrangler.toml" -Encoding UTF8
    Write-Success "wrangler.toml 创建完成"
}

# 检查 worker.js
if (-not (Test-Path "worker.js")) {
    Write-Error "worker.js 文件不存在！"
    exit 1
}

# 设置 Bot Token（如果提供）
if ($BotToken) {
    Write-Step "设置 Bot Token..."
    $secretResult = wrangler secret put BOT_TOKEN --text $BotToken 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Bot Token 设置成功"
    } else {
        Write-Error "Bot Token 设置失败: $secretResult"
        exit 1
    }
}

# 部署
Write-Step "部署到 Cloudflare Workers..."
wrangler deploy
if ($LASTEXITCODE -ne 0) {
    Write-Error "部署失败"
    exit 1
}

Write-Success "🎉 部署成功！"
Write-Host ""

# 获取部署信息
$deployInfo = wrangler whoami
Write-Host "📋 部署信息:" -ForegroundColor Cyan
Write-Host "   Worker 名称: HelloSub_Bot"
Write-Host "   访问地址: https://HelloSub_Bot.<你的子域>.workers.dev"
Write-Host ""

Write-Host "🔗 后续步骤:" -ForegroundColor Yellow
Write-Host "1. 如未设置 Bot Token，请运行:"
Write-Host "   wrangler secret put BOT_TOKEN"
Write-Host "2. 访问 https://<你的域名>/hook 设置 Webhook"
Write-Host "3. 访问 https://<你的域名>/test 测试 Token"
Write-Host "4. 在 Telegram 中测试你的 Bot"
Write-Host ""
Write-Host "📖 更多信息请查看 README.md"
