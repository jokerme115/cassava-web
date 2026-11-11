@echo off
chcp 65001 >nul
echo 正在停止占用 8000 与 5173 端口的本地服务...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "127.0.0.1:8000" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "127.0.0.1:5173" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
echo 服务已停止。
timeout /t 2 >nul
