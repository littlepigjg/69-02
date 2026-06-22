@echo off
chcp 65001 >nul
echo ========================================
echo   服务健康监控系统 - 一键启动
echo ========================================
echo.

echo [1/4] 安装后端依赖...
cd backend
if not exist node_modules (
    call npm install
    if errorlevel 1 (
        echo 后端依赖安装失败，请检查 Node.js 是否已安装
        pause
        exit /b 1
    )
) else (
    echo 后端依赖已存在，跳过安装
)
cd ..

echo.
echo [2/4] 安装前端依赖...
cd frontend
if not exist node_modules (
    call npm install
    if errorlevel 1 (
        echo 前端依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo 前端依赖已存在，跳过安装
)
cd ..

echo.
echo [3/4] 构建前端项目...
cd frontend
call npm run build
if errorlevel 1 (
    echo 前端构建失败
    pause
    exit /b 1
)
cd ..

echo.
echo [4/4] 启动后端服务（前端已内置提供）...
echo.
echo ========================================
echo   启动完成后访问:
echo   - 状态页面: http://localhost:3001/
echo   - 管理配置: http://localhost:3001/admin
echo   - 后端 API: http://localhost:3001/api
echo ========================================
echo.

cd backend
call node server.js

pause
