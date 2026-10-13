@echo off
rem Starts Lonca: the server hosted here (if any) and this computer's agents. First time: pip install -r requirements.txt
cd /d "%~dp0"
python -m lonca --window %*
