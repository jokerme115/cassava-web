@echo off
chcp 65001 >nul
echo ======================================================
echo 正在启动木薯图像分割本地前后端服务...
echo ======================================================

set "ROOT=%~dp0"
set "PYTHON=C:\Users\Administrator\.conda\envs\hetao\python.exe"
set "NODE=C:\Program Files\nodejs\node.exe"

echo 1. 正在启动 Django 后端 (http://127.0.0.1:8000)...
start "Cassava-Backend" /min cmd /c "cd /d "%ROOT%网页\back\cassavaBack" && "%PYTHON%" manage.py runserver 127.0.0.1:8000 --noreload --settings=cassavaBack.dev_runtime_settings"

echo 2. 正在启动 Vite 前端 (http://127.0.0.1:5173)...
start "Cassava-Frontend" /min cmd /c "cd /d "%ROOT%网页\front\cassava_front" && "%NODE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173"

echo.
echo 前后端服务已在后台启动！
echo 本地访问地址: http://127.0.0.1:5173/
echo 后端接口地址: http://127.0.0.1:8000/
echo ======================================================
timeout /t 3 >nul
