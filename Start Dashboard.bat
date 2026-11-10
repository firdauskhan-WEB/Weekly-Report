@echo off
rem Starts the React dashboard and opens it in the browser
cd /d "%~dp0lp-dashboard-react"
npm run dev -- --open
