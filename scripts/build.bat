@echo off
REM Build da extensao Lovable Infinity
REM Executa na raiz do projeto

cd /d "%~dp0.."
call npm install
call npm run build
pause
