param([int]$FrontendPort = 5173, [int]$BackendPort = 8000)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv-backend\Scripts\python.exe'
$frontendPath = Join-Path $projectRoot '网页\front\cassava_front'
$logPath = Join-Path $projectRoot 'output\local-runtime'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '缺少项目 CPU Python 环境' }
if ($BackendPort -ne 8000) { throw '当前前端代理使用8000端口，请使用默认后端端口' }

if (-not (Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $pythonPath -ArgumentList @('-m','django','runserver',"127.0.0.1:$BackendPort",'--noreload','--settings=cassavaBack.dev_runtime_settings','--pythonpath=网页/back/cassavaBack') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'backend.out.log') -RedirectStandardError (Join-Path $logPath 'backend.err.log') | Out-Null
}
$importWorkers = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like "*$projectRoot*run_import_worker*" }
if (-not $importWorkers) {
    Start-Process -FilePath $pythonPath -ArgumentList @('-m','django','run_import_worker','--settings=cassavaBack.dev_runtime_settings','--pythonpath=网页/back/cassavaBack') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'imports.out.log') -RedirectStandardError (Join-Path $logPath 'imports.err.log') | Out-Null
}
if (-not (Get-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue)) {
    $npmPath = (Get-Command npm.cmd).Source
    Start-Process -FilePath $npmPath -ArgumentList @('run','dev','--','--host','127.0.0.1','--port',"$FrontendPort",'--strictPort') -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'frontend.out.log') -RedirectStandardError (Join-Path $logPath 'frontend.err.log') | Out-Null
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $null = Invoke-WebRequest "http://127.0.0.1:$BackendPort/health/" -UseBasicParsing -TimeoutSec 3
        $null = Invoke-WebRequest "http://127.0.0.1:$FrontendPort/api/system/settings/public/" -UseBasicParsing -TimeoutSec 3
        Write-Output "网页已就绪：http://127.0.0.1:$FrontendPort/"
        exit 0
    } catch { Start-Sleep -Seconds 1 }
}
throw '本地服务未通过健康检查，请检查 output\local-runtime 日志'
