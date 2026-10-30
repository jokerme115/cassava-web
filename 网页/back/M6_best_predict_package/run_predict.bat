@echo off
setlocal

if "%~1"=="" (
    echo Usage: run_predict.bat INPUT_PATH [OUTPUT_DIR]
    exit /b 1
)

set INPUT_PATH=%~1
set OUTPUT_DIR=%~2

if "%OUTPUT_DIR%"=="" (
    set OUTPUT_DIR=outputs
)

conda run -n hetao python predict.py --input "%INPUT_PATH%" --output "%OUTPUT_DIR%"
