@echo off
chcp 65001 >nul
echo.
echo 📱 Telegram 订阅查询 Bot - 快速启动
echo =====================================
echo.
echo 选择操作：
echo [1] 完整部署（安装依赖 + 部署）
echo [2] 仅部署到 Cloudflare Workers
echo [3] 本地开发模式
echo [4] 查看帮助
echo [0] 退出
echo.
set /p choice="请输入选项 (0-4): "

if "%choice%"=="1" goto install_deploy
if "%choice%"=="2" goto deploy
if "%choice%"=="3" goto dev
if "%choice%"=="4" goto help
if "%choice%"=="0" goto exit
goto invalid

:install_deploy
echo.
echo 🚀 开始完整部署...
powershell -ExecutionPolicy Bypass -File deploy.ps1 -Install
pause
goto menu

:deploy
echo.
echo 📦 开始部署...
powershell -ExecutionPolicy Bypass -File deploy.ps1
pause
goto menu

:dev
echo.
echo 🛠️ 启动本地开发模式...
echo 按 Ctrl+C 停止开发服务器
wrangler dev --local
pause
goto menu

:help
echo.
echo 📖 帮助信息
echo ============
echo.
echo 部署前准备：
echo 1. 确保已安装 Node.js (https://nodejs.org/)
echo 2. 在 Telegram 中创建 Bot (@BotFather)
echo 3. 注册 Cloudflare 账户 (https://cloudflare.com/)
echo.
echo 快速开始：
echo 1. 选择选项 [1] 进行完整部署
echo 2. 按提示设置 Bot Token
echo 3. 访问生成的 Webhook 地址
echo 4. 在 Telegram 中测试 Bot
echo.
echo 更多信息请查看 README.md
echo.
pause
goto menu

:invalid
echo.
echo ❌ 无效选项，请重新选择
pause
goto menu

:menu
cls
goto start

:exit
echo.
echo 👋 再见！
timeout /t 2 >nul
exit

:start
cls
echo.
echo 📱 Telegram 订阅查询 Bot - 快速启动
echo =====================================
echo.
echo 选择操作：
echo [1] 完整部署（安装依赖 + 部署）
echo [2] 仅部署到 Cloudflare Workers
echo [3] 本地开发模式
echo [4] 查看帮助
echo [0] 退出
echo.
set /p choice="请输入选项 (0-4): "

if "%choice%"=="1" goto install_deploy
if "%choice%"=="2" goto deploy
if "%choice%"=="3" goto dev
if "%choice%"=="4" goto help
if "%choice%"=="0" goto exit
goto invalid
