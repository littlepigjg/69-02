@echo off
chcp 65001 >nul
echo ========================================
echo   开发模式启动（前端热重载 + 后端）
echo ========================================
echo.

cd backend
if not exist node_modules (
    echo 安装后端依赖...
    call npm install
)

cd ..\frontend
if not exist node_modules (
    echo 安装前端依赖...
    call npm install
)

cd ..
echo.
echo 正在启动后端（端口3001）和前端开发服务器（端口5173）...
echo.

start "Backend - 服务健康监控" cmd /k "cd backend && node server.js"
timeout /t 3 /nobreak >nul
start "Frontend - 开发模式" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================
echo   访问地址:
echo   - 前端开发: http://localhost:5173/  (推荐用于开发)
echo   - 后端直连: http://localhost:3001/  (需要先构建前端)
echo ========================================
echo.
